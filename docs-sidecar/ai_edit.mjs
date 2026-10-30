import * as Y from "yjs";
import {
  fingerprintText,
  normalizeText,
  plainTextOfYNode,
} from "@msm/docs-schema/structure";

import { restoreFragment } from "./persist.mjs";

export const MAX_AI_EDITS = 20;

const OPS = new Set([
  "append",
  "replace_block",
  "insert_before",
  "insert_after",
  "append_to_section",
  "replace_text",
  "delete_block",
]);

function inlineTokens(text, warnings) {
  const tokens = [];
  const muster =
    /(!\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let letzter = 0;
  for (const treffer of text.matchAll(muster)) {
    if (treffer.index > letzter) {
      tokens.push({ text: text.slice(letzter, treffer.index), attrs: {} });
    }
    const roh = treffer[0];
    if (roh.startsWith("![")) {
      // Bilder brauchen eine echte assetUid aus einem Upload. Die KI erfindet
      // keine URLs; der Aufrufer erfaehrt, dass der Teil verworfen wurde.
      if (warnings && !warnings.includes("image")) warnings.push("image");
    } else if (roh.startsWith("**")) {
      tokens.push({ text: roh.slice(2, -2), attrs: { bold: true } });
    } else if (roh.startsWith("*")) {
      tokens.push({ text: roh.slice(1, -1), attrs: { italic: true } });
    } else if (roh.startsWith("`")) {
      tokens.push({ text: roh.slice(1, -1), attrs: { code: true } });
    } else {
      const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(roh);
      tokens.push({
        text: match ? match[1] : roh,
        attrs: match ? { link: match[2] } : {},
      });
    }
    letzter = treffer.index + roh.length;
  }
  if (letzter < text.length) {
    tokens.push({ text: text.slice(letzter), attrs: {} });
  }
  return tokens;
}

function inlineNodes(text, warnings) {
  const nodes = [];
  for (const token of inlineTokens(text, warnings)) {
    if (!token.text) continue;
    const knoten = new Y.XmlText();
    knoten.insert(0, token.text, token.attrs);
    nodes.push(knoten);
  }
  if (!nodes.length) nodes.push(new Y.XmlText());
  return nodes;
}

function element(name, children = [], attrs = {}) {
  const node = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  if (children.length) node.insert(0, children);
  return node;
}

function absatz(text, warnings) {
  return element("paragraph", inlineNodes(text, warnings));
}

function tabellenZellen(zeile) {
  let roh = zeile.trim();
  if (roh.startsWith("|")) roh = roh.slice(1);
  if (roh.endsWith("|")) roh = roh.slice(0, -1);
  return roh.split("|").map((zelle) => zelle.trim());
}

function istTabellenTrenner(zeile) {
  if (!zeile || !zeile.includes("|")) return false;
  const zellen = tabellenZellen(zeile);
  return zellen.length > 0 && zellen.every((zelle) => /^:?-{3,}:?$/.test(zelle));
}

function listenName(typ) {
  if (typ === "task") return "taskList";
  if (typ === "ordered") return "orderedList";
  return "bulletList";
}

function listenZeile(zeile) {
  const treffer = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(zeile);
  if (!treffer) return null;
  const aufgabe = /^\[([ xX])\]\s+(.*)$/.exec(treffer[3]);
  const typ = aufgabe
    ? "task"
    : treffer[2].endsWith(".")
      ? "ordered"
      : "bullet";
  return {
    indent: treffer[1].replace(/\t/g, "  ").length,
    typ,
    text: aufgabe ? aufgabe[2] : treffer[3],
    checked: aufgabe ? aufgabe[1].toLowerCase() === "x" : false,
  };
}

/**
 * Liest eine Folge von Listenzeilen inklusive Einrueckung.
 *
 * Unterlisten haengen als zweites Kind am uebergeordneten `listItem`; ein
 * Typwechsel auf gleicher Ebene beginnt eine neue Liste. Die Yjs-Struktur
 * entspricht damit dem, was TipTap beim Einruecken erzeugt.
 */
function parseListe(zeilen, start, warnings) {
  const wurzel = [];
  const stapel = [];
  let index = start;

  while (index < zeilen.length) {
    const eintrag = listenZeile(zeilen[index]);
    if (!eintrag) break;

    while (stapel.length && eintrag.indent < stapel[stapel.length - 1].indent) {
      stapel.pop();
    }
    let eltern = stapel[stapel.length - 1];

    if (eltern && eintrag.indent > eltern.indent) {
      if (!eltern.letztesItem) {
        // Einrueckung ohne vorherigen Punkt kann nicht haengen; flach weiter.
        eltern = null;
      } else {
        const unter = element(listenName(eintrag.typ));
        eltern.letztesItem.insert(eltern.letztesItem.length, [unter]);
        stapel.push({
          indent: eintrag.indent,
          liste: unter,
          typ: eintrag.typ,
          letztesItem: null,
        });
        eltern = stapel[stapel.length - 1];
      }
    } else if (
      eltern &&
      eintrag.indent === eltern.indent &&
      eintrag.typ !== eltern.typ
    ) {
      stapel.pop();
      const container = stapel.length
        ? stapel[stapel.length - 1].letztesItem
        : null;
      const neu = element(listenName(eintrag.typ));
      if (container) container.insert(container.length, [neu]);
      else wurzel.push(neu);
      stapel.push({
        indent: eintrag.indent,
        liste: neu,
        typ: eintrag.typ,
        letztesItem: null,
      });
      eltern = stapel[stapel.length - 1];
    }

    if (!eltern) {
      const neu = element(listenName(eintrag.typ));
      wurzel.push(neu);
      stapel.push({
        indent: eintrag.indent,
        liste: neu,
        typ: eintrag.typ,
        letztesItem: null,
      });
      eltern = stapel[stapel.length - 1];
    }

    const item = element(
      eintrag.typ === "task" ? "taskItem" : "listItem",
      [absatz(eintrag.text, warnings)],
      eintrag.typ === "task" ? { checked: eintrag.checked } : {},
    );
    eltern.liste.insert(eltern.liste.length, [item]);
    eltern.letztesItem = item;
    index += 1;
  }

  return { knoten: wurzel, weiter: index };
}

export function markdownToNodes(markdown, { warnings = [] } = {}) {
  const zeilen = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const knoten = [];
  let index = 0;

  while (index < zeilen.length) {
    const zeile = zeilen[index];
    const getrimmt = zeile.trim();

    if (!getrimmt) {
      index += 1;
      continue;
    }

    if (getrimmt.startsWith("```")) {
      const info = getrimmt.slice(3).trim();
      const sprache = info.split(/\s+/)[0] || "";
      const inhalt = [];
      index += 1;
      while (index < zeilen.length && !zeilen[index].trim().startsWith("```")) {
        inhalt.push(zeilen[index]);
        index += 1;
      }
      index += 1;
      const text = new Y.XmlText();
      text.insert(0, inhalt.join("\n"));
      knoten.push(
        element("codeBlock", [text], sprache ? { language: sprache } : {}),
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(getrimmt);
    if (heading) {
      knoten.push(
        element("heading", inlineNodes(heading[2], warnings), {
          level: heading[1].length,
        }),
      );
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(getrimmt)) {
      knoten.push(element("horizontalRule"));
      index += 1;
      continue;
    }

    if (
      getrimmt.includes("|") &&
      index + 1 < zeilen.length &&
      istTabellenTrenner(zeilen[index + 1])
    ) {
      const kopf = tabellenZellen(getrimmt);
      const koerper = [];
      index += 2;
      while (index < zeilen.length && zeilen[index].includes("|")) {
        koerper.push(tabellenZellen(zeilen[index]));
        index += 1;
      }
      const zellen = (werte, art) =>
        Array.from({ length: kopf.length }, (_, spalte) =>
          element(art, [absatz(werte[spalte] || "", warnings)]),
        );
      knoten.push(
        element("table", [
          element("tableRow", zellen(kopf, "tableHeader")),
          ...koerper.map((werte) => element("tableRow", zellen(werte, "tableCell"))),
        ]),
      );
      continue;
    }

    if (listenZeile(zeile)) {
      const gelesen = parseListe(zeilen, index, warnings);
      knoten.push(...gelesen.knoten);
      index = gelesen.weiter;
      continue;
    }

    if (getrimmt.startsWith(">")) {
      const inhalt = [];
      while (index < zeilen.length && zeilen[index].trim().startsWith(">")) {
        inhalt.push(zeilen[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      knoten.push(element("blockquote", [absatz(inhalt.join(" "), warnings)]));
      continue;
    }

    if (/^!\[[^\]]*\]\([^)]*\)$/.test(getrimmt)) {
      if (!warnings.includes("image")) warnings.push("image");
      index += 1;
      continue;
    }

    const absatzZeilen = [];
    while (index < zeilen.length) {
      const naechste = zeilen[index].trim();
      if (
        !naechste ||
        naechste.startsWith("```") ||
        naechste.startsWith(">") ||
        /^(#{1,6})\s+/.test(naechste) ||
        listenZeile(zeilen[index]) ||
        /^(-{3,}|\*{3,})$/.test(naechste) ||
        (naechste.includes("|") &&
          index + 1 < zeilen.length &&
          istTabellenTrenner(zeilen[index + 1]))
      ) {
        break;
      }
      absatzZeilen.push(zeilen[index].trim());
      index += 1;
    }
    if (absatzZeilen.length) {
      knoten.push(absatz(absatzZeilen.join(" "), warnings));
    } else {
      index += 1;
    }
  }

  return knoten;
}

export class AiEditError extends Error {
  constructor(code, message, candidates = [], editIndex = null) {
    super(message);
    this.code = code;
    this.candidates = candidates;
    this.editIndex = editIndex;
  }
}

function blockEintraege(fragment) {
  return fragment.toArray().map((node, index) => {
    const text = normalizeText(plainTextOfYNode(node));
    return {
      node,
      index,
      text,
      type: node.nodeName || "text",
      fingerprint: fingerprintText(text),
    };
  });
}

function kandidaten(eintraege, index) {
  if (!eintraege.length) return [];
  const zahl = Number(index);
  const mitte = Number.isInteger(zahl) ? Math.min(Math.max(zahl, 0), eintraege.length - 1) : 0;
  const von = Math.max(0, mitte - 2);
  const bis = Math.min(eintraege.length, mitte + 3);
  return eintraege.slice(von, bis).map((eintrag) => ({
    index: eintrag.index,
    type: eintrag.type,
    fingerprint: eintrag.fingerprint,
    text: eintrag.text.slice(0, 120),
  }));
}

/**
 * Findet den Zielblock. Der Fingerabdruck ist die Wahrheit; `index` ist nur
 * ein Hinweis, weil sich Indizes innerhalb eines Batches verschieben.
 */
export function resolveTarget(fragment, target = {}, editIndex = 0) {
  const eintraege = blockEintraege(fragment);
  const fp = String(target?.fingerprint || "").trim().toLowerCase();
  let treffer = fp ? eintraege.filter((eintrag) => eintrag.fingerprint === fp) : [];

  if (treffer.length > 1) {
    const index = Number(target?.index);
    if (Number.isInteger(index)) {
      const genau = treffer.find((eintrag) => eintrag.index === index);
      if (genau) treffer = [genau];
    }
  }
  if (treffer.length > 1) {
    const occurrence = Number(target?.occurrence);
    if (Number.isInteger(occurrence) && occurrence >= 1 && occurrence <= treffer.length) {
      treffer = [treffer[occurrence - 1]];
    }
  }
  if (treffer.length > 1) {
    throw new AiEditError(
      "AI_EDIT_TARGET_AMBIGUOUS",
      "Der Zielblock ist nicht eindeutig",
      kandidaten(treffer, target?.index),
      editIndex,
    );
  }
  if (treffer.length === 0) {
    // Ein mitgeschickter Fingerabdruck ist eine Zusicherung. Passt er nicht
    // mehr, wird nicht auf ein Zitat ausgewichen: genau so wuerde eine
    // gleichzeitige Aenderung eines anderen still ueberschrieben.
    const zitat = fp ? "" : normalizeText(target?.quote);
    if (zitat) {
      const typ = target?.type ? String(target.type) : null;
      const perZitat = eintraege.filter(
        (eintrag) => (!typ || eintrag.type === typ) && eintrag.text.includes(zitat),
      );
      if (perZitat.length === 1) return perZitat[0];
      if (perZitat.length > 1) {
        const occurrence = Number(target?.occurrence);
        if (
          Number.isInteger(occurrence) &&
          occurrence >= 1 &&
          occurrence <= perZitat.length
        ) {
          return perZitat[occurrence - 1];
        }
        throw new AiEditError(
          "AI_EDIT_TARGET_AMBIGUOUS",
          "Das Ankerzitat ist nicht eindeutig",
          kandidaten(perZitat, target?.index),
          editIndex,
        );
      }
    }
    throw new AiEditError(
      "AI_EDIT_TARGET_NOT_FOUND",
      "Der Zielblock wurde nicht gefunden",
      kandidaten(eintraege, target?.index),
      editIndex,
    );
  }
  return treffer[0];
}

function parseMarkdown(markdown, editIndex, warnings) {
  const knoten = markdownToNodes(markdown, { warnings });
  if (!knoten.length) {
    throw new AiEditError(
      "AI_EDIT_STALE_SELECTION",
      "Der Markdown-Text ist leer",
      [],
      editIndex,
    );
  }
  return knoten;
}

function textRuns(node, ausgabe = []) {
  if (node && typeof node.toDelta === "function") {
    const text = node
      .toDelta()
      .map((op) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
    ausgabe.push({ node, text });
    return ausgabe;
  }
  if (node && typeof node.toArray === "function") {
    for (const kind of node.toArray()) textRuns(kind, ausgabe);
  }
  return ausgabe;
}

function gleicheAttribute(links, rechts) {
  const ka = Object.keys(links);
  const kb = Object.keys(rechts);
  return ka.length === kb.length && ka.every((key) => links[key] === rechts[key]);
}

function attributeImBereich(node, von, bis) {
  let position = 0;
  let gefunden = null;
  for (const op of node.toDelta()) {
    if (typeof op.insert !== "string") continue;
    const ende = position + op.insert.length;
    if (ende > von && position < bis) {
      const hier = op.attributes || {};
      if (gefunden === null) gefunden = hier;
      else if (!gleicheAttribute(gefunden, hier)) return null;
    }
    position = ende;
  }
  return gefunden ?? {};
}

/**
 * Ersetzt Text innerhalb eines Blocks. Der Treffer muss genau einmal
 * vorkommen und in einem Textlauf mit einheitlicher Formatierung liegen;
 * sonst bleibt nur der Blockersatz. Stilles Umbauen von Marken waere genau
 * die Art Ueberraschung, die niemand im Dokument haben will.
 */
function replaceText(ziel, find, ersatz, editIndex) {
  const suche = String(find ?? "");
  if (!suche) {
    throw new AiEditError(
      "DOC_INVALID_TARGET",
      "replace_text braucht find",
      [],
      editIndex,
    );
  }
  const runs = textRuns(ziel.node);
  const gesamt = runs.map((run) => run.text).join("");
  const position = gesamt.indexOf(suche);
  if (position < 0) {
    throw new AiEditError(
      "AI_EDIT_TARGET_NOT_FOUND",
      "Der Text zum Ersetzen wurde nicht gefunden",
      [],
      editIndex,
    );
  }
  if (gesamt.indexOf(suche, position + suche.length) >= 0) {
    throw new AiEditError(
      "AI_EDIT_TARGET_AMBIGUOUS",
      "Der Text zum Ersetzen kommt mehrfach vor",
      [],
      editIndex,
    );
  }

  let start = 0;
  for (const run of runs) {
    const ende = start + run.text.length;
    if (position >= start && position + suche.length <= ende) {
      const relativ = position - start;
      const attribute = attributeImBereich(run.node, relativ, relativ + suche.length);
      if (attribute === null) {
        throw new AiEditError(
          "AI_EDIT_UNSAFE_MARKS",
          "Der Treffer kreuzt Formatierungsgrenzen; nutze replace_block",
          [],
          editIndex,
        );
      }
      run.node.delete(relativ, suche.length);
      run.node.insert(relativ, String(ersatz ?? ""), attribute);
      return;
    }
    start = ende;
  }

  throw new AiEditError(
    "AI_EDIT_UNSAFE_MARKS",
    "Der Treffer kreuzt Textlaeufe; nutze replace_block",
    [],
    editIndex,
  );
}

function applyOneEdit(fragment, edit, editIndex, warnings, merker) {
  const op = String(edit?.op || "");
  if (!OPS.has(op)) {
    throw new AiEditError(
      "DOC_INVALID_TARGET",
      `Unbekannte Operation: ${op || "(leer)"}`,
      [],
      editIndex,
    );
  }

  if (op === "append") {
    const neue = parseMarkdown(edit.markdown, editIndex, warnings);
    const ziel = fragment.length;
    fragment.insert(ziel, neue);
    return {
      index: editIndex,
      op,
      target_index: ziel,
      target_fingerprint: null,
      target_text: null,
      inserted_count: neue.length,
      replaced: false,
    };
  }

  const ziel = resolveTarget(fragment, edit.target, editIndex);
  const fingerprint = ziel.fingerprint;

  if (edit.expected_text != null && ziel.text !== normalizeText(edit.expected_text)) {
    throw new AiEditError(
      "AI_EDIT_STALE_SELECTION",
      "Der Zielblock hat sich seit der Vorschau geaendert",
      [],
      editIndex,
    );
  }

  if (op === "delete_block") {
    fragment.delete(ziel.index, 1);
    return {
      index: editIndex,
      op,
      target_index: ziel.index,
      target_fingerprint: fingerprint,
      target_text: ziel.text,
      inserted_count: 0,
      replaced: true,
      deleted: true,
    };
  }

  if (op === "replace_text") {
    replaceText(ziel, edit.find, edit.markdown, editIndex);
    return {
      index: editIndex,
      op,
      target_index: ziel.index,
      target_fingerprint: fingerprint,
      target_text: ziel.text,
      inserted_count: 0,
      replaced: true,
      text_replaced: true,
    };
  }

  const neue = parseMarkdown(edit.markdown, editIndex, warnings);

  if (op === "replace_block") {
    fragment.delete(ziel.index, 1);
    fragment.insert(ziel.index, neue);
    return {
      index: editIndex,
      op,
      target_index: ziel.index,
      target_fingerprint: fingerprint,
      target_text: ziel.text,
      inserted_count: neue.length,
      replaced: true,
    };
  }

  if (op === "insert_before") {
    // Mehrere Einfuegungen am selben Anker behalten die Reihenfolge des
    // Batches: die zweite landet hinter der ersten, nicht davor.
    const basis = merker.get(fingerprint) ?? ziel.index;
    fragment.insert(basis, neue);
    merker.set(fingerprint, basis + neue.length);
    return {
      index: editIndex,
      op,
      target_index: basis,
      target_fingerprint: fingerprint,
      target_text: ziel.text,
      inserted_count: neue.length,
      replaced: false,
    };
  }

  if (op === "insert_after") {
    const basis = Math.max(ziel.index + 1, merker.get(fingerprint) ?? 0);
    fragment.insert(basis, neue);
    merker.set(fingerprint, basis + neue.length);
    return {
      index: editIndex,
      op,
      target_index: basis,
      target_fingerprint: fingerprint,
      target_text: ziel.text,
      inserted_count: neue.length,
      replaced: false,
    };
  }

  if (op === "append_to_section") {
    if (ziel.type !== "heading") {
      throw new AiEditError(
        "DOC_INVALID_TARGET",
        "append_to_section braucht eine Ueberschrift als Ziel",
        [],
        editIndex,
      );
    }
    const level = Number(ziel.node.getAttribute("level") || 1);
    const knoten = fragment.toArray();
    let position = knoten.length;
    for (let i = ziel.index + 1; i < knoten.length; i += 1) {
      const nachbar = knoten[i];
      if (
        nachbar.nodeName === "heading" &&
        Number(nachbar.getAttribute("level") || 1) <= level
      ) {
        position = i;
        break;
      }
    }
    const basis = Math.max(position, merker.get(fingerprint) ?? 0);
    fragment.insert(basis, neue);
    merker.set(fingerprint, basis + neue.length);
    return {
      index: editIndex,
      op,
      target_index: basis,
      target_fingerprint: fingerprint,
      target_text: ziel.text,
      inserted_count: neue.length,
      replaced: false,
    };
  }

  throw new AiEditError(
    "DOC_INVALID_TARGET",
    `Unbekannte Operation: ${op}`,
    [],
    editIndex,
  );
}

/**
 * Wendet alle Aenderungen in genau einer Transaktion an.
 *
 * Bewusst synchron: zwischen Pruefung und Transaktion gibt es kein `await`,
 * damit kein Hocuspocus-Update und kein zweiter HTTP-Aufruf dazwischenkommt.
 * Yjs kann eine Transaktion nicht zurueckrollen; der Aufrufer validiert
 * deshalb zuerst auf einem Klon und stellt im Fehlerfall den Pre-Zustand
 * wieder her.
 */
export function applyEdits(
  ydoc,
  { edits, runId, callId, userId, warnings = [], merker = null } = {},
) {
  const liste = Array.isArray(edits) ? edits : [];
  if (!liste.length) {
    throw new AiEditError("DOC_INVALID_TARGET", "Keine Aenderungen", [], 0);
  }
  if (liste.length > MAX_AI_EDITS) {
    throw new AiEditError(
      "AI_EDIT_BATCH_TOO_LARGE",
      `Mehr als ${MAX_AI_EDITS} Aenderungen in einem Aufruf`,
      [],
      0,
    );
  }

  const fragment = ydoc.getXmlFragment("default");
  const origin = `ai:${userId ?? "anon"}:${runId || "run"}:${callId || Date.now()}`;
  const ergebnisse = [];
  // Ein Aufrufer, der die Vorschau schrittweise anwendet, reicht denselben
  // Merker weiter; so bleibt die Reihenfolge mehrerer Einfuegungen am selben
  // Anker auch dort gleich.
  const reihenfolge = merker ?? new Map();
  ydoc.transact(() => {
    liste.forEach((edit, index) => {
      ergebnisse.push(applyOneEdit(fragment, edit, index, warnings, reihenfolge));
    });
  }, origin);

  return { ok: true, origin, edits: ergebnisse, warnings };
}

/**
 * Alles oder nichts: Zuerst laeuft der Batch auf einem Klon. Erst wenn dort
 * jede Aenderung aufloesbar ist, wird das Live-Dokument angefasst. Wirft die
 * Anwendung wider Erwarten, wird der Fragmentbestand aus dem Pre-Zustand
 * wiederhergestellt (Yjs selbst kann eine Transaktion nicht zurueckrollen).
 */
export function applyEditsAtomically(ydoc, args, { pre = null } = {}) {
  const vorher = pre ?? Y.encodeStateAsUpdate(ydoc);
  const klon = new Y.Doc();
  try {
    Y.applyUpdate(klon, vorher);
    applyEdits(klon, args);
  } catch (error) {
    // Auf dem Klon gescheitert: das Live-Dokument wurde nie angefasst.
    error.applied = false;
    throw error;
  } finally {
    klon.destroy();
  }
  try {
    return { pre: vorher, result: applyEdits(ydoc, args) };
  } catch (error) {
    restoreFragment(ydoc, vorher, "ai:rollback");
    error.applied = true;
    throw error;
  }
}

/**
 * Altpfad fuer genau eine Aenderung. Bleibt fuer alte Pending-Zeilen und
 * bestehende Tests erhalten.
 */
export function applyAiEdit(
  ydoc,
  { operation, markdown, anchor, runId, callId, expectedBlock = null, userId = "anon" } = {},
) {
  const edit =
    operation === "append"
      ? { op: "append", markdown }
      : {
          op: "replace_block",
          markdown,
          target: {
            quote: anchor?.quote,
            occurrence: anchor?.occurrence,
          },
          expected_text: expectedBlock,
        };
  const ergebnis = applyEdits(ydoc, {
    edits: [edit],
    runId,
    callId,
    userId,
  });
  const eintrag = ergebnis.edits[0];
  return {
    ok: true,
    origin: ergebnis.origin,
    replaced: Boolean(eintrag.replaced),
    target_block: eintrag.target_text ?? null,
    target_index: eintrag.target_index,
    inserted_count: eintrag.inserted_count,
  };
}

/** Top-Level-Blöcke mit Pfad und Fingerabdruck fuer das Struktur-Werkzeug. */
export function structureOf(fragment, { offset = 0, limit = 120 } = {}) {
  const knoten = fragment.toArray();
  const von = Math.max(0, Number(offset) || 0);
  const bis = Math.min(knoten.length, von + Math.max(1, Number(limit) || 120));
  const stapel = [];
  const bloecke = [];

  for (let index = 0; index < knoten.length; index += 1) {
    const node = knoten[index];
    const type = node.nodeName || "text";
    const level = type === "heading" ? Number(node.getAttribute("level") || 1) : null;
    if (level !== null) {
      while (stapel.length && stapel[stapel.length - 1].level >= level) stapel.pop();
      stapel.push({
        level,
        text: normalizeText(plainTextOfYNode(node)),
      });
    }
    if (index < von || index >= bis) continue;
    const text = normalizeText(plainTextOfYNode(node));
    const pfad = (level !== null ? stapel.slice(0, -1) : stapel).map(
      (eintrag) => eintrag.text,
    );
    bloecke.push({
      index,
      type,
      level,
      heading_path: pfad,
      fingerprint: fingerprintText(text),
      text: text.slice(0, 200),
      char_count: text.length,
    });
  }

  return {
    blocks: bloecke,
    total: knoten.length,
    next_offset: bis < knoten.length ? bis : null,
    truncated: bis < knoten.length,
  };
}
