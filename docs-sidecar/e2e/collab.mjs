/**
 * Zwei echte Yjs-Clients gegen den echten Hocuspocus-Sidecar.
 *
 * Der Backend-Teil ist ein winziger Fake: authorize, load (leer) und store.
 * Damit prueft der Lauf die Kette, die im Betrieb zaehlt — JWT, Read-only,
 * Yjs-Konvergenz und den Store-Aufruf mit Hash und Text — ohne PostgreSQL.
 *
 * Start: node e2e/collab.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR = path.resolve(HIER, "..");
const SERVICE_TOKEN = "e2e-service-token";
const COLLAB_SECRET = "e2e-collab-secret-32-characters!!!";
const BACKEND_PORT = 18180;
const WS_PORT = 18190;
const HTTP_PORT = 18191;
const DOC = "doc-e2e";

const speicher = [];
let rev = 0;
let aiStores = 0;

function json(antwort, status, daten) {
  const text = JSON.stringify(daten);
  antwort.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  antwort.end(text);
}

function backendStart() {
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) {
      return json(res, 401, { error: "token" });
    }
    if (req.method === "POST" && req.url === "/internal/docs/authorize") {
      let body = "";
      for await (const teil of req) body += teil;
      const daten = JSON.parse(body || "{}");
      const readonly = daten.role !== "editor" && daten.user_id !== 1;
      return json(res, 200, {
        ok: true,
        readonly,
        role: readonly ? "viewer" : "editor",
        team_id: 1,
        rev,
        module_enabled: true,
        user: { id: daten.user_id, username: `u${daten.user_id}` },
        schema_version: 1,
      });
    }
    if (req.method === "GET" && req.url === `/internal/docs/${DOC}/state`) {
      return json(res, 200, {
        state_b64: "",
        rev,
        schema_version: 1,
        state_sha256: null,
      });
    }
    if (req.method === "POST" && req.url === `/internal/docs/${DOC}/store`) {
      let body = "";
      for await (const teil of req) body += teil;
      const daten = JSON.parse(body || "{}");
      speicher.push(daten);
      rev += 1;
      return json(res, 200, { stored: true, rev, revision_rev: rev });
    }
    if (req.method === "POST" && req.url === `/internal/docs/${DOC}/ai-store`) {
      let body = "";
      for await (const teil of req) body += teil;
      const daten = JSON.parse(body || "{}");
      aiStores += 1;
      speicher.push({ ...daten, reason: "ai_edit" });
      rev += 1;
      return json(res, 200, {
        stored: true,
        rev,
        revision_rev: rev,
        pre_revision_rev: rev - 1,
      });
    }
    return json(res, 404, { error: "unbekannt", url: req.url });
  });
  return new Promise((resolve) => {
    server.listen(BACKEND_PORT, "127.0.0.1", () => resolve(server));
  });
}

function token(userId, role = "editor") {
  return jwt.sign(
    {
      iss: "msm",
      aud: "msm-docs",
      sub: String(userId),
      doc: DOC,
      team: 1,
      role,
      ro: role !== "editor",
      fam: `fam-${userId}`,
      jti: `jti-${userId}`,
    },
    COLLAB_SECRET,
    { algorithm: "HS256", expiresIn: "10m" },
  );
}

async function warte(pfad, versuche = 40) {
  for (let i = 0; i < versuche; i += 1) {
    try {
      const antwort = await fetch(`http://127.0.0.1:${HTTP_PORT}${pfad}`);
      if (antwort.ok) return;
    } catch {
      /* noch nicht bereit */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Sidecar antwortet nicht auf ${pfad}`);
}

function verbinde(ydoc, userId, role = "editor") {
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${WS_PORT}`,
    name: DOC,
    document: ydoc,
    token: token(userId, role),
  });
  return provider;
}

function synced(provider) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Sync-Timeout")), 10_000);
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function text(ydoc) {
  return ydoc
    .getXmlFragment("default")
    .toArray()
    .map((node) => node.toString())
    .join("\n");
}

async function warteAuf(predicate, timeout = 8000) {
  const ende = Date.now() + timeout;
  while (Date.now() < ende) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Bedingung nicht erreicht");
}

function einfuegen(ydoc, wert, origin = "user") {
  const fragment = ydoc.getXmlFragment("default");
  const absatz = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  absatz.insert(0, [t]);
  ydoc.transact(() => {
    fragment.insert(fragment.length, [absatz]);
    t.insert(0, wert);
  }, origin);
}

