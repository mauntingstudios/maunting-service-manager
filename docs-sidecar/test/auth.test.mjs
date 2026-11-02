import assert from "node:assert/strict";
import test from "node:test";

process.env.MSM_DOCS_COLLAB_SECRET = "test-secret-32-characters-long!!!!";

const jwt = await import("jsonwebtoken");
const { verifyToken, authenticate, jtiFreigeben, AuthError } = await import("../auth.mjs");

function token(claims, secret = process.env.MSM_DOCS_COLLAB_SECRET) {
  return jwt.default.sign(
    {
      iss: "msm",
      aud: "msm-docs",
      sub: "7",
      doc: "doc-1",
      team: 3,
      role: "editor",
      ro: false,
      fam: "fam-1",
      jti: "jti-1",
      exp: Math.floor(Date.now() / 1000) + 60,
      ...claims,
    },
    secret,
    { algorithm: "HS256" },
  );
}

test("akzeptiert ein gueltiges Dokument-Token", () => {
  const claims = verifyToken(token({}), "doc-1");
  assert.equal(claims.user_id, 7);
  assert.equal(claims.role, "editor");
});

test("weist ein Token fuer ein anderes Dokument ab", () => {
  assert.throws(() => verifyToken(token({}), "doc-2"), AuthError);
});

test("weist ein abgelaufenes Token ab", () => {
  assert.throws(
    () => verifyToken(token({ exp: Math.floor(Date.now() / 1000) - 10 }), "doc-1"),
    AuthError,
  );
});

test("weist eine falsche Audience ab", () => {
  assert.throws(() => verifyToken(token({ aud: "msm" }), "doc-1"), AuthError);
});

test("weist ein Token ohne Benutzer ab", () => {
  assert.throws(() => verifyToken(token({ sub: "0" }), "doc-1"), AuthError);
});

test("dasselbe Token verbindet kein zweites Mal (Befund 41)", async () => {
  // Token an Verbindung gebunden: Die zweite Anmeldung mit demselben Token
  // scheitert, solange die erste lebt; ein anderes Token geht durch, und
  // nach der Freigabe (Disconnect) geht dasselbe Token wieder. Am alten
  // Stand verband jedes gueltige Token beliebig oft.
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        readonly: false,
        role: "editor",
        team_id: 3,
        rev: 1,
        module_enabled: true,
        user: { id: 7, username: "u" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const dasselbe = token({ jti: "jti-einmal-41" });
    const kontext = await authenticate({ token: dasselbe, documentName: "doc-1" });
    assert.equal(kontext.jti, "jti-einmal-41");
    await assert.rejects(authenticate({ token: dasselbe, documentName: "doc-1" }), /bereits verwendet/);
    await authenticate({ token: token({ jti: "jti-anderes-41" }), documentName: "doc-1" });
    jtiFreigeben("doc-1", "jti-einmal-41");
    await authenticate({ token: dasselbe, documentName: "doc-1" });
    jtiFreigeben("doc-1", "jti-einmal-41");
    jtiFreigeben("doc-1", "jti-anderes-41");
  } finally {
    globalThis.fetch = original;
  }
});
