import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import { markdownToNodes } from "../ai_edit.mjs";

// Yjs-Typen lassen sich erst nach dem Einhaengen in ein Dokument lesen.
function knoten(markdown, optionen) {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  fragment.insert(0, markdownToNodes(markdown, optionen));
  return fragment.toArray();
}

test("GFM-Tabelle wird zu table/tableRow/tableHeader/tableCell", () => {
  const bloecke = knoten("| A | B |\n| --- | --- |\n| 1 | 2 |");
  assert.equal(bloecke.length, 1);
  const tabelle = bloecke[0];
  assert.equal(tabelle.nodeName, "table");

  const zeilen = tabelle.toArray();
  assert.equal(zeilen.length, 2);
  assert.equal(zeilen[0].nodeName, "tableRow");
  assert.equal(zeilen[0].toArray()[0].nodeName, "tableHeader");
  // Jede Zelle braucht einen Absatz, sonst lehnt das TipTap-Schema sie ab.
  assert.equal(zeilen[0].toArray()[0].toArray()[0].nodeName, "paragraph");
  assert.equal(zeilen[1].toArray()[0].nodeName, "tableCell");
});

test("Code-Fence uebernimmt die Sprache", () => {
  const bloecke = knoten("```js\nconst a = 1;\n```");
  assert.equal(bloecke[0].nodeName, "codeBlock");
  assert.equal(bloecke[0].getAttribute("language"), "js");
});

test("verschachtelte Liste haengt am uebergeordneten Punkt", () => {
  const bloecke = knoten("- a\n  - b\n- c");
  assert.equal(bloecke.length, 1);
  const liste = bloecke[0];
  assert.equal(liste.nodeName, "bulletList");

  const punkte = liste.toArray();
  assert.equal(punkte.length, 2);
  assert.equal(punkte[0].toArray().length, 2);
  assert.equal(punkte[0].toArray()[1].nodeName, "bulletList");
  assert.equal(punkte[1].toArray().length, 1);
});

test("Bild wird verworfen und als Warnung gemeldet", () => {
  const warnings = [];
  const bloecke = knoten("Text\n\n![Alt](https://example.test/bild.png)", {
    warnings,
  });
  assert.equal(bloecke.length, 1);
  assert.equal(bloecke[0].nodeName, "paragraph");
  assert.deepEqual(warnings, ["image"]);
  assert.equal(bloecke[0].toString().includes("example.test"), false);
});
