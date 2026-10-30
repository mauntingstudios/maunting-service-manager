import http from "node:http";
import process from "node:process";

import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { schemaVersion } from "@msm/docs-schema/schema";

import { authenticate } from "./auth.mjs";
import {
  contextFor,
  flushAll,
  flushDocument,
  loadDocument,
  loadedDocuments,
  registerDocument,
  rememberContext,
  restoreDocument,
  setServer,
  undoAi,
  withDocument,
} from "./collab.mjs";
import { applyAiEdit, AiEditError } from "./ai_edit.mjs";
import { storeDocument, ydocOf } from "./persist.mjs";
import { renderDocument, renderNodesHtml } from "./render.mjs";
import { loadState } from "./backend_client.mjs";

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

  const match = /^\/internal\/docs\/([^/]+)\/(checkpoint|restore|undo-ai|render|ai-preview|ai-edit|disconnect-user|disconnect-doc)$/.exec(
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
    const ergebnis = await restoreDocument(docName, body.state_b64 || "", {
      origin: `user:${meta.user_id || "system"}`,
      author_user_id: meta.user_id,
      author_family: meta.family,
    });
    return json(antwort, 200, ergebnis);
  }

  if (was === "undo-ai") {
    await withDocument(docName, () => undefined, {});
    const ergebnis = await undoAi(docName, {
      author_user_id: meta.user_id,
      author_family: meta.family,
    });
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

  if (was === "ai-preview") {
    // Nur lesen: der Klon nimmt die Aenderung auf, das Live-Dokument bleibt
    // unberuehrt. Deshalb hier bewusst **kein** `storeDocument` — sonst
    // entstuende eine Revision, die alle Mitarbeiter im Verlauf saehen.
    const ergebnis = await withDocument(
      docName,
      async (ydoc) => {
        const klon = new Y.Doc();
        Y.applyUpdate(klon, Y.encodeStateAsUpdate(ydoc));
        try {
          const bearbeitet = applyAiEdit(klon, {
            operation: body.operation,
            markdown: body.markdown,
            anchor: body.anchor,
            runId: body.run_id,
            callId: body.call_id,
            expectedBlock: body.expected_block ?? null,
          });
          const fragment = klon.getXmlFragment("default");
          const knoten = fragment
            .toArray()
            .slice(
              bearbeitet.target_index,
              bearbeitet.target_index + bearbeitet.inserted_count,
            );
          return {
            ok: true,
            html: renderNodesHtml(knoten, true),
            target_block: bearbeitet.target_block,
            target_index: bearbeitet.target_index,
          };
        } catch (error) {
          if (error instanceof AiEditError) {
            const fehler = new Error(error.message);
            fehler.code = error.code;
            fehler.candidates = error.candidates;
            throw fehler;
          }
          throw error;
        } finally {
          klon.destroy();
        }
      },
      { user_id: meta.user_id, fam: meta.family },
    );
    return json(antwort, 200, ergebnis);
  }

  if (was === "ai-edit") {
    const ergebnis = await withDocument(
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
          await storeDocument(docName, ydoc, {
            origin: `user:${meta.user_id || "ai"}`,
            author_user_id: meta.user_id,
            author_family: meta.family,
            reason: "ai_pre_edit",
            ai_run_id: body.run_id || null,
            summary: "Vor KI-Aenderung",
          });
          let bearbeitet;
          try {
            bearbeitet = applyAiEdit(ydoc, {
              operation: body.operation,
              markdown: body.markdown,
              anchor: body.anchor,
              runId: body.run_id,
              callId: body.call_id,
              expectedBlock: body.expected_block ?? null,
            });
          } catch (error) {
            if (error instanceof AiEditError) {
              const fehler = new Error(error.message);
              fehler.code = error.code;
              fehler.candidates = error.candidates;
              throw fehler;
            }
            throw error;
          }
          const gespeichert = await storeDocument(docName, ydoc, {
            origin: bearbeitet.origin,
            author_user_id: meta.user_id,
            author_family: meta.family,
            reason: "ai_edit",
            ai_run_id: body.run_id || null,
            summary: body.summary || "KI-Aenderung",
          });
          return { ...bearbeitet, ...gespeichert };
        } finally {
          awareness?.setLocalStateField?.("user", null);
        }
      },
      { user_id: meta.user_id, fam: meta.family },
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
    const status = error.code === "AI_EDIT_STALE_SELECTION" ? 409 : 500;
    json(res, status, {
      error: error.message,
      code: error.code || null,
      candidates: error.candidates || undefined,
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
