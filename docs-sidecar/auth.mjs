import jwt from "jsonwebtoken";

import { authorize } from "./backend_client.mjs";

const SECRET = process.env.MSM_DOCS_COLLAB_SECRET || "";

export class AuthError extends Error {}

export function verifyToken(token, documentName) {
  if (!SECRET) {
    throw new AuthError("MSM_DOCS_COLLAB_SECRET fehlt");
  }
  let claims;
  try {
    claims = jwt.verify(token, SECRET, {
      algorithms: ["HS256"],
      audience: "msm-docs",
      issuer: "msm",
    });
  } catch (error) {
    throw new AuthError(`Token ungueltig: ${error.message}`);
  }
  if (typeof claims !== "object" || !claims) {
    throw new AuthError("Token ohne Inhalt");
  }
  if (claims.doc !== documentName) {
    throw new AuthError("Token gehoert zu einem anderen Dokument");
  }
  const userId = Number(claims.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AuthError("Token ohne Benutzer");
  }
  return { ...claims, user_id: userId };
}

export async function authenticate({ token, documentName }) {
  if (!token || typeof token !== "string") {
    throw new AuthError("Kein Token im Auth-Frame");
  }
  const claims = verifyToken(token, documentName);
  let antwort;
  try {
    antwort = await authorize({
      docUid: documentName,
      userId: claims.user_id,
      role: claims.role,
      fam: claims.fam,
      jti: claims.jti,
    });
  } catch (error) {
    throw new AuthError(
      `Autorisierung fehlgeschlagen: ${error.status || error.message}`,
    );
  }
  if (!antwort || antwort.ok !== true) {
    throw new AuthError("Autorisierung abgelehnt");
  }
  if (antwort.module_enabled === false) {
    throw new AuthError("Dokumente-Modul ist deaktiviert");
  }
  return {
    user: antwort.user,
    user_id: claims.user_id,
    // Die Rolle kommt frisch vom Backend, nicht aus dem Token.
    role: antwort.role,
    readonly: Boolean(antwort.readonly),
    team_id: antwort.team_id,
    rev: antwort.rev,
    fam: claims.fam || "",
    jti: claims.jti || "",
  };
}
