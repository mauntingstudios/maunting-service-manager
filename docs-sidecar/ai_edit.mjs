import * as Y from "yjs";

function inlineTokens(text) {
  const tokens = [];
  const muster =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let letzter = 0;
  for (const treffer of text.matchAll(muster)) {
    if (treffer.index > letzter) {
      tokens.push({ text: text.slice(letzter, treffer.index), attrs: {} });
    }
    const roh = treffer[0];
    if (roh.startsWith("**")) {
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

function inlineNodes(text) {
  const nodes = [];
  for (const token of inlineTokens(text)) {
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

function absatz(text) {
  return element("paragraph", inlineNodes(text));
}

export function markdownToNodes(markdown) {
  const zeilen = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const knoten = [];
  let index = 0;
  let liste = null;
  let listenTyp = null;

  const listeSchliessen = () => {
    if (liste) {
      knoten.push(liste);
      liste = null;
      listenTyp = null;
    }
  };

  while (index < zeilen.length) {
    const zeile = zeilen[index];
    const getrimmt = zeile.trim();

    if (!getrimmt) {
      listeSchliessen();
      index += 1;
      continue;
    }

    if (getrimmt.startsWith("```")) {
      listeSchliessen();
      const inhalt = [];
      index += 1;
      while (index < zeilen.length && !zeilen[index].trim().startsWith("```")) {
        inhalt.push(zeilen[index]);
        index += 1;
      }
      index += 1;
      const text = new Y.XmlText();
      text.insert(0, inhalt.join("\n"));
      knoten.push(element("codeBlock", [text]));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(getrimmt);
    if (heading) {
      listeSchliessen();
      knoten.push(
        element("heading", inlineNodes(heading[2]), { level: heading[1].length }),
      );
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(getrimmt)) {
      listeSchliessen();
      knoten.push(element("horizontalRule"));
      index += 1;
      continue;
    }

    const aufgabe = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(getrimmt);
    if (aufgabe) {
      if (listenTyp !== "task") {
        listeSchliessen();
        liste = element("taskList");
        listenTyp = "task";
      }
      liste.insert(liste.length, [
        element("taskItem", [absatz(aufgabe[2])], {
          checked: aufgabe[1].toLowerCase() === "x",
        }),
      ]);
      index += 1;
      continue;
    }

    const punkt = /^[-*]\s+(.*)$/.exec(getrimmt);
    if (punkt) {
      if (listenTyp !== "bullet") {
        listeSchliessen();
        liste = element("bulletList");
        listenTyp = "bullet";
      }
      liste.insert(liste.length, [element("listItem", [absatz(punkt[1])])]);
      index += 1;
      continue;
    }

    const nummer = /^\d+\.\s+(.*)$/.exec(getrimmt);
    if (nummer) {
      if (listenTyp !== "ordered") {
        listeSchliessen();
        liste = element("orderedList");
        listenTyp = "ordered";
      }
      liste.insert(liste.length, [element("listItem", [absatz(nummer[1])])]);
      index += 1;
      continue;
    }

    if (getrimmt.startsWith(">")) {
      listeSchliessen();
      const inhalt = [];
      while (index < zeilen.length && zeilen[index].trim().startsWith(">")) {
        inhalt.push(zeilen[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      knoten.push(element("blockquote", [absatz(inhalt.join(" "))]));
      continue;
    }

    listeSchliessen();
    const absatzZeilen = [];
    while (index < zeilen.length) {
      const naechste = zeilen[index].trim();
      if (
        !naechste ||
        naechste.startsWith("```") ||
        naechste.startsWith(">") ||
        /^(#{1,6})\s+/.test(naechste) ||
        /^[-*]\s+/.test(naechste) ||
        /^\d+\.\s+/.test(naechste) ||
        /^(-{3,}|\*{3,})$/.test(naechste)
      ) {
        break;
      }
      absatzZeilen.push(zeilen[index].trim());
      index += 1;
    }
    if (absatzZeilen.length) {
      knoten.push(absatz(absatzZeilen.join(" ")));
    } else {
      index += 1;
    }
  }
  listeSchliessen();
  return knoten;
}

/**
 * Der sichtbare Text eines Blocks. `Y.XmlElement.toString()` liefert Markup
 * (`<paragraph>…</paragraph>`) und taugt nicht als Fingerabdruck; der Client
 * vergleicht den Zielblock mit `doc.textBetween(...)`.
 */
function plainText(node) {
  if (node instanceof Y.XmlText) return node.toString();
  if (!(node instanceof Y.XmlElement)) return "";
  const inner = node.toArray().map(plainText).join("");
  if (
    ["paragraph", "heading", "listItem", "taskItem", "blockquote", "tableCell", "tableHeader"].includes(
      node.nodeName,
    )
  ) {
    return inner;
  }
  return node.toArray().map(plainText).join(" ");
}

export class AiEditError extends Error {
  constructor(code, message, candidates = []) {
    super(message);
    this.code = code;
    this.candidates = candidates;
  }
}

export function applyAiEdit(
  ydoc,
  { operation, markdown, anchor, runId, callId, expectedBlock = null },
) {
  const fragment = ydoc.getXmlFragment("default");
  const origin = `ai:${runId || "run"}:${callId || Date.now()}`;
  const neue = markdownToNodes(markdown);
  if (!neue.length) {
    throw new AiEditError("AI_EDIT_STALE_SELECTION", "Der Markdown-Text ist leer");
  }

  let ersetzt = false;
  let targetBlock = null;
  let targetIndex = null;
  ydoc.transact(() => {
    if (operation === "append") {
      targetIndex = fragment.length;
      fragment.insert(fragment.length, neue);
      return;
    }
    if (operation !== "replace_block") {
      throw new AiEditError("DOC_INVALID_TARGET", "Unbekannte Operation");
    }
    const zitat = String(anchor?.quote || "").trim();
    if (!zitat) {
      throw new AiEditError(
        "AI_EDIT_STALE_SELECTION",
        "Fuer replace_block fehlt ein Ankerzitat",
      );
    }
    const treffer = fragment
      .toArray()
      .map((node, index) => ({ node, index, text: node.toString() }))
      .filter((eintrag) => eintrag.text.includes(zitat));
    const gewuenschte = Number(anchor?.occurrence);
    if (treffer.length > 1 && Number.isInteger(gewuenschte) && gewuenschte >= 1 && gewuenschte <= treffer.length) {
      treffer.splice(0, treffer.length, treffer[gewuenschte - 1]);
    }
    if (treffer.length !== 1) {
      throw new AiEditError(
        "AI_EDIT_STALE_SELECTION",
        treffer.length
          ? "Das Ankerzitat ist nicht eindeutig"
          : "Das Ankerzitat wurde nicht gefunden",
        treffer.slice(0, 5).map((eintrag) => eintrag.text.slice(0, 200)),
      );
    }
    const ziel = treffer[0];
    if (expectedBlock !== null && plainText(ziel.node) !== expectedBlock) {
      throw new AiEditError(
        "AI_EDIT_STALE_SELECTION",
        "Der Zielblock hat sich seit der Vorschau geaendert",
      );
    }
    targetBlock = plainText(ziel.node);
    targetIndex = ziel.index;
    fragment.delete(ziel.index, 1);
    fragment.insert(ziel.index, neue);
    ersetzt = true;
  }, origin);

  return {
    ok: true,
    origin,
    replaced: ersetzt,
    target_block: targetBlock,
    target_index: targetIndex,
    inserted_count: neue.length,
  };
}
