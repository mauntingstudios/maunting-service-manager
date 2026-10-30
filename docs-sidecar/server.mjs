import http from "node:http";
import process from "node:process";

import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { schemaVersion } from "@msm/docs-schema/schema";

import { authenticate } from "./auth.mjs";
import {
  aiUndo,
  contextFor,
  flushAll,
  flushDocument,
  loadedDocuments,
  registerDocument,
  rememberContext,
  resetAiUndo,
  restoreDocument,
  setServer,
  undoAi,
  unregisterDocument,
  withDocument,
} from "./collab.mjs";
import { applyEdits, applyEditsAtomically, structureOf } from "./ai_edit.mjs";
import {
  extractText,
  sha256,
  storeDocument,
  withLock,
  ydocOf,
} from "./persist.mjs";
import { clampText } from "./limits.mjs";
import { renderDocument, renderNodesHtml } from "./render.mjs";
import { aiStoreState, loadState } from "./backend_client.mjs";

const VERSION = process.env.npm_package_version || "1.0.0";
const START = Date.now();
const SERVICE_TOKEN = process.env.MSM_DOCS_SIDECAR_TOKEN || "";
const WS_PORT = Number(process.env.MSM_DOCS_WS_PORT || 8100);
const WS_ADDRESS = process.env.MSM_DOCS_WS_ADDRESS || "127.0.0.1";
const HTTP_PORT = Number(process.env.MSM_DOCS_HTTP_PORT || 8101);
const HTTP_ADDRESS = process.env.MSM_DOCS_HTTP_ADDRESS || "127.0.0.1";

const hocuspocus = new Server({
  port: WS_PORT,
  address: WS_ADDRESS,
  debounce: 2000,
  maxDebounce: 10000,
  async onAuthenticate({ token, documentName, connectionConfig }) {
    const context = await authenticate({ token, documentName });
    rememberContext(documentName, context);
    connectionConfig.readOnly = context.readonly;
    return context;
  },
  async onLoadDocument({ document, documentName, context }) {
    const zustand = await loadState(documentName);
    if (Number(zustand.schema_version || 1) > schemaVersion) {
      const error = new Error("Dokumentschema ist neuer als dieser Sidecar");
      error.code = "DOC_SCHEMA_UNSUPPORTED";
      throw error;
    }
    if (zustand.state_b64) {
      Y.applyUpdate(document, Buffer.from(zustand.state_b64, "base64"));
    }
    registerDocument(documentName, document, context);
    return document;
  },
  async onStoreDocument({ document, documentName, lastContext }) {
    const ydoc = ydocOf(document);
    const bekannt = contextFor(documentName);
    const autor = lastContext?.user_id ?? bekannt.user_id ?? null;
    const familie = lastContext?.fam ?? bekannt.fam ?? null;
    await storeDocument(documentName, ydoc, {
      origin: "autosave",
      author_user_id: autor,
      author_family: familie,
      reason: null,
    });
  },
  async onDisconnect({ documentName }) {
    try {
      await flushDocument(documentName);
    } catch (error) {
      console.error(`letzter Store fuer ${documentName} fehlgeschlagen: ${error.message}`);
    }
  },
  async afterUnloadDocument({ documentName }) {
    // Undo-Manager je Nutzer nicht unbegrenzt ueber entladene Dokumente halten.
    unregisterDocument(documentName);
  },
});

setServer(hocuspocus);

function json(antwort, status, daten) {
  const inhalt = JSON.stringify(daten);
  antwort.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(inhalt),
    "Cache-Control": "no-store",
  });
  antwort.end(inhalt);
}

