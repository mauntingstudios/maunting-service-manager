import { createHash } from "node:crypto";

import * as Y from "yjs";
import { schemaVersion } from "@msm/docs-schema/schema";

import { loadState, storeState } from "./backend_client.mjs";
import { assertStateSize, clampText } from "./limits.mjs";

const locks = new Map();
const bekannteRevs = new Map();

/**
 * Merkt die Backend-Revision eines geladenen Dokuments.
 *
 * Jeder Store sendet sie als `expected_rev`; das Backend lehnt einen
 * veralteten Stand mit 409 ab, statt ihn still zu ueberschreiben
 * (Befund 9). 0 heisst "unbekannt" und bleibt Wegen ohne Ladewissen offen.
 */
export function rememberRev(docName, rev) {
  if (Number.isInteger(rev) && rev >= 0) bekannteRevs.set(docName, rev);
}

export function forgetRev(docName) {
  bekannteRevs.delete(docName);
}

/**
 * Serialisiert Arbeit pro Schluessel.
 *
 * `waitMs` ist eine Frist fuer das Warten vor dem kritischen Abschnitt. Ist
 * sie abgelaufen, wird `fn` gar nicht erst ausgefuehrt. Ein `Promise.race`
 * waere hier falsch: der Auftrag liefe sonst nach der bereits beantworteten
 * Anfrage weiter und wuerde das Dokument still veraendern.
 */
export function withLock(key, fn, { waitMs = 0 } = {}) {
  const frist = waitMs > 0 ? Date.now() + waitMs : null;
  const vorher = locks.get(key) || Promise.resolve();
  let release;
  const eigen = new Promise((resolve) => {
    release = resolve;
  });
  const kette = vorher.then(() => eigen);
  locks.set(key, kette);
  return vorher.then(async () => {
    try {
      if (frist !== null && Date.now() > frist) {
        const fehler = new Error("Das Dokument wird gerade gespeichert");
        fehler.code = "AI_EDIT_BUSY";
        throw fehler;
      }
      return await fn();
    } finally {
      release();
      if (locks.get(key) === kette) locks.delete(key);
    }
  });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Dekodiert einen Zustand aus dem Body und prueft die Groesse.
 *
 * Der einzige Einlass fuer fremde Zustaende — Restore, Render und jeder
 * kuenftige Zustandsweg laufen hier durch, damit nie ein Zustand ueber
 * 4 MiB ins Dokument gelangt (Befund 34).
 */
export function decodeState(stateB64) {
  const bytes = Buffer.from(stateB64 || "", "base64");
  assertStateSize(bytes.byteLength);
  return bytes;
}

/** Ersetzt den Dokumentinhalt durch einen frueheren Zustand (ohne Store). */
export function restoreFragment(ydoc, stateBytes, origin = "restore") {
  assertStateSize(stateBytes.byteLength);
  const quelle = new Y.Doc();
  Y.applyUpdate(quelle, stateBytes);
  try {
    const live = ydoc.getXmlFragment("default");
    const src = quelle.getXmlFragment("default");
    ydoc.transact(() => {
      if (live.length > 0) live.delete(0, live.length);
      if (src.length === 0) return;
      const kopien = src
        .toArray()
        .map((node) => (typeof node.clone === "function" ? node.clone() : node));
      live.insert(0, kopien);
    }, origin);
  } finally {
    quelle.destroy();
  }
}

export function ydocOf(document) {
  if (!document) return null;
  if (document instanceof Y.Doc) return document;
  if (typeof document.getYDoc === "function") return document.getYDoc();
  if (document.ydoc instanceof Y.Doc) return document.ydoc;
  return document;
}

function sammleText(node, ausgabe) {
  if (node instanceof Y.XmlText) {
    // `toString()` schreibt Formatierungen als Markup mit; fuer Suche und KI
    // zaehlt nur der sichtbare Text.
    const delta =
      typeof node.toDelta === "function" ? node.toDelta() : [{ insert: node.toString() }];
    for (const op of delta) {
      if (typeof op.insert === "string") ausgabe.push(op.insert);
    }
    return;
  }
  if (!(node instanceof Y.XmlElement)) return;
  const name = node.nodeName;
  if (name === "image") {
    const alt = node.getAttribute("alt") || "";
    ausgabe.push(alt ? `[Bild: ${alt}]` : "[Bild]");
  }
  for (const kind of node.toArray()) {
    sammleText(kind, ausgabe);
  }
  if (
    ["paragraph", "heading", "listItem", "codeBlock", "tableRow"].includes(name)
  ) {
    ausgabe.push("\n");
  }
}

export function extractText(ydoc) {
  const fragment = ydoc.getXmlFragment("default");
  const ausgabe = [];
  for (const kind of fragment.toArray()) {
    sammleText(kind, ausgabe);
  }
  return ausgabe
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Speichert ohne eigenes Lock. Nur fuer Aufrufer, die das Dokument-Lock halten. */
export async function storeDocumentUnlocked(docName, ydoc, meta = {}) {
  const update = Y.encodeStateAsUpdate(ydoc);
  assertStateSize(update.byteLength);
  const { text, truncated } = clampText(extractText(ydoc));
  const payload = {
    state_b64: Buffer.from(update).toString("base64"),
    expected_rev: Number(meta.expected_rev ?? bekannteRevs.get(docName) ?? 0),
    origin: meta.origin || "autosave",
    author_user_id: meta.author_user_id ?? null,
    author_family: meta.author_family ?? null,
    ai_run_id: meta.ai_run_id ?? null,
    summary: meta.summary ?? null,
    reason: meta.reason ?? null,
    force_revision: ["checkpoint", "ai_pre_edit", "before_restore"].includes(
      String(meta.reason || ""),
    ),
    state_sha256: sha256(update),
    content_text: text,
    content_truncated: truncated,
    schema_version: schemaVersion,
  };
  const ergebnis = await storeState(docName, payload);
  // Jeder erfolgreiche Store schiebt die Backend-Rev weiter — auch fremde
  // Wege (Checkpoint, Restore, KI). Ohne Nachfuehren meldete der naechste
  // Autosave einen veralteten Stand und liefe ins 409 (Befund 9).
  rememberRev(docName, ergebnis?.rev);
  return ergebnis;
}

export function storeDocument(docName, ydoc, meta = {}) {
  return withLock(docName, async () => {
    try {
      return await storeDocumentUnlocked(docName, ydoc, meta);
    } catch (error) {
      if (error?.code !== "DOC_REV_CONFLICT") throw error;
      // Der Server ist weitergezogen, ohne dass dieser Prozess es merkte
      // (Neustart, wiederhergestellter Stand, kuenftiger Direktschreiber).
      // Ein zweiter Versuch mit derselben Rev liefe wieder in den Konflikt:
      // Zustand holen, als CRDT zusammenfuehren, Rev nachziehen, einmal
      // wiederholen. Ein erneuter Konflikt bleibt sichtbar.
      let zustand;
      try {
        zustand = await loadState(docName);
      } catch (ladeFehler) {
        console.error(
          `Konflikt in ${docName}, Zustand nicht ladbar: ${ladeFehler.message}`,
        );
        throw error;
      }
      if (zustand?.state_b64) {
        Y.applyUpdate(ydoc, new Uint8Array(Buffer.from(zustand.state_b64, "base64")));
      }
      rememberRev(docName, zustand?.rev);
      return await storeDocumentUnlocked(docName, ydoc, meta);
    }
  });
}
