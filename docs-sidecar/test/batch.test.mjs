import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import {
  AiEditError,
  applyEdits,
  applyEditsAtomically,
  markdownToNodes,
  structureOf,
} from "../ai_edit.mjs";

function dokument(markdown) {
  const ydoc = new Y.Doc();
  ydoc.getXmlFragment("default").insert(0, markdownToNodes(markdown));
  return ydoc;
}

function bloecke(ydoc) {
  return structureOf(ydoc.getXmlFragment("default")).blocks.map((block) => ({
    type: block.type,
    text: block.text,
  }));
}

function fingerprint(ydoc, text) {
  const treffer = structureOf(ydoc.getXmlFragment("default")).blocks.find(
    (block) => block.text === text,
  );
  assert.ok(treffer, `Block ${text} fehlt`);
  return treffer.fingerprint;
}

test("Batch setzt mehrere Aenderungen in einer Transaktion", () => {
  const ydoc = dokument("A\n\nB\n\nC");
  const fpA = fingerprint(ydoc, "A");
  const fpC = fingerprint(ydoc, "C");

  const { result } = applyEditsAtomically(
    ydoc,
    {
      edits: [
        { op: "insert_after", target: { fingerprint: fpA, index: 0 }, markdown: "Neu" },
        { op: "replace_block", target: { fingerprint: fpC, index: 2 }, markdown: "C neu" },
      ],
      runId: "run-1",
      callId: "call-1",
      userId: 7,
    },
    {},
  );

  assert.equal(result.origin, "ai:7:run-1:call-1");
  assert.deepEqual(
    bloecke(ydoc).map((block) => block.text),
    ["A", "Neu", "B", "C neu"],
  );
  assert.equal(result.edits.length, 2);
});

test("ein unaufloesbares Ziel laesst das Dokument unberuehrt", () => {
  const ydoc = dokument("A\n\nB");
  const vorher = Y.encodeStateAsUpdate(ydoc);
  const fpA = fingerprint(ydoc, "A");

  assert.throws(
    () =>
      applyEditsAtomically(ydoc, {
        edits: [
          { op: "insert_after", target: { fingerprint: fpA }, markdown: "Neu" },
          { op: "delete_block", target: { fingerprint: "000000000000" } },
        ],
        userId: 1,
      }),
    (error) =>
      error instanceof AiEditError && error.code === "AI_EDIT_TARGET_NOT_FOUND",
  );

  assert.deepEqual(Y.encodeStateAsUpdate(ydoc), vorher);
  assert.deepEqual(
    bloecke(ydoc).map((block) => block.text),
    ["A", "B"],
  );
});

test("insert_before, append_to_section und delete_block", () => {
  const ydoc = dokument("# Kopf\n\nAbsatz\n\n## Teil\n\nInhalt\n\n## Ende\n\nSchluss");
  const fpKopf = fingerprint(ydoc, "Kopf");
  const fpAbsatz = fingerprint(ydoc, "Absatz");
  const fpTeil = fingerprint(ydoc, "Teil");

  applyEditsAtomically(ydoc, {
    edits: [
      { op: "insert_before", target: { fingerprint: fpAbsatz }, markdown: "Davor" },
      { op: "append_to_section", target: { fingerprint: fpTeil }, markdown: "Zusatz" },
      { op: "delete_block", target: { fingerprint: fpKopf } },
    ],
    userId: 1,
  });

  assert.deepEqual(
    bloecke(ydoc).map((block) => block.text),
    ["Davor", "Absatz", "Teil", "Inhalt", "Zusatz", "Ende", "Schluss"],
  );
});

test("replace_text erhaelt eine einheitliche Formatierung", () => {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const absatz = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "Der alte Satz", { bold: true });
  absatz.insert(0, [text]);
  fragment.insert(0, [absatz]);

  const fp = fingerprint(ydoc, "Der alte Satz");
  applyEditsAtomically(ydoc, {
    edits: [
      {
        op: "replace_text",
        target: { fingerprint: fp },
        find: "alte",
        markdown: "neue",
      },
    ],
    userId: 1,
  });

  const block = fragment.toArray()[0];
  assert.equal(block.toString().includes("Der neue Satz"), true);
  const lauf = block.toArray()[0];
  assert.deepEqual(lauf.toDelta()[0].attributes, { bold: true });
});

test("replace_text ueber Mark-Grenzen wird abgelehnt", () => {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const absatz = new Y.XmlElement("paragraph");
  const vorne = new Y.XmlText();
  vorne.insert(0, "Der ");
  const fett = new Y.XmlText();
  fett.insert(0, "alte", { bold: true });
  const hinten = new Y.XmlText();
  hinten.insert(0, " Satz");
  absatz.insert(0, [vorne, fett, hinten]);
  fragment.insert(0, [absatz]);

  const fp = fingerprint(ydoc, "Der alte Satz");
  assert.throws(
    () =>
      applyEditsAtomically(ydoc, {
        edits: [
          {
            op: "replace_text",
            target: { fingerprint: fp },
            find: "alte Satz",
            markdown: "neue Satz",
          },
        ],
        userId: 1,
      }),
    (error) =>
      error instanceof AiEditError && error.code === "AI_EDIT_UNSAFE_MARKS",
  );
});

test("ein Zitat trifft auch einen fett formatierten Block", () => {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const absatz = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "Der alte Satz", { bold: true });
  absatz.insert(0, [text]);
  fragment.insert(0, [absatz]);

  const ergebnis = applyEdits(ydoc, {
    edits: [{ op: "replace_block", target: { quote: "alte" }, markdown: "Neu" }],
    userId: 1,
  });
  assert.equal(ergebnis.edits[0].replaced, true);
  assert.equal(bloecke(ydoc)[0].text, "Neu");
});

test("mehr als 20 Aenderungen werden abgelehnt", () => {
  const ydoc = dokument("A");
  assert.throws(
    () =>
      applyEdits(ydoc, {
        edits: Array.from({ length: 21 }, () => ({
          op: "append",
          markdown: "x",
        })),
        userId: 1,
      }),
    (error) =>
      error instanceof AiEditError && error.code === "AI_EDIT_BATCH_TOO_LARGE",
  );
});

test("zwei Einfuegungen am selben Anker behalten die Batch-Reihenfolge", () => {
  const ydoc = dokument("A\n\nB");
  const fp = fingerprint(ydoc, "A");
  applyEditsAtomically(ydoc, {
    edits: [
      { op: "insert_after", target: { fingerprint: fp }, markdown: "Erst" },
      { op: "insert_after", target: { fingerprint: fp }, markdown: "Dann" },
    ],
    userId: 1,
  });
  assert.deepEqual(
    bloecke(ydoc).map((block) => block.text),
    ["A", "Erst", "Dann", "B"],
  );
});

test("ein veralteter Fingerabdruck faellt nicht auf das Zitat zurueck", () => {
  const ydoc = dokument("Der alte Satz");
  assert.throws(
    () =>
      applyEditsAtomically(ydoc, {
        edits: [
          {
            op: "replace_block",
            // Absichtlich veraltet, das Zitat wuerde aber passen.
            target: { fingerprint: "000000000000", quote: "alte" },
            markdown: "Neu",
          },
        ],
        userId: 1,
      }),
    (error) =>
      error instanceof AiEditError && error.code === "AI_EDIT_TARGET_NOT_FOUND",
  );
  assert.deepEqual(
    bloecke(ydoc).map((block) => block.text),
    ["Der alte Satz"],
  );
});
