import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";
import { fingerprintText, normalizeText } from "@msm/docs-schema/structure";

import { markdownToNodes, structureOf } from "../ai_edit.mjs";

function dokument(markdown) {
  const ydoc = new Y.Doc();
  ydoc.getXmlFragment("default").insert(0, markdownToNodes(markdown));
  return ydoc;
}

test("Fingerabdruck ist stabil und ignoriert Whitespace", () => {
  // Fester Vektor: gleiche Werte in Sidecar und Browser.
  assert.equal(fingerprintText("Der alte Satz"), "4ded84c9b8ee");
  assert.equal(fingerprintText("  Der   alte Satz  "), "4ded84c9b8ee");
  assert.equal(fingerprintText("Der neue Satz") === "4ded84c9b8ee", false);
  assert.equal(normalizeText("A\u00a0 B"), "A B");
});

test("Struktur liefert Index, Typ, Pfad und Fingerabdruck", () => {
  const ydoc = dokument(
    "# Titel\n\nEin Absatz.\n\n## Plan\n\nEin Schritt.\n\n- Punkt",
  );
  const struktur = structureOf(ydoc.getXmlFragment("default"));

  assert.equal(struktur.blocks.length, 5);
  assert.deepEqual(struktur.blocks[0].heading_path, []);
  assert.deepEqual(struktur.blocks[1].heading_path, ["Titel"]);
  assert.equal(struktur.blocks[2].level, 2);
  assert.deepEqual(struktur.blocks[2].heading_path, ["Titel"]);
  assert.deepEqual(struktur.blocks[3].heading_path, ["Titel", "Plan"]);
  assert.equal(struktur.blocks[3].text, "Ein Schritt.");
  assert.match(struktur.blocks[3].fingerprint, /^[0-9a-f]{12}$/);
  assert.equal(struktur.blocks[4].type, "bulletList");
  assert.equal(struktur.truncated, false);
});

test("Struktur blaettert und meldet das Ende", () => {
  const ydoc = dokument("# A\n\n# B\n\n# C");
  const erste = structureOf(ydoc.getXmlFragment("default"), { offset: 0, limit: 2 });
  assert.equal(erste.blocks.length, 2);
  assert.equal(erste.next_offset, 2);
  assert.equal(erste.truncated, true);

  const zweite = structureOf(ydoc.getXmlFragment("default"), { offset: 2, limit: 2 });
  assert.deepEqual(
    zweite.blocks.map((block) => block.text),
    ["C"],
  );
  assert.equal(zweite.next_offset, null);
});
