import { parentPort } from "node:worker_threads";
import * as Y from "yjs";

import { structureOf } from "./ai_edit.mjs";
import { renderDocument } from "./render.mjs";

parentPort.on("message", ({ id, operation, state, format, title, offset, limit }) => {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, state);
    if (operation === "render") {
      parentPort.postMessage({
        id,
        result: {
          content: renderDocument(document, format, title),
          mime:
            format === "md"
              ? "text/markdown; charset=utf-8"
              : format === "txt"
                ? "text/plain; charset=utf-8"
                : "text/html; charset=utf-8",
        },
      });
    } else if (operation === "structure") {
      parentPort.postMessage({
        id,
        result: structureOf(document.getXmlFragment("default"), { offset, limit }),
      });
    } else {
      throw new Error("Unbekannte Worker-Aktion");
    }
  } catch (error) {
    parentPort.postMessage({
      id,
      error: { message: error.message, code: error.code || null },
    });
  } finally {
    document.destroy();
  }
});
