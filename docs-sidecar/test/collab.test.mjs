import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import { applyAiEdit } from "../ai_edit.mjs";
import { aiUndo, registerDocument } from "../collab.mjs";

function dokument(text) {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const absatz = new Y.XmlElement("paragraph");
  fragment.insert(0, [absatz]);
  const t = new Y.XmlText();
  absatz.insert(0, [t]);
  t.insert(0, text);
  return ydoc;
}

const text = (ydoc) => ydoc.getXmlFragment("default").toString();

test("nach einem neuen Y.Doc verfolgt der Undo-Manager das neue Dokument", () => {
  const erstes = dokument("Erster Lauf");
  registerDocument("doc-neu", erstes, { rev: 1 });
  // Der Manager muss vor der Transaktion stehen, sonst erfasst er sie nicht.
  aiUndo("doc-neu", erstes, "7");
  applyAiEdit(erstes, {
    operation: "append",
    markdown: "Alte KI-Zeile.",
    runId: "r1",
    callId: "c1",
    userId: "7",
  });
  assert.equal(aiUndo("doc-neu", erstes, "7").canUndo(), true);

  // Hocuspocus baut nach einem Reload ein frisches Y.Doc fuer denselben Namen.
  const zweites = dokument("Zweiter Lauf");
  registerDocument("doc-neu", zweites, { rev: 2 });
  aiUndo("doc-neu", zweites, "7");
  applyAiEdit(zweites, {
    operation: "append",
    markdown: "Neue KI-Zeile.",
    runId: "r2",
    callId: "c2",
    userId: "7",
  });

  const manager = aiUndo("doc-neu", zweites, "7");
  assert.equal(manager.canUndo(), true);
  manager.undo();
  assert.match(text(zweites), /Zweiter Lauf/);
  assert.doesNotMatch(text(zweites), /Neue KI-Zeile/);
  assert.match(text(erstes), /Alte KI-Zeile/);
});
