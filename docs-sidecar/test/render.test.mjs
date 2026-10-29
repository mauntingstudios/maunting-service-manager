import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import { renderDocument } from "../render.mjs";

function dokument() {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");

  const heading = new Y.XmlElement("heading");
  heading.setAttribute("level", "1");
  fragment.insert(0, [heading]);
  const headingText = new Y.XmlText();
  heading.insert(0, [headingText]);
  headingText.insert(0, "Titel");

  const absatz = new Y.XmlElement("paragraph");
  fragment.insert(1, [absatz]);
  const text = new Y.XmlText();
  absatz.insert(0, [text]);
  text.insert(0, "Hallo Welt und Link");
  text.format(6, 4, { bold: true });
  text.format(14, 5, { link: "https://example.test" });

  const liste = new Y.XmlElement("bulletList");
  fragment.insert(2, [liste]);
  for (const wert of ["eins", "zwei"]) {
    const punkt = new Y.XmlElement("listItem");
    liste.insert(liste.length, [punkt]);
    const p = new Y.XmlElement("paragraph");
    punkt.insert(0, [p]);
    const t = new Y.XmlText();
    p.insert(0, [t]);
    t.insert(0, wert);
  }

  return ydoc;
}

test("HTML enthaelt Ueberschrift, Fettdruck und Liste", () => {
  const html = renderDocument(dokument(), "html", "Titel");
  assert.match(html, /<h1>Titel<\/h1>/);
  assert.match(html, /<strong>Welt<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.test"/);
  assert.match(html, /<ul><li><p>eins<\/p><\/li>/);
  assert.match(html, /@media print/);
});

test("Markdown enthaelt Ueberschrift, Fettdruck und Punkte", () => {
  const md = renderDocument(dokument(), "md", "Titel");
  assert.match(md, /^# Titel/m);
  assert.match(md, /\*\*Welt\*\*/);
  assert.match(md, /- eins/);
  assert.match(md, /- zwei/);
});

test("Text enthaelt nur die sichtbaren Zeilen", () => {
  const txt = renderDocument(dokument(), "txt", "Titel");
  assert.match(txt, /Titel/);
  assert.match(txt, /Hallo Welt und Link/);
  assert.match(txt, /eins/);
});

test("leeres Dokument liefert leere Ausgabe", () => {
  const leer = new Y.Doc();
  assert.equal(renderDocument(leer, "md", "Leer"), "");
  assert.match(renderDocument(leer, "html", "Leer"), /<article class="docs-prose">/);
});

test("Bilder tragen im HTML die Asset-UID fuer den Export", () => {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const absatz = new Y.XmlElement("paragraph");
  fragment.insert(0, [absatz]);
  const bild = new Y.XmlElement("image");
  bild.setAttribute("src", "/api/docs/assets/a/content?token=t");
  bild.setAttribute("alt", "Schaubild");
  bild.setAttribute("assetUid", "asset-1");
  absatz.insert(0, [bild]);

  const html = renderDocument(ydoc, "html", "Mit Bild");
  assert.match(html, /<img src="\/api\/docs\/assets\/a\/content\?token=t"/);
  assert.match(html, /data-asset-uid="asset-1"/);

  const md = renderDocument(ydoc, "md", "Mit Bild");
  assert.match(md, /!\[Schaubild\]\(\/api\/docs\/assets\/a\/content\?token=t\)/);
});
