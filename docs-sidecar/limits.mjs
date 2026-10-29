export const STATE_MAX_BYTES = 4 * 1024 * 1024;
export const TEXT_MAX_CHARS = 1_000_000;
export const STORE_TIMEOUT_MS = 20_000;

export function assertStateSize(bytes) {
  if (bytes > STATE_MAX_BYTES) {
    const error = new Error(
      `Dokumentzustand groesser als ${STATE_MAX_BYTES} Bytes`,
    );
    error.code = "DOC_TOO_LARGE";
    throw error;
  }
}

export function clampText(text) {
  const wert = String(text ?? "");
  if (wert.length <= TEXT_MAX_CHARS) {
    return { text: wert, truncated: false };
  }
  return { text: wert.slice(0, TEXT_MAX_CHARS), truncated: true };
}
