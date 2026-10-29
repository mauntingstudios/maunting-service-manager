import * as Y from "yjs";
import { schemaVersion } from "@msm/docs-schema/schema";

import { loadState } from "./backend_client.mjs";
import { storeDocument, ydocOf } from "./persist.mjs";

const loaded = new Map();
const contexts = new Map();
const undoManagers = new Map();

let serverRef = null;

export function setServer(server) {
  serverRef = server;
}

export function registerDocument(name, ydoc, context) {
  loaded.set(name, ydoc);
  rememberContext(name, context);
  aiUndo(name, ydoc);
  return ydoc;
}

export function contextFor(name) {
  return contexts.get(name) || {};
}

export function unregisterDocument(name) {
  loaded.delete(name);
  undoManagers.delete(name);
}

export function rememberContext(name, context) {
  // Nur ein schreibberechtigter Kontext darf den Autor eines Stores setzen.
  // Sonst ueberschriebe der zuletzt verbundene Betrachter den Editor, und der
  // naechste Autosave liefe mit einer Viewer-Rolle ins 403.
  if (context && !context.readonly) contexts.set(name, context);
}

export async function loadDocument(name) {
  const vorhanden = loaded.get(name);
  if (vorhanden) return vorhanden;
  const zustand = await loadState(name);
  if (Number(zustand.schema_version || 1) > schemaVersion) {
    const error = new Error("Dokumentschema ist neuer als dieser Sidecar");
    error.code = "DOC_SCHEMA_UNSUPPORTED";
    throw error;
  }
  const ydoc = new Y.Doc();
  if (zustand.state_b64) {
    Y.applyUpdate(ydoc, Buffer.from(zustand.state_b64, "base64"));
  }
  return registerDocument(name, ydoc, { rev: zustand.rev });
}

/**
 * Yjs erwartet fuer `trackedOrigins` eine Set-artige Struktur (es ruft
 * `.add(undoManager)` im Konstruktor). Eine Funktion wird nicht unterstuetzt.
 * Diese Struktur trackt alles, dessen Origin mit `ai:` beginnt.
 */
class AiOriginSet {
  constructor() {
    this.werte = new Set();
  }

  add(wert) {
    this.werte.add(wert);
  }

  delete(wert) {
    return this.werte.delete(wert);
  }

  has(wert) {
    if (this.werte.has(wert)) return true;
    return typeof wert === "string" && wert.startsWith("ai:");
  }

  [Symbol.iterator]() {
    return this.werte[Symbol.iterator]();
  }
}

export function aiUndo(name, ydoc) {
  const vorhanden = undoManagers.get(name);
  // Ein neuer Hocuspocus-Lebenszyklus bringt ein neues Y.Doc. Ein Manager vom
  // alten Dokument wuerde dessen Aenderungen verfolgen; nach einem Reload
  // waere "Letzte KI-Aenderung rueckgaengig" still wirkungslos.
  if (vorhanden && vorhanden.ydoc === ydoc) return vorhanden.manager;
  const manager = new Y.UndoManager(ydoc.getXmlFragment("default"), {
    captureTimeout: 0,
    trackedOrigins: new AiOriginSet(),
  });
  undoManagers.set(name, { ydoc, manager });
  return manager;
}

export async function flushDocument(name, meta = {}) {
  const ydoc = loaded.get(name);
  if (!ydoc) return { stored: false, rev: 0 };
  const context = contextFor(name);
  return storeDocument(name, ydoc, {
    origin: meta.origin || "autosave",
    author_user_id: meta.author_user_id ?? context.user_id ?? null,
    author_family: meta.author_family ?? context.fam ?? null,
    ai_run_id: meta.ai_run_id ?? null,
    summary: meta.summary ?? null,
    reason: meta.reason ?? null,
  });
}

export async function flushAll() {
  const ergebnisse = [];
  for (const [name] of loaded) {
    try {
      ergebnisse.push([name, await flushDocument(name)]);
    } catch (error) {
      console.error(`flush ${name} fehlgeschlagen: ${error.message}`);
    }
  }
  return ergebnisse;
}

function kern() {
  return serverRef?.hocuspocus || serverRef;
}

function direkteVerbindung(name, context) {
  const instanz = kern();
  if (!instanz || typeof instanz.openDirectConnection !== "function") {
    return null;
  }
  return instanz.openDirectConnection(name, context || {});
}

export async function withDocument(name, fn, context = {}) {
  const vorhanden = loaded.get(name);
  if (vorhanden) {
    contextFor(name);
    return fn(vorhanden);
  }
  const verbindung = direkteVerbindung(name, context);
  if (!verbindung) {
    throw new Error("Dokument ist nicht geladen und der Server erlaubt keine Direktverbindung");
  }
  const conn = await verbindung;
  try {
    let ergebnis;
    await conn.transact((document) => {
      const ydoc = ydocOf(document);
      registerDocument(name, ydoc, context);
      ergebnis = fn(ydoc);
    });
    return ergebnis;
  } finally {
    if (typeof conn.disconnect === "function") {
      await conn.disconnect();
    }
  }
}

export async function restoreDocument(name, stateB64, meta = {}) {
  const ziel = new Y.Doc();
  Y.applyUpdate(ziel, Buffer.from(stateB64, "base64"));
  return withDocument(
    name,
    async (ydoc) => {
      const live = ydoc.getXmlFragment("default");
      const quelle = ziel.getXmlFragment("default");
      ydoc.transact(() => {
        if (live.length > 0) live.delete(0, live.length);
        if (quelle.length === 0) return;
        const kopien = quelle
          .toArray()
          .map((node) => (typeof node.clone === "function" ? node.clone() : node));
        live.insert(0, kopien);
      }, meta.origin || "restore");
      return storeDocument(name, ydoc, {
        origin: meta.origin || "restore",
        author_user_id: meta.author_user_id ?? null,
        author_family: meta.author_family ?? null,
        reason: "restore",
        summary: meta.summary ?? null,
      });
    },
    meta,
  );
}

export async function undoAi(name, meta = {}) {
  const ydoc = loaded.get(name);
  if (!ydoc) return { undone: false };
  const manager = aiUndo(name, ydoc);
  if (!manager.canUndo()) return { undone: false };
  manager.undo();
  const gespeichert = await storeDocument(name, ydoc, {
    origin: "ai:undo",
    author_user_id: meta.author_user_id ?? null,
    author_family: meta.author_family ?? null,
    reason: "ai_undo",
  });
  return { undone: true, ...gespeichert };
}

export function loadedDocuments() {
  return loaded;
}
