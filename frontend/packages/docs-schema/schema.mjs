/**
 * Gemeinsames Schema von Web-Editor und Sidecar.
 *
 * Diese Datei enthaelt nur Namen und Versionen. Sie wird auch vom Sidecar
 * importiert, der keinen Browser hat; deshalb keine TipTap-Importe hier.
 */

export const schemaVersion = 1;

/** Top-Level- und Inline-Knoten, die beide Seiten kennen muessen. */
export const CORE_NODE_NAMES = Object.freeze([
  "doc",
  "paragraph",
  "text",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "image",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
]);

export const CORE_MARK_NAMES = Object.freeze([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "highlight",
  "textStyle",
  "comment",
]);

/** Der Yjs-Fragmentname, den TipTap Collaboration standardmaessig nutzt. */
export const YJS_FRAGMENT = "default";

export function schemaContract() {
  return {
    schemaVersion,
    nodes: [...CORE_NODE_NAMES].sort(),
    marks: [...CORE_MARK_NAMES].sort(),
  };
}
