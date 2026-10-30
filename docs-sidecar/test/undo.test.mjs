import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import { applyAiEdit, markdownToNodes } from "../ai_edit.mjs";
import { aiUndo, registerDocument, undoAi } from "../collab.mjs";

function dokument(markdown) {
  const ydoc = new Y.Doc();
  ydoc.getXmlFragment("default").insert(0, markdownToNodes(markdown));
  return ydoc;
}

const text = (ydoc) => ydoc.getXmlFragment("default").toString();

test("A nimmt nur die eigene KI-Aenderung zurueck", () => {
  const ydoc = dokument("Basis");
  registerDocument("doc-undo", ydoc, { rev: 1 });

  aiUndo("doc-undo", ydoc, "1");
  applyAiEdit(ydoc, {
    operation: "append",
    markdown: "Von A",
    runId: "ra",
    callId: "ca",
    userId: "1",
  });

  aiUndo("doc-undo", ydoc, "2");
  applyAiEdit(ydoc, {
    operation: "append",
    markdown: "Von B",
    runId: "rb",
    callId: "cb",
    userId: "2",
  });

  const managerA = aiUndo("doc-undo", ydoc, "1");
  assert.equal(managerA.canUndo(), true);
  managerA.undo();

  assert.doesNotMatch(text(ydoc), /Von A/);
  assert.match(text(ydoc), /Von B/);
});

test("ohne eigenen Manager gibt es kein Undo", async () => {
  const ydoc = dokument("Basis");
  registerDocument("doc-ohne", ydoc, { rev: 1 });
  const ergebnis = await undoAi("doc-ohne", { userId: "99" });
  assert.equal(ergebnis.undone, false);
  assert.equal(ergebnis.code, "AI_UNDO_UNAVAILABLE");
});

test("mehr als 50 Nutzer verdrängen den aeltesten Manager", () => {
  const ydoc = dokument("Basis");
  registerDocument("doc-viele", ydoc, { rev: 1 });

  aiUndo("doc-viele", ydoc, "0");
  applyAiEdit(ydoc, {
    operation: "append",
    markdown: "Alt",
    runId: "r0",
    callId: "c0",
    userId: "0",
  });
  assert.equal(aiUndo("doc-viele", ydoc, "0").canUndo(), true);

  for (let i = 1; i <= 50; i += 1) {
    aiUndo("doc-viele", ydoc, String(i));
  }

  // Nutzer 0 wurde verdraengt; ein neuer Manager kennt die alte Aenderung nicht.
  assert.equal(aiUndo("doc-viele", ydoc, "0").canUndo(), false);
});
