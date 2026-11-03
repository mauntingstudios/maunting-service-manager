import { applyEdits } from "../ai_edit.mjs";

/**
 * Testhilfe: genau eine Aenderung ueber den produktiven Batch-Weg.
 *
 * Der fruehere Einzel-Export `applyAiEdit` ist entfallen (Befund 51); die
 * Faelle bleiben unveraendert, laufen aber durch dieselbe Funktion wie die
 * Anwendung.
 */
export function applyAiEdit(
  ydoc,
  { operation, markdown, anchor, runId, callId, expectedBlock = null, userId = "anon" } = {},
) {
  const edit =
    operation === "append"
      ? { op: "append", markdown }
      : {
          op: "replace_block",
          markdown,
          target: {
            quote: anchor?.quote,
            occurrence: anchor?.occurrence,
          },
          expected_text: expectedBlock,
        };
  const ergebnis = applyEdits(ydoc, { edits: [edit], runId, callId, userId });
  const eintrag = ergebnis.edits[0];
  return {
    ok: true,
    origin: ergebnis.origin,
    replaced: Boolean(eintrag.replaced),
    target_block: eintrag.target_text ?? null,
    target_index: eintrag.target_index,
    inserted_count: eintrag.inserted_count,
  };
}
