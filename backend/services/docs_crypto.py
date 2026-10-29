"""Dokument-Krypto: DIS-Strings mit dokumentgebundener AAD.

Die AAD bindet jedes Chiffrat an Dokument, Feld und Revision. Ein Chiffrat,
das in eine andere Zeile kopiert wird, scheitert damit beim Entschluesseln.
Inhalte werden vor dem Verschluesseln gzip-komprimiert und base64-kodiert
(``gz:``-Praefix im Klartext), damit das DIS-Limit von 8 MiB traegt.
"""

from __future__ import annotations

import base64
import binascii
import gzip
import hashlib

from services.dis_client import DisClient, DisDecryptionError

STATE_LIMIT_BYTES = 4 * 1024 * 1024
TEXT_LIMIT_CHARS = 1_000_000

_GZ_PREFIX = "gz:"


class DocCryptoError(RuntimeError):
    """Der gespeicherte Zustand ist nicht lesbar — fail-closed, nie leer."""


def aad_title(doc_uid: str) -> str:
    return f"msm:docs:v1:{doc_uid}:title"


def aad_state(doc_uid: str) -> str:
    return f"msm:docs:v1:{doc_uid}:state"


def aad_text(doc_uid: str) -> str:
    return f"msm:docs:v1:{doc_uid}:text"


def aad_revision(doc_uid: str, rev: int, feld: str) -> str:
    return f"msm:docs:v1:{doc_uid}:revision:{rev}:{feld}"


def aad_comment(doc_uid: str, comment_uid: str, feld: str) -> str:
    return f"msm:docs:v1:{doc_uid}:comment:{comment_uid}:{feld}"


def aad_asset(doc_uid: str, asset_uid: str) -> str:
    return f"msm:docs:v1:{doc_uid}:asset:{asset_uid}"


def aad_folder(team_id: int, folder_uid: str) -> str:
    return f"msm:docs:v1:{team_id}:folder:{folder_uid}:name"


def encrypt_text(plaintext: str, aad: str) -> str:
    return DisClient.encrypt(plaintext, aad)


def decrypt_text(ciphertext: str, aad: str) -> str:
    try:
        return DisClient.decrypt(ciphertext, aad)
    except DisDecryptionError as exc:
        raise DocCryptoError("Dokumentinhalt nicht entschluesselbar") from exc


def sha256_hex(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _encrypt_gz(raw: bytes, aad: str) -> str:
    gepackt = base64.b64encode(gzip.compress(raw, 6)).decode("ascii")
    return DisClient.encrypt(_GZ_PREFIX + gepackt, aad)


def _decrypt_gz(ciphertext: str, aad: str) -> bytes:
    try:
        klartext = DisClient.decrypt(ciphertext, aad)
    except DisDecryptionError as exc:
        raise DocCryptoError("Dokumentzustand nicht entschluesselbar") from exc
    if not klartext.startswith(_GZ_PREFIX):
        raise DocCryptoError("Unbekanntes Zustandsformat")
    try:
        roh = base64.b64decode(klartext[len(_GZ_PREFIX):], validate=True)
        return gzip.decompress(roh)
    except (binascii.Error, OSError) as exc:
        raise DocCryptoError("Dokumentzustand beschaedigt") from exc


def encrypt_state(raw: bytes, doc_uid: str) -> str:
    if len(raw) > STATE_LIMIT_BYTES:
        raise ValueError("Dokumentzustand zu gross")
    return _encrypt_gz(raw, aad_state(doc_uid))


def decrypt_state(ciphertext: str, doc_uid: str) -> bytes:
    return _decrypt_gz(ciphertext, aad_state(doc_uid))


def encrypt_revision_state(raw: bytes, doc_uid: str, rev: int) -> str:
    if len(raw) > STATE_LIMIT_BYTES:
        raise ValueError("Dokumentzustand zu gross")
    return _encrypt_gz(raw, aad_revision(doc_uid, rev, "state"))


def decrypt_revision_state(ciphertext: str, doc_uid: str, rev: int) -> bytes:
    return _decrypt_gz(ciphertext, aad_revision(doc_uid, rev, "state"))


def encrypt_blob(raw: bytes, aad: str) -> str:
    return DisClient.encrypt(base64.b64encode(raw).decode("ascii"), aad)


def decrypt_blob(ciphertext: str, aad: str) -> bytes:
    klartext = decrypt_text(ciphertext, aad)
    try:
        return base64.b64decode(klartext, validate=True)
    except binascii.Error as exc:
        raise DocCryptoError("Binaerdaten beschaedigt") from exc
