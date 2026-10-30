import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

process.env.MSM_BACKEND_URL = "http://backend.test";
process.env.MSM_DOCS_SIDECAR_TOKEN = "service-token";

const { extractText, sha256, storeDocument, withLock } = await import(
  "../persist.mjs"
);

function dokument() {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const h = new Y.XmlElement("heading");
  h.setAttribute("level", "2");
  const ht = new Y.XmlText();
  ht.insert(0, "Abschnitt");
  h.insert(0, [ht]);
  const p = new Y.XmlElement("paragraph");
  const pt = new Y.XmlText();
  pt.insert(0, "Ein Satz.");
  p.insert(0, [pt]);
  fragment.insert(0, [h, p]);
  return ydoc;
}

test("extractText liest Ueberschrift und Absatz", () => {
  const text = extractText(dokument());
  assert.match(text, /Abschnitt/);
  assert.match(text, /Ein Satz\./);
});

test("storeDocument sendet base64, Hash und Metadaten", async () => {
  const aufrufe = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, optionen) => {
    aufrufe.push({ url: String(url), optionen });
    return new Response(JSON.stringify({ stored: true, rev: 3 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const ydoc = dokument();
    const ergebnis = await storeDocument("doc-1", ydoc, {
      reason: "checkpoint",
      author_user_id: 7,
      author_family: "fam",
    });
    assert.equal(ergebnis.rev, 3);
    assert.equal(aufrufe.length, 1);
    assert.match(aufrufe[0].url, /\/internal\/docs\/doc-1\/store$/);
    assert.equal(
      aufrufe[0].optionen.headers.Authorization,
      "Bearer service-token",
    );
    const body = JSON.parse(aufrufe[0].optionen.body);
    assert.equal(body.reason, "checkpoint");
    assert.equal(body.force_revision, true);
    assert.equal(body.author_user_id, 7);
    assert.equal(body.author_family, "fam");
    assert.equal(
      body.state_sha256,
      sha256(Buffer.from(body.state_b64, "base64")),
    );
    assert.match(body.content_text, /Abschnitt/);
  } finally {
    globalThis.fetch = original;
  }
});

test("withLock fuehrt Schreibvorgaenge nacheinander aus", async () => {
  const reihenfolge = [];
  let laeuft = false;
  const arbeit = async (name) => {
    assert.equal(laeuft, false, "zwei Stores liefen gleichzeitig");
    laeuft = true;
    reihenfolge.push(`start-${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    reihenfolge.push(`ende-${name}`);
    laeuft = false;
  };
  await Promise.all([
    withLock("doc-1", () => arbeit("a")),
    withLock("doc-1", () => arbeit("b")),
  ]);
  assert.deepEqual(reihenfolge, [
    "start-a",
    "ende-a",
    "start-b",
    "ende-b",
  ]);
});

test("withLock bricht nach der Frist ab, ohne fn auszufuehren", async () => {
  let lief = false;
  const erster = withLock("doc-besetzt", async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  await assert.rejects(
    withLock("doc-besetzt", async () => {
      lief = true;
    }, { waitMs: 5 }),
    (error) => error.code === "AI_EDIT_BUSY",
  );
  await erster;
  assert.equal(lief, false, "abgelaufener Auftrag wurde trotzdem ausgefuehrt");

  // Die Kette ist danach wieder frei.
  const wert = await withLock("doc-besetzt", async () => 42);
  assert.equal(wert, 42);
});
