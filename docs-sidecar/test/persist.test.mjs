import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

process.env.MSM_BACKEND_URL = "http://backend.test";
process.env.MSM_DOCS_SIDECAR_TOKEN = "service-token";

const { decodeState, extractText, forgetRev, rememberRev, restoreFragment, sha256, storeDocument, withLock } = await import(
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

test("storeDocument sendet die geladene Revision und merkt die neue", async () => {
  // Befund 9: Der erste Store meldet die geladene Rev 5, die Antwort (Rev 6)
  // schiebt die Spur nach — der zweite Store meldet 6. Am alten Stand war
  // expected_rev immer 0 und veraltete Staende liefen still durch.
  const aufrufe = [];
  const revs = [6, 7, 8];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, optionen) => {
    aufrufe.push({ url: String(url), optionen });
    return new Response(JSON.stringify({ stored: true, rev: revs.shift() ?? 8 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const ydoc = dokument();
    rememberRev("doc-rev-9", 5);
    await storeDocument("doc-rev-9", ydoc, { reason: "autosave" });
    await storeDocument("doc-rev-9", ydoc, { reason: "autosave" });
    assert.equal(aufrufe.length, 2);
    assert.equal(JSON.parse(aufrufe[0].optionen.body).expected_rev, 5);
    assert.equal(JSON.parse(aufrufe[1].optionen.body).expected_rev, 6);
    forgetRev("doc-rev-9");
    await storeDocument("doc-rev-9", ydoc, { reason: "autosave" });
    assert.equal(JSON.parse(aufrufe[2].optionen.body).expected_rev, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("decodeState und restoreFragment weisen Zustaende ueber 4 MiB ab", () => {
  // Befund 34: Jeder Zustandsweg (Restore, Render-state_b64, kuenftige) laeuft
  // durch die Groessenpruefung — mehr als 4 MiB ist DOC_TOO_LARGE.
  // Am alten Stand nahm restoreFragment alles und der Render-Zweig pruefte nie.
  const gross = Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64");
  assert.throws(() => decodeState(gross), (error) => error.code === "DOC_TOO_LARGE");
  assert.throws(
    () => restoreFragment(new Y.Doc(), Buffer.alloc(4 * 1024 * 1024 + 1)),
    (error) => error.code === "DOC_TOO_LARGE",
  );
  const klein = decodeState(Buffer.from("eA==", "base64").toString("base64"));
  assert.equal(klein.byteLength, 1);
});

function antwort(daten, status = 200) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function serverDokument(text) {
  const doc = new Y.Doc();
  const absatz = new Y.XmlElement("paragraph");
  const inhalt = new Y.XmlText();
  inhalt.insert(0, text);
  absatz.insert(0, [inhalt]);
  doc.getXmlFragment("default").insert(0, [absatz]);
  return doc;
}

test("holt bei DOC_REV_CONFLICT den Stand, mischt und wiederholt genau einmal", async () => {
  const server = serverDokument("Vom Server");
  const zustand = Buffer.from(Y.encodeStateAsUpdate(server)).toString("base64");
  const aufrufe = [];
  let speicher = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, optionen) => {
    if (String(url).endsWith("/state")) {
      aufrufe.push("state");
      return antwort({ state_b64: zustand, rev: 9 });
    }
    speicher += 1;
    const body = JSON.parse(optionen.body);
    aufrufe.push({ expected: body.expected_rev });
    if (speicher === 1) {
      return antwort({ detail: { code: "DOC_REV_CONFLICT", current_rev: 9 } }, 409);
    }
    return antwort({ stored: true, rev: 10 });
  };
  try {
    rememberRev("doc-konflikt", 8);
    const lokal = serverDokument("Lokal");
    const ergebnis = await storeDocument("doc-konflikt", lokal, { reason: "autosave" });
    assert.equal(ergebnis.rev, 10);
    assert.equal(speicher, 2);
    assert.equal(aufrufe.filter((eintrag) => eintrag === "state").length, 1);
    assert.deepEqual(
      aufrufe.filter((eintrag) => typeof eintrag === "object").map((eintrag) => eintrag.expected),
      [8, 9],
    );
    assert.match(extractText(lokal), /Lokal/);
    assert.match(extractText(lokal), /Vom Server/);
    forgetRev("doc-konflikt");
  } finally {
    globalThis.fetch = original;
  }
});

test("ein zweiter Konflikt bleibt sichtbar und haengt nicht", async () => {
  const aufrufe = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/state")) {
      aufrufe.push("state");
      return antwort({ state_b64: "", rev: 9 });
    }
    aufrufe.push("store");
    return antwort({ detail: { code: "DOC_REV_CONFLICT", current_rev: 9 } }, 409);
  };
  try {
    await assert.rejects(
      storeDocument("doc-konflikt-2", serverDokument("Text"), { reason: "autosave" }),
      (error) => error.code === "DOC_REV_CONFLICT",
    );
    assert.equal(aufrufe.filter((eintrag) => eintrag === "store").length, 2);
    assert.equal(aufrufe.filter((eintrag) => eintrag === "state").length, 1);
    forgetRev("doc-konflikt-2");
  } finally {
    globalThis.fetch = original;
  }
});
