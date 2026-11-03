import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import { markdownToNodes } from "../ai_edit.mjs";
import { createRenderPool } from "../render_pool.mjs";

function zustand() {
  const document = new Y.Doc();
  document.getXmlFragment("default").insert(0, markdownToNodes("# Titel\n\nText"));
  const state = Uint8Array.from(Y.encodeStateAsUpdate(document));
  document.destroy();
  return state;
}

test("Render-Worker liefern Dokument und Struktur aus einem Zustand", async () => {
  const pool = createRenderPool({ size: 1 });
  try {
    const state = zustand();
    const gerendert = await pool.run({
      operation: "render",
      state,
      format: "html",
      title: "Test",
    });
    const struktur = await pool.run({
      operation: "structure",
      state,
      offset: 0,
      limit: 120,
    });

    assert.match(gerendert.content, /<h1>Titel<\/h1>/);
    assert.equal(gerendert.mime, "text/html; charset=utf-8");
    assert.equal(struktur.blocks[0].text, "Titel");
  } finally {
    await pool.close();
  }
});

test("abgebrochene Worker geben den Event-Loop frei und laufen in ein Zeitlimit", async () => {
  const pool = createRenderPool({
    size: 1,
    timeoutMs: 100,
    workerUrl: new URL("../worker-fixture.mjs", import.meta.url),
  });
  let eventLoopFreigegeben = false;
  const fertig = new Promise((resolve) => {
    setTimeout(() => {
      eventLoopFreigegeben = true;
      resolve();
    }, 10);
  });

  try {
    const fehler = assert.rejects(
      pool.run({ operation: "hang", state: new Uint8Array() }),
      { code: "DOC_RENDER_TIMEOUT" },
    );
    await fertig;
    await fehler;
    assert.equal(eventLoopFreigegeben, true);
  } finally {
    await pool.close();
  }
});