function bodyLesen(req) {
  return new Promise((resolve, reject) => {
    const teile = [];
    let groesse = 0;
    req.on("data", (teil) => {
      groesse += teil.length;
      if (groesse > 32 * 1024 * 1024) {
        reject(new Error("Anfrage zu gross"));
        req.destroy();
        return;
      }
      teile.push(teil);
    });
    req.on("end", () => {
      if (!teile.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(teile).toString("utf8")));
      } catch (error) {
        reject(new Error(`Ungueltiges JSON: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function tokenOk(req) {
  if (!SERVICE_TOKEN) return false;
  const header = req.headers.authorization || "";
  return header.toLowerCase().startsWith("bearer ") && header.slice(7).trim() === SERVICE_TOKEN;
}

/** Neuer Batch oder Altaufruf mit genau einer Aenderung. */
function editsAusBody(body) {
  if (Array.isArray(body?.edits)) return body.edits;
  if (body?.operation) {
    return [
      {
        op: body.operation,
        markdown: body.markdown,
        target: body.anchor || {},
        expected_text: body.expected_block ?? null,
      },
    ];
  }
  return [];
}

async function aktion(name, req, antwort) {
  const body = await bodyLesen(req);

  if (name === "flush") {
    const ergebnisse = await flushAll();
    return json(antwort, 200, { ok: true, flushed: ergebnisse.length });
  }
  if (name === "disconnect-all") {
    await flushAll();
    for (const docName of loadedDocuments().keys()) {
      hocuspocus.hocuspocus.closeConnections(docName);
    }
    return json(antwort, 200, { ok: true });
  }
  if (name === "health") {
    return json(antwort, 200, {
      status: "ok",
      version: VERSION,
      docs_loaded: loadedDocuments().size,
      uptime: Math.floor((Date.now() - START) / 1000),
    });
  }

  const match = /^\/internal\/docs\/([^/]+)\/(checkpoint|restore|undo-ai|render|structure|ai-preview|ai-edit|disconnect-user|disconnect-doc)$/.exec(
    req.url || "",
  );
  if (!match) {
    return json(antwort, 404, { error: "unbekannter Pfad" });
  }
  const docName = decodeURIComponent(match[1]);
  const was = match[2];
  const meta = {
    user_id: body.user_id ?? null,
    family: body.family ?? null,
  };

  if (was === "checkpoint") {
    const ergebnis = await withDocument(
      docName,
      (ydoc) =>
        storeDocument(docName, ydoc, {
          origin: `user:${meta.user_id || "system"}`,
          author_user_id: meta.user_id,
          author_family: meta.family,
          reason: "checkpoint",
          summary: body.label || null,
        }),
      { user_id: meta.user_id, fam: meta.family },
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "restore") {
    const ergebnis = await withLock(
      docName,
      () =>
        restoreDocument(docName, body.state_b64 || "", {
          origin: `user:${meta.user_id || "system"}`,
          author_user_id: meta.user_id,
          author_family: meta.family,
        }),
      { waitMs: 3000 },
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "undo-ai") {
    const ergebnis = await withLock(
      docName,
      async () => {
        await withDocument(docName, () => undefined, {});
        return undoAi(docName, {
          author_user_id: meta.user_id,
          author_family: meta.family,
          userId: meta.user_id,
        });
      },
      { waitMs: 3000 },
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "render") {
    if (body.state_b64) {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, Buffer.from(body.state_b64, "base64"));
      const inhalt = renderDocument(ydoc, body.format || "html", body.titel || "Dokument");
      return json(antwort, 200, {
        content: inhalt,
        mime:
          body.format === "md"
            ? "text/markdown; charset=utf-8"
            : body.format === "txt"
              ? "text/plain; charset=utf-8"
              : "text/html; charset=utf-8",
      });
    }
    const ergebnis = await withDocument(
      docName,
      (ydoc) => ({
        content: renderDocument(ydoc, body.format || "html", body.titel || "Dokument"),
        mime:
          body.format === "md"
            ? "text/markdown; charset=utf-8"
            : body.format === "txt"
              ? "text/plain; charset=utf-8"
              : "text/html; charset=utf-8",
      }),
      {},
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "structure") {
    const offset = Math.max(0, Number(body.offset) || 0);
    const limit = Math.min(300, Math.max(1, Number(body.limit) || 120));
    const ergebnis = await withDocument(
      docName,
      (ydoc) =>
        structureOf(ydoc.getXmlFragment("default"), { offset, limit }),
      { user_id: meta.user_id, fam: meta.family },
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "ai-preview") {
    // Nur lesen: der Klon nimmt die Aenderungen auf, das Live-Dokument bleibt
    // unberuehrt. Deshalb hier bewusst **kein** Store — sonst entstuende eine
    // Revision, die alle Mitarbeiter im Verlauf saehen.
    const edits = editsAusBody(body);
    const ergebnis = await withDocument(
      docName,
      (ydoc) => {
        const klon = new Y.Doc();
        Y.applyUpdate(klon, Y.encodeStateAsUpdate(ydoc));
        try {
          // Schrittweise anwenden und sofort rendern: nur in diesem Moment
          // stimmen die Indizes. Ein spaeterer Einfuegungsschritt wuerde die
          // Auswahl eines frueheren sonst verschieben.
          const warnings = [];
          const merker = new Map();
          const vorschauen = edits.map((edit, index) => {
            const schritt = applyEdits(klon, {
              edits: [edit],
              runId: body.run_id,
              callId: body.call_id,
              userId: meta.user_id,
              warnings,
              merker,
            });
            const eintrag = schritt.edits[0];
            const knoten = klon.getXmlFragment("default").toArray();
            let html = "";
            if (eintrag.op === "replace_text") {
              html = renderNodesHtml([knoten[eintrag.target_index]], true);
            } else if (eintrag.op !== "delete_block") {
              html = renderNodesHtml(
                knoten.slice(
                  eintrag.target_index,
                  eintrag.target_index + eintrag.inserted_count,
                ),
                true,
              );
            }
            return {
              index,
              op: eintrag.op,
              html,
              target_index: eintrag.target_index,
              target_fingerprint: eintrag.target_fingerprint,
            };
          });
          return {
            ok: true,
            edits: vorschauen,
            html: vorschauen
              .map((vorschau) => vorschau.html)
              .filter(Boolean)
              .join(""),
            warnings,
          };
        } finally {
          klon.destroy();
        }
      },
      { user_id: meta.user_id, fam: meta.family },
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "ai-edit") {
    const edits = editsAusBody(body);
    // Das Lock umfasst Pruefung, Anwendung und den atomaren Store. Der
    // Autosave nutzt denselben Schluessel und wartet; eine zweite KI-Anfrage
    // bekommt nach kurzer Frist AI_EDIT_BUSY, statt spaeter still zu wirken.
    const ergebnis = await withLock(
      docName,
      () =>
        withDocument(
          docName,
          async (ydoc) => {
            const awareness = ydoc?.awareness;
            try {
              // Virtueller Mitbearbeiter: die Oberflaeche zeigt waehrend der
              // KI-Aenderung einen eigenen Cursor, ohne einen echten Nutzer zu
              // erfinden.
              awareness?.setLocalStateField?.("user", {
                name: "Singra",
                color: "#a855f7",
                ai: true,
              });
              const pre = Y.encodeStateAsUpdate(ydoc);
              const preText = extractText(ydoc);
              // Manager vor der Transaktion anlegen, sonst erfasst er sie nicht.
              aiUndo(docName, ydoc, meta.user_id);

              // Pruefung auf einem Klon, dann Anwendung ohne `await`
              // dazwischen. Wirft die Anwendung wider Erwarten, stellt
              // `applyEditsAtomically` den Pre-Zustand wieder her.
              let bearbeitet;
              try {
                ({ result: bearbeitet } = applyEditsAtomically(
                  ydoc,
                  {
                    edits,
                    runId: body.run_id,
                    callId: body.call_id,
                    userId: meta.user_id,
                  },
                  { pre },
                ));
              } catch (error) {
                // Nur wenn die Live-Anwendung wirklich lief und
                // zurueckgerollt wurde, ist der Undo-Stapel belastet.
                if (error.applied) resetAiUndo(docName, meta.user_id);
                throw error;
              }

              const post = Y.encodeStateAsUpdate(ydoc);
              const { text, truncated } = clampText(extractText(ydoc));
              const gespeichert = await aiStoreState(docName, {
                pre_state_b64: Buffer.from(pre).toString("base64"),
                pre_state_sha256: sha256(pre),
                state_b64: Buffer.from(post).toString("base64"),
                state_sha256: sha256(post),
                pre_content_text: preText,
                content_text: text,
                content_truncated: truncated,
                origin: bearbeitet.origin,
                author_user_id: meta.user_id,
                author_family: meta.family,
                ai_run_id: body.run_id || null,
                summary: body.summary || "KI-Aenderung",
                edits_applied: bearbeitet.edits.length,
                schema_version: schemaVersion,
              });
              // `target_text` ist nur fuer die interne Pruefung da; im
              // Werkzeugergebnis waere ein langer Altblock nur Ballast.
              return {
                ...bearbeitet,
                edits: bearbeitet.edits.map(
                  ({ target_text: _targetText, ...eintrag }) => eintrag,
                ),
                ...gespeichert,
              };
            } finally {
              awareness?.setLocalStateField?.("user", null);
            }
          },
          { user_id: meta.user_id, fam: meta.family },
        ),
      { waitMs: 3000 },
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "disconnect-user") {
    const ziel = Number(body.user_id);
    const kern = hocuspocus.hocuspocus;
    const doc = kern?.documents?.get?.(docName);
    let getroffen = 0;
    if (doc?.connections) {
      for (const conn of doc.connections.keys()) {
        if (Number(conn?.context?.user_id) === ziel) {
          getroffen += 1;
          try {
            conn.close({ code: 4403, reason: "Recht entzogen" });
          } catch {
            /* Verbindung schon zu. */
          }
        }
      }
    }
    if (!getroffen) {
      // Unbekannter Zustand (andere Hocuspocus-Version): lieber alle trennen,
      // als einen entzogenen Zugriff weiterleben zu lassen.
      kern?.closeConnections?.(docName);
    }
    return json(antwort, 200, { ok: true, disconnected: getroffen });
  }

  if (was === "disconnect-doc") {
    try {
      await flushDocument(docName);
    } finally {
      hocuspocus.hocuspocus.closeConnections(docName);
    }
    return json(antwort, 200, { ok: true });
  }

  return json(antwort, 404, { error: "unbekannte Aktion" });
}

const httpServer = http.createServer(async (req, res) => {
  const url = req.url || "";
  if (req.method === "GET" && url === "/health") {
    return json(res, 200, { status: "ok" });
  }
  if (!url.startsWith("/internal/docs")) {
    return json(res, 404, { error: "nicht gefunden" });
  }
  if (!tokenOk(req)) {
    return json(res, SERVICE_TOKEN ? 401 : 503, {
      error: SERVICE_TOKEN ? "Service-Token fehlt oder falsch" : "Dienst nicht eingerichtet",
    });
  }
  if (req.method === "GET" && url === "/internal/docs/health") {
    return json(res, 200, {
      status: "ok",
      version: VERSION,
      docs_loaded: loadedDocuments().size,
      uptime: Math.floor((Date.now() - START) / 1000),
    });
  }
  if (req.method !== "POST") {
    return json(res, 405, { error: "Methode nicht erlaubt" });
  }
  const name = url === "/internal/docs/flush"
    ? "flush"
    : url === "/internal/docs/disconnect-all"
      ? "disconnect-all"
      : "";
  try {
    await aktion(name, req, res);
  } catch (error) {
    // Konflikte sind erwartbar und fuer das Modell aufloesbar; nur echte
    // Fehler bleiben 500.
    const konflikte = new Set([
      "AI_EDIT_STALE_SELECTION",
      "AI_EDIT_TARGET_AMBIGUOUS",
      "AI_EDIT_TARGET_NOT_FOUND",
      "AI_EDIT_UNSAFE_MARKS",
      "AI_EDIT_BUSY",
      "AI_UNDO_UNAVAILABLE",
    ]);
    const ungueltig = new Set(["DOC_INVALID_TARGET", "AI_EDIT_BATCH_TOO_LARGE"]);
    const status = konflikte.has(error.code)
      ? 409
      : ungueltig.has(error.code)
        ? 422
        : 500;
    json(res, status, {
      error: error.message,
      code: error.code || null,
      candidates: error.candidates?.length ? error.candidates : undefined,
      edit_index: error.editIndex ?? undefined,
    });
  }
});

async function start() {
  await hocuspocus.listen();
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(HTTP_PORT, HTTP_ADDRESS, resolve);
  });
  console.log(
    `docs-sidecar ${VERSION} bereit: ws=${WS_ADDRESS}:${WS_PORT} http=${HTTP_ADDRESS}:${HTTP_PORT}`,
  );
}

let beendet = false;
async function shutdown(signal) {
  if (beendet) return;
  beendet = true;
  console.log(`docs-sidecar beendet (${signal})`);
  try {
    await flushAll();
  } catch (error) {
    console.error(`Flush beim Beenden fehlgeschlagen: ${error.message}`);
  }
  httpServer.close();
  try {
    await hocuspocus.destroy();
  } catch (error) {
    console.error(`Hocuspocus beenden fehlgeschlagen: ${error.message}`);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((error) => {
  console.error(`Start fehlgeschlagen: ${error.stack || error.message}`);
  process.exit(1);
});
