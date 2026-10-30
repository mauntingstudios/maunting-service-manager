const BASE = (process.env.MSM_BACKEND_URL || "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);
const TOKEN = process.env.MSM_DOCS_SIDECAR_TOKEN || "";

function headers() {
  return {
    "Content-Type": "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

async function call(path, { method = "GET", body } = {}) {
  const antwort = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await antwort.text();
  let daten = null;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    daten = { raw: text };
  }
  if (!antwort.ok) {
    const error = new Error(
      `Backend ${path} antwortete ${antwort.status}`,
    );
    error.status = antwort.status;
    error.detail = daten;
    // FastAPI legt den Fachcode unter `detail.code` ab; der Sidecar-Mapper
    // unterscheidet danach 409/422 von einem echten Serverfehler.
    error.code = daten?.detail?.code || daten?.code || null;
    throw error;
  }
  return daten;
}

export function authorize({ docUid, userId, role, fam, jti }) {
  return call("/internal/docs/authorize", {
    method: "POST",
    body: { doc_uid: docUid, user_id: userId, role, fam, jti },
  });
}

export function loadState(docUid) {
  return call(`/internal/docs/${encodeURIComponent(docUid)}/state`);
}

export function storeState(docUid, payload) {
  return call(`/internal/docs/${encodeURIComponent(docUid)}/store`, {
    method: "POST",
    body: payload,
  });
}

/**
 * Persistiert eine KI-Aenderung mitsamt Vorher-Revision in einem Commit.
 * Getrennt von `storeState`, weil hier zwei Zustaende und zwei Revisionen
 * gemeinsam geschrieben werden.
 */
export function aiStoreState(docUid, payload) {
  return call(`/internal/docs/${encodeURIComponent(docUid)}/ai-store`, {
    method: "POST",
    body: payload,
  });
}
