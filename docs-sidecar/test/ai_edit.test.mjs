import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import { applyAiEdit, AiEditError, markdownToNodes } from "../ai_edit.mjs";

function docMitText(text) {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const absatz = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  absatz.insert(0, [t]);
  fragment.insert(0, [absatz]);
  return ydoc;
}

function text(ydoc) {
  return ydoc
    .getXmlFragment("default")
    .toArray()
    .map((node) => node.toString())
    .join("\n");
}

test("Markdown wird zu Ueberschrift, Absatz und Liste", () => {
  const knoten = markdownToNodes("# Titel\n\nEin Absatz.\n\n- eins\n- zwei");
  assert.equal(knoten.length, 3);
  assert.equal(knoten[0].nodeName, "heading");
  assert.equal(knoten[1].nodeName, "paragraph");
  assert.equal(knoten[2].nodeName, "bulletList");
});

test("append haengt am Ende an", () => {
  const ydoc = docMitText("Alt");
  const ergebnis = applyAiEdit(ydoc, {
    operation: "append",
    markdown: "Neu",
    runId: "run-1",
    callId: "call-1",
  });
  assert.equal(ergebnis.ok, true);
  assert.match(text(ydoc), /Alt/);
  assert.match(text(ydoc), /Neu/);
});

test("replace_block ersetzt den Block mit dem Zitat", () => {
  const ydoc = docMitText("Der alte Satz");
  const ergebnis = applyAiEdit(ydoc, {
    operation: "replace_block",
    markdown: "Der neue Satz",
    anchor: { quote: "alte" },
    runId: "run-1",
    callId: "call-2",
  });
  assert.equal(ergebnis.replaced, true);
  assert.doesNotMatch(text(ydoc), /Der alte Satz/);
  assert.match(text(ydoc), /Der neue Satz/);
});

test("unbekanntes Zitat wirft AI_EDIT_TARGET_NOT_FOUND", () => {
  const ydoc = docMitText("Etwas");
  assert.throws(
    () =>
      applyAiEdit(ydoc, {
        operation: "replace_block",
        markdown: "Neu",
        anchor: { quote: "fehlt" },
        runId: "run-1",
        callId: "call-3",
      }),
    (error) => error instanceof AiEditError && error.code === "AI_EDIT_TARGET_NOT_FOUND",
  );
});

test("mehrdeutiges Zitat wirft mit Kandidaten", () => {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  for (const wert of ["gleich", "gleich"]) {
    const absatz = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, wert);
    absatz.insert(0, [t]);
    fragment.insert(fragment.length, [absatz]);
  }
  assert.throws(
    () =>
      applyAiEdit(ydoc, {
        operation: "replace_block",
        markdown: "Neu",
        anchor: { quote: "gleich" },
        runId: "run-1",
        callId: "call-4",
      }),
    (error) =>
      error instanceof AiEditError &&
      error.code === "AI_EDIT_TARGET_AMBIGUOUS" &&
      error.candidates.length === 2,
  );
});

test("expectedBlock verhindert einen falschen Zielblock", () => {
  const ydoc = docMitText("Der alte Satz");
  assert.throws(
    () =>
      applyAiEdit(ydoc, {
        operation: "replace_block",
        markdown: "Neu",
        anchor: { quote: "alte" },
        expectedBlock: "Ein ganz anderer Block",
        runId: "run-1",
        callId: "call-6",
      }),
    (error) => error instanceof AiEditError && error.code === "AI_EDIT_STALE_SELECTION",
  );
});

test("applyAiEdit meldet Zielblock und Einfuegeposition fuer die Vorschau", () => {
  const ydoc = docMitText("Der alte Satz");
  const ersetzt = applyAiEdit(ydoc, {
    operation: "replace_block",
    markdown: "Der neue Satz",
    anchor: { quote: "alte" },
    expectedBlock: "Der alte Satz",
    runId: "run-1",
    callId: "call-7",
  });
  assert.equal(ersetzt.target_block, "Der alte Satz");

  assert.equal(ersetzt.target_index, 0);
  assert.equal(ersetzt.inserted_count, 1);

  const angehaengt = applyAiEdit(ydoc, {
    operation: "append",
    markdown: "Noch einer",
    runId: "run-1",
    callId: "call-8",
  });
  assert.equal(angehaengt.target_block, null);
  assert.equal(angehaengt.target_index, 1);
});

test("occurrence waehlt bei mehrdeutigem Zitat den richtigen Block", () => {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  for (const wert of ["gleich", "gleich"]) {
    const absatz = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    absatz.insert(0, [t]);
    fragment.insert(fragment.length, [absatz]);
    t.insert(0, wert);
  }
  const ergebnis = applyAiEdit(ydoc, {
    operation: "replace_block",
    markdown: "Ersetzt",
    anchor: { quote: "gleich", occurrence: 2 },
    runId: "run-1",
    callId: "call-5",
  });
  assert.equal(ergebnis.replaced, true);
  const bloecke = ydoc
    .getXmlFragment("default")
    .toArray()
    .map((node) => node.toString());
  assert.match(bloecke[0], /gleich/);
  assert.match(bloecke[1], /Ersetzt/);
});
