"""Kryptobibliotheken stehen hinter einer Fassade, nicht in der Fachlogik.

`docs/agent-rules/security.md` §4 verlangt: „Fachlogik importiert
Kryptobibliotheken nicht direkt, sondern nutzt eine zentrale Fassade oder einen
Adapter.“ Die Fassade des Panels ist `services.dis_client.DisClient` (HTTP zum
DIS-Sidecar). Wo der Sidecar technisch nicht in den Pfad passt, steht die
Ausnahme unten mit Begründung.

Gelesen wird per AST, damit auch Importe in Funktionen auffallen (etwa in
`postgres_instance_service`). `hashlib`, `hmac`, `secrets` und `jwt` sind
bewusst nicht dabei: sie sind Plattform-Bausteine für Prüfsummen, Token-Bindung
und Signaturen und verschlüsseln keine Nutzerdaten.
"""

from __future__ import annotations

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

# Fremde Kryptobibliotheken. Eine neue gehört nicht in die Fachlogik, sondern
# hinter die Fassade — oder mit Begründung nach ERLAUBT.
BIBLIOTHEKEN = {"cryptography", "passlib", "nacl", "bcrypt", "Crypto", "Cryptodome"}

# Nicht durchsucht: Prüfcode und Laufzeitreste. Migrationen gehören dazu, weil
# eine Migration, die selbst Krypto einführt, nicht historisch ist, sondern neu.
AUSGENOMMEN = {
    "tests",
    "__pycache__",
    "logs",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "venv",
    "site-packages",
    "node_modules",
}

# Datei -> Begründung. Eine Ausnahme steht hier, nicht als Kommentar verstreut.
ERLAUBT = {
    "services/ai_memory_vektor.py": (
        "Vektorspalte: AES-GCM mit dem Panel-Secret, weil der Sidecar je Zeile "
        "einen Roundtrip kostete; Schutzumfang steht am Modellfeld."
    ),
    "services/auth_service.py": (
        "passlib prüft Alt-Hashes ($argon2id$v=19$), bis alle Konten auf DIS "
        "umgehüllt sind; neue Hashes gehen über DisClient."
    ),
    "services/e2ee_device_service.py": (
        "Der Server prüft die ECDSA-Unterschrift eines freigegebenen Geräts "
        "selbst; der private Schlüssel liegt nie hier."
    ),
    "services/passkey_service.py": (
        "WebAuthn-Signaturprüfung gegen den gespeicherten öffentlichen "
        "Schlüssel; dafür gibt es keinen DIS-Weg."
    ),
    "services/postgres_instance_service.py": (
        "Erzeugt selbstsignierte TLS-Zertifikate für Postgres-Instanzen; DIS "
        "stellt keine Zertifikate aus."
    ),
    "services/webpush_service.py": (
        "RFC 8291: die Nutzlast wird gegen den Browser-Schlüssel verschlüsselt, "
        "der nur dort liegt; gegen die Testvektoren aus RFC 8291 §5 geprüft."
    ),
    "scripts/migrate_to_dis.py": (
        "Einmalige Migration alter Fernet-Werte nach DIS; liest das alte "
        "Format, das es sonst nirgends mehr gibt."
    ),
}


def _krypto_importe(pfad: Path) -> set[str]:
    baum = ast.parse(pfad.read_text(encoding="utf-8"))
    gefunden: set[str] = set()
    for knoten in ast.walk(baum):
        if isinstance(knoten, ast.Import):
            for alias in knoten.names:
                wurzel = alias.name.split(".")[0]
                if wurzel in BIBLIOTHEKEN:
                    gefunden.add(wurzel)
        elif isinstance(knoten, ast.ImportFrom) and knoten.module:
            wurzel = knoten.module.split(".")[0]
            if wurzel in BIBLIOTHEKEN:
                gefunden.add(wurzel)
    return gefunden


def _dateien() -> list[Path]:
    return [
        pfad
        for pfad in BACKEND.rglob("*.py")
        if not any(teil in AUSGENOMMEN for teil in pfad.relative_to(BACKEND).parts)
    ]


def test_kryptobibliotheken_nur_hinter_erlaubter_fassade() -> None:
    funde = []
    for pfad in _dateien():
        relativ = pfad.relative_to(BACKEND).as_posix()
        if relativ in ERLAUBT:
            continue
        for bibliothek in sorted(_krypto_importe(pfad)):
            funde.append(f"{relativ}: importiert {bibliothek}")
    assert not funde, (
        "Kryptobibliothek direkt in der Fachlogik. Nutze "
        "services.dis_client.DisClient oder trage die Datei mit Begründung in "
        "ERLAUBT ein:\n" + "\n".join(funde)
    )


def test_jede_erlaubte_datei_existiert_noch() -> None:
    fehlend = [name for name in ERLAUBT if not (BACKEND / name).is_file()]
    assert not fehlend, "ERLAUBT nennt fehlende Dateien: " + ", ".join(fehlend)
