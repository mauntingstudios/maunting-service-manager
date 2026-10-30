/**
 * Blocktext und Fingerabdruck fuer die Dokument-KI.
 *
 * Diese Datei ist die eine Quelle fuer beide Seiten: der Sidecar vergibt
 * Fingerabdruecke, der Browser findet damit den markierten Block wieder.
 * Deshalb hier keine TipTap- oder Yjs-Importe, nur die beiden Knotenformen
 * als strukturelle Parameter.
 */

/** Sichtbarer Text eines Yjs-Knotens. Markup und Bilder zaehlen nicht. */
export function plainTextOfYNode(node) {
  if (!node) return "";
  if (typeof node.toDelta === "function") {
    const teile = [];
    for (const op of node.toDelta()) {
      if (typeof op.insert === "string") teile.push(op.insert);
    }
    return teile.join("");
  }
  if (typeof node.toArray !== "function") return "";
  return node.toArray().map(plainTextOfYNode).join("");
}

/** Sichtbarer Text eines ProseMirror-Knotens, gleiche Regel wie oben. */
export function plainTextOfProseMirrorNode(node) {
  if (!node) return "";
  if (typeof node.isText === "boolean" && node.isText) return node.text ?? "";
  if (typeof node.textBetween !== "function" || !node.content) return "";
  return node.textBetween(0, node.content.size, "", "");
}

export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/**
 * FNV-1a ueber UTF-8, erste 12 Hex-Zeichen.
 *
 * Bewusst kein SHA-256: die Editor-Dekoration muss synchron rechnen koennen,
 * `crypto.subtle` waere asynchron. 48 Bit reichen fuer einen Hinweis; bei
 * Gleichstand entscheidet der Index, sonst bricht die Anwendung mit
 * Kandidaten ab.
 */
export function fingerprintText(text) {
  const bytes = new TextEncoder().encode(normalizeText(text));
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

export function fingerprintOfYNode(node) {
  return fingerprintText(plainTextOfYNode(node));
}

export const FINGERPRINT_RE = /^[0-9a-f]{12}$/;