console.error("e2e: starte Backend");
const backend = await backendStart();
console.error("e2e: Backend laeuft");
const sidecar = spawn(process.execPath, ["server.mjs"], {
  cwd: SIDECAR,
  env: {
    ...process.env,
    MSM_DOCS_WS_PORT: String(WS_PORT),
    MSM_DOCS_HTTP_PORT: String(HTTP_PORT),
    MSM_DOCS_SIDECAR_TOKEN: SERVICE_TOKEN,
    MSM_DOCS_COLLAB_SECRET: COLLAB_SECRET,
    MSM_BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
sidecar.stderr.on("data", (d) => process.stderr.write(`[sidecar] ${d}`));

const providers = [];
try {
  console.error("e2e: warte auf Sidecar");
  await warte("/health");
  console.error("e2e: Sidecar bereit");

  const a = new Y.Doc();
  const b = new Y.Doc();
  const viewer = new Y.Doc();
  const pa = verbinde(a, 1, "editor");
  const pb = verbinde(b, 2, "editor");
  const pv = verbinde(viewer, 3, "viewer");
  providers.push(pa, pb, pv);
  console.error("e2e: verbinde Clients");
  await Promise.all([synced(pa), synced(pb), synced(pv)]);
  console.error("e2e: Clients synchron");

  einfuegen(a, "Hallo von A");
  await warteAuf(() => text(b).includes("Hallo von A"));
  assert.match(text(b), /Hallo von A/);

  // Struktur fuer das Modell: Indizes, Pfad und Fingerabdruck.
  const strukturAntwort = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/internal/docs/${DOC}/structure`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ offset: 0, limit: 20 }),
    },
  );
  const strukturText = await strukturAntwort.text();
  assert.equal(strukturAntwort.status, 200, strukturText);
  const struktur = JSON.parse(strukturText);
  assert.ok(struktur.blocks.length > 0);
  assert.match(struktur.blocks[0].fingerprint, /^[0-9a-f]{12}$/);
  assert.equal(struktur.blocks[0].text, "Hallo von A");

  // Vorschau wendet den Batch nur auf einem Klon an und haelt die Reihenfolge.
  const vorschauAntwort = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/internal/docs/${DOC}/ai-preview`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        edits: [
          {
            op: "insert_after",
            target: { fingerprint: struktur.blocks[0].fingerprint, index: 0 },
            markdown: "Eins",
          },
          {
            op: "insert_after",
            target: { fingerprint: struktur.blocks[0].fingerprint, index: 0 },
            markdown: "Zwei",
          },
        ],
        run_id: "run-vorschau",
        user_id: 1,
      }),
    },
  );
  const vorschauText = await vorschauAntwort.text();
  assert.equal(vorschauAntwort.status, 200, vorschauText);
  const vorschau = JSON.parse(vorschauText);
  assert.match(vorschau.edits[0].html, /Eins/);
  assert.match(vorschau.edits[1].html, /Zwei/);
  assert.match(vorschau.html, /Eins[\s\S]*Zwei/);
  assert.doesNotMatch(text(a), /Eins/);
  assert.doesNotMatch(text(b), /Eins/);

  // Viewer schreibt lokal; der Server darf es nicht annehmen.
  einfuegen(viewer, "Verboten vom Viewer");
  await new Promise((r) => setTimeout(r, 700));
  assert.doesNotMatch(text(a), /Verboten vom Viewer/);

  // Der regulaere Hocuspocus-Store (Debounce) muss ebenfalls ankommen.
  await warteAuf(() => speicher.length > 0, 8000);
  assert.match(speicher[0].content_text, /Hallo von A/);

  // KI schreibt direkt in einer Yjs-Transaktion und laesst sich zuruecknehmen.
  const kiAntwort = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/internal/docs/${DOC}/ai-edit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        edits: [
          {
            op: "append",
            markdown: "## KI-Abschnitt\n\nText von Singra",
          },
          {
            op: "append",
            markdown: "Zweiter Absatz von Singra",
          },
        ],
        run_id: "run-e2e",
        call_id: "call-e2e",
        summary: "Zwei Aenderungen",
        user_id: 1,
      }),
    },
  );
  assert.equal(kiAntwort.status, 200, await kiAntwort.text());
  await warteAuf(
    () =>
      text(a).includes("Text von Singra") &&
      text(a).includes("Zweiter Absatz von Singra"),
  );
  assert.match(text(b), /Text von Singra/);
  assert.match(text(b), /Zweiter Absatz von Singra/);
  // Der ganze Batch landet in genau einem atomaren Store.
  assert.equal(aiStores, 1);

  const undo = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/internal/docs/${DOC}/undo-ai`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: 1 }),
    },
  );
  assert.equal(undo.status, 200, await undo.text());
  await warteAuf(
    () =>
      !text(a).includes("Text von Singra") &&
      !text(a).includes("Zweiter Absatz von Singra"),
  );

  // Wiederherstellung eines frueheren Zustands als Diff auf das Live-Dokument.
  const ziel = Buffer.from(Y.encodeStateAsUpdate(a)).toString("base64");
  einfuegen(a, "Nur voruebergehend");
  await warteAuf(() => text(b).includes("Nur voruebergehend"));
  const wiederhergestellt = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/internal/docs/${DOC}/restore`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state_b64: ziel, user_id: 1 }),
    },
  );
  assert.equal(wiederhergestellt.status, 200, await wiederhergestellt.text());
  await warteAuf(() => !text(b).includes("Nur voruebergehend"));
  assert.match(text(b), /Hallo von A/);

  // Sofort speichern statt auf den Debounce zu warten.
  const gespeichert = await fetch(
    `http://127.0.0.1:${HTTP_PORT}/internal/docs/${DOC}/checkpoint`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: 1, reason: "checkpoint" }),
    },
  );
  assert.equal(gespeichert.status, 200, await gespeichert.text());

  await warteAuf(() => speicher.length > 0);
  const letzter = speicher[speicher.length - 1];
  assert.match(letzter.content_text, /Hallo von A/);
  assert.ok(letzter.state_sha256);
  assert.ok(letzter.state_b64);
  console.log(`ok: zwei Clients konvergiert, Viewer abgewiesen, Store rev=${rev}`);
} finally {
  for (const provider of providers) {
    try {
      provider.destroy();
    } catch {
      /* bereits getrennt */
    }
  }
  sidecar.kill("SIGTERM");
  await once(sidecar, "exit").catch(() => {});
  backend.close();
}
