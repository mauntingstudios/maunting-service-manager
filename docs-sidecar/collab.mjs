import * as Y from "yjs";
import { schemaVersion } from "@msm/docs-schema/schema";

import { loadState } from "./backend_client.mjs";
import {
  restoreFragment,
  storeDocument,
  storeDocumentUnlocked,
  ydocOf,
} from "./persist.mjs";

const loaded = new Map();
const contexts = new Map();
const undoManagers = new Map();
const MAX_UNDO_NUTZER = 50;

let serverRef = null;

export function setServer(server) {
  serverRef = server;
}

export function registerDocument(name, ydoc, context) {
  loaded.set(name, ydoc);
  rememberContext(name, context);
  return ydoc;
}

export function contextFor(name) {
  return contexts.get(name) || {};
}

function undoEintragLoeschen(name) {
  const eintrag = undoManagers.get(name);
  if (!eintrag) return;
  for (const nutzer of eintrag.byUser.values()) {
    try {
      nutzer.manager.destroy();
    } catch {
      /* Manager war schon weg. */
    }
  }
  undoManagers.delete(name);
}

export function unregisterDocument(name) {
  loaded.delete(name);
  undoEintragLoeschen(name);
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
 * Diese Struktur trackt nur Origins eines Nutzers: `ai:<userId>:`.
 */
class AiOriginSet {
  constructor(prefix) {
    this.prefix = prefix;
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
    return typeof wert === "string" && wert.startsWith(this.prefix);
  }

  [Symbol.iterator]() {
    return this.werte[Symbol.iterator]();
  }
}

/**
 * Ein Undo-Manager pro Dokument und Nutzer.
 *
 * Frueher war der Manager dokumentweit; damit konnte jeder Editor die letzte
 * KI-Aenderung eines anderen zuruecknehmen. Der Origin traegt deshalb die
 * Nutzer-ID, und jeder Manager verfolgt nur sein eigenes Praefix. Der Manager
 * muss **vor** der Transaktion angelegt werden, sonst erfasst er sie nicht.
 */
export function aiUndo(name, ydoc, userId) {
  const key = String(userId ?? "anon");
  let eintrag = undoManagers.get(name);
  // Ein neuer Hocuspocus-Lebenszyklus bringt ein neues Y.Doc. Manager vom
  // alten Dokument wuerden dessen Aenderungen verfolgen; nach einem Reload
  // waere "Letzte KI-Aenderung rueckgaengig" still wirkungslos.
  if (!eintrag || eintrag.ydoc !== ydoc) {
    if (eintrag) undoEintragLoeschen(name);
    eintrag = { ydoc, byUser: new Map() };
    undoManagers.set(name, eintrag);
  }

  let nutzer = eintrag.byUser.get(key);
  if (!nutzer) {
    const manager = new Y.UndoManager(ydoc.getXmlFragment("default"), {
      captureTimeout: 0,
      trackedOrigins: new AiOriginSet(`ai:${key}:`),
    });
    nutzer = { manager, usedAt: Date.now() };
    eintrag.byUser.set(key, nutzer);
    if (eintrag.byUser.size > MAX_UNDO_NUTZER) {
      let aeltester = null;
      for (const [kandidat, wert] of eintrag.byUser) {
        if (kandidat === key) continue;
        if (!aeltester || wert.usedAt < aeltester[1].usedAt) {
          aeltester = [kandidat, wert];
        }
      }
      if (aeltester) {
        aeltester[1].manager.destroy();
        eintrag.byUser.delete(aeltester[0]);
      }
    }
  }
  nutzer.usedAt = Date.now();
  return nutzer.manager;
}

/**
 * Verwirft den Undo-Verlauf eines Nutzers.
 *
 * Nach einem wider Erwarten doch angewandten und zurueckgerollten Batch
 * stuende sonst ein Eintrag im Stapel, der nie sichtbar wurde.
 */
export function resetAiUndo(name, userId) {
  const eintrag = undoManagers.get(name);
  if (!eintrag) return;
  const key = String(userId ?? "anon");
  const nutzer = eintrag.byUser.get(key);
  if (!nutzer) return;
  try {
    nutzer.manager.destroy();
  } catch {
    /* Manager war schon weg. */
  }
  eintrag.byUser.delete(key);
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
  return withDocument(
    name,
    async (ydoc) => {
      restoreFragment(
        ydoc,
        Buffer.from(stateB64, "base64"),
        meta.origin || "restore",
      );
      return storeDocumentUnlocked(name, ydoc, {
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
  if (!ydoc) return { undone: false, code: "AI_UNDO_UNAVAILABLE" };
  const key = String(meta.userId ?? meta.author_user_id ?? "anon");
  const eintrag = undoManagers.get(name);
  const nutzer =
    eintrag && eintrag.ydoc === ydoc ? eintrag.byUser.get(key) : null;
  if (!nutzer || !nutzer.manager.canUndo()) {
    return { undone: false, code: "AI_UNDO_UNAVAILABLE" };
  }
  nutzer.manager.undo();
  // Das Lock haelt der Aufrufer (Server); hier deshalb der ungelockte Store.
  const gespeichert = await storeDocumentUnlocked(name, ydoc, {
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
