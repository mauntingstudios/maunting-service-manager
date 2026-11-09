"""Zentrales Schreiben von Audit-Eintraegen ohne Secrets.

KISS: ein Helper fuer privilegierte SaaS-Aktionen. Kein zweiter Event-Bus.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import String, and_, cast, func, or_
from sqlalchemy.orm import Session

from models import AuditLog, Node, Role, Server, Team, User

# Keys / Patterns, die nie in audit_logs.details landen duerfen.
_SECRET_KEY_RE = re.compile(
    r"(password|passwd|secret|token|authorization|api[_-]?key|credential)",
    re.IGNORECASE,
)
_MAX_DETAILS_LEN = 500
AUDIT_ORIGINS = frozenset({"direct", "ai", "external", "system"})


def _redact_mapping(data: dict[str, Any]) -> dict[str, Any]:
    """Entfernt secret-aehnliche Schluessel aus einem Dict fuer Audit-Details."""
    safe: dict[str, Any] = {}
    for key, value in data.items():
        if _SECRET_KEY_RE.search(str(key)):
            safe[str(key)] = "[redacted]"
            continue
        if isinstance(value, dict):
            safe[str(key)] = _redact_mapping(value)
        elif isinstance(value, str) and len(value) > 64 and _SECRET_KEY_RE.search(key):
            safe[str(key)] = "[redacted]"
        else:
            # Keine langen freien Strings (SQL, dumps) ins Audit.
            if isinstance(value, str) and len(value) > 200:
                safe[str(key)] = value[:200] + "…"
            else:
                safe[str(key)] = value
    return safe


def sanitize_audit_details(details: str | dict[str, Any] | None) -> str | None:
    """Normalisiert Audit-Details und entfernt erkennbare Secrets."""
    if details is None:
        return None
    if isinstance(details, dict):
        text = json.dumps(_redact_mapping(details), ensure_ascii=True, sort_keys=True, default=str)
    else:
        text = str(details).strip()
        # Grobe Absicherung: bekannte Secret-Praefixe in freiem Text maskieren.
        if "password=" in text.lower() or "token=" in text.lower():
            text = re.sub(
                r"(?i)(password|token|secret|authorization)\s*=\s*\S+",
                r"\1=[redacted]",
                text,
            )
    if not text:
        return None
    if len(text) > _MAX_DETAILS_LEN:
        return text[:_MAX_DETAILS_LEN] + "…"
    return text


def record_privileged_action(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    target_type: str | None = None,
    target_id: str | int | None = None,
    details: str | dict[str, Any] | None = None,
    origin: str = "direct",
    correlation_id: str | UUID | None = None,
    commit: bool = False,
) -> AuditLog:
    """Schreibt einen AuditLog-Eintrag fuer privilegierte Operator-Aktionen.

    Speichert wer/wann/was/Ziel. Nie Passwoerter, Tokens oder SQL-Payloads.
    Bei commit=False bleibt der Eintrag in der offenen Transaktion des Callers.
    """
    action_clean = (action or "").strip()
    if not action_clean or len(action_clean) > 64:
        raise ValueError("Ungueltiger Audit-Action-Key.")
    if target_type is not None and len(target_type) > 64:
        raise ValueError("Ungueltiger Audit-Target-Typ.")
    origin_clean = (origin or "").strip().lower()
    if origin_clean not in AUDIT_ORIGINS:
        raise ValueError("Ungueltige Audit-Herkunft.")
    try:
        correlation_clean = str(UUID(str(correlation_id))) if correlation_id else str(uuid4())
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValueError("Ungueltige Audit-Korrelations-ID.") from exc

    entry = AuditLog(
        user_id=user_id,
        action=action_clean,
        target_type=target_type,
        # Einheitlich als Text: die Aufrufer uebergeben teils Zahlen
        # (Benutzer, Server), teils UUIDs (Memory, Skills, Anhaenge).
        target_id=None if target_id is None else str(target_id),
        origin=origin_clean,
        correlation_id=correlation_clean,
        details=sanitize_audit_details(details),
    )
    db.add(entry)
    if commit:
        try:
            db.commit()
            db.refresh(entry)
        except Exception:
            db.rollback()
            raise
    return entry


# Ein Lese-Eintrag je Benutzer, Ziel und Zugriffsart in diesem Fenster. Ohne
# den Deckel fuellt das 5-Sekunden-Polling der Oberflaeche die Tabelle in
# Stunden — der Erkenntniswert bleibt derselbe: "hat in dem Zeitraum gelesen".
READ_ACCESS_DEDUPE = timedelta(minutes=10)

READ_ACCESS_ACTIONS = frozenset(
    {"server.console.read", "server.logs.read", "server.files.read"}
)


def record_read_access(
    db: Session,
    *,
    user_id: int,
    server_id: int,
    action: str,
    details: str | dict[str, Any] | None = None,
    origin: str = "direct",
) -> AuditLog | None:
    """Protokolliert Lesezugriff auf Konsole, Logs oder Dateien eines Servers.

    Wird an den Panel-Routern aufgerufen, nie in der Rechtepruefung — die
    bleibt read-only. KI-Laeufe protokollieren ihre Werkzeugaufrufe bereits im
    Lauf selbst und laufen nicht ueber diesen Helfer. Gibt None zurueck, wenn
    im Dedupe-Fenster bereits ein gleicher Eintrag existiert.
    """
    if action not in READ_ACCESS_ACTIONS:
        raise ValueError("Unbekannte Lesezugriffs-Aktion.")
    cutoff = datetime.now(timezone.utc) - READ_ACCESS_DEDUPE
    recent = (
        db.query(AuditLog.id)
        .filter(
            AuditLog.user_id == user_id,
            AuditLog.action == action,
            AuditLog.target_type == "server",
            AuditLog.target_id == str(server_id),
            AuditLog.created_at >= cutoff,
        )
        .first()
    )
    if recent is not None:
        return None
    return record_privileged_action(
        db,
        user_id=user_id,
        action=action,
        target_type="server",
        target_id=server_id,
        details=details,
        origin=origin,
        commit=True,
    )


# ── Einordnung fuer Oberflaeche und KI ─────────────────────────────────────
#
# Die Einordnung ist Darstellung, keine Autorisierung: sie entscheidet ueber
# Symbol, Farbe und Filter, nie ueber Zugriff. Die Rechte bleiben am Aufrufer
# (`system.audit.read`).

AUDIT_KATEGORIEN = (
    "server",
    "configuration",
    "user",
    "role",
    "team",
    "backup",
    "security",
    "ai",
    "docs",
    "billing",
    "system",
)

# Reihenfolge zaehlt: die erste passende Regel gewinnt. `user.roles.*` ist eine
# Rollenaenderung, keine Benutzeraenderung, und `server.backups.*` ein Backup,
# keine Serveraktion. Die SQL-Filter unten spiegeln dieselbe Reihenfolge.
_KATEGORIE_REGELN: tuple[tuple[str, tuple[str, ...], tuple[str, ...]], ...] = (
    ("backup", ("server.backups.", "panel.backup", "backup."), ()),
    (
        "security",
        (
            "auth.",
            "credential.",
            "server.credential.",
            "device.",
            "vault.",
            "team.vault.",
            "guardian.",
            "nodes.token.",
            "nodes.enrollment.",
            "postgres.admin.",
            "panel.settings.",
            "panel.livekit.",
            "social.call.",
        ),
        (),
    ),
    (
        "role",
        (
            "roles.",
            "user.roles.",
            "team.role.",
            "team.member.roles.",
            "team.server.",
            "team.server_roles.",
        ),
        (),
    ),
    ("user", ("user.", "users."), ("user.roles.",)),
    (
        "team",
        ("team.",),
        (
            "team.role.",
            "team.member.roles.",
            "team.server.",
            "team.server_roles.",
            "team.vault.",
        ),
    ),
    ("ai", ("ai.",), ()),
    ("docs", ("docs.", "document."), ()),
    ("billing", ("hoster.",), ()),
    (
        "configuration",
        ("blueprints.", "server.firewall", "server.config", "panel.popup"),
        (),
    ),
    (
        "server",
        ("server.",),
        ("server.backups.", "server.credential.", "server.firewall", "server.config"),
    ),
)


def audit_kategorie(action: str | None) -> str:
    """Ordnet eine Aktion einer der sieben sichtbaren Gruppen zu."""
    text = (action or "").strip().lower()
    for kategorie, praefixe, ausschluesse in _KATEGORIE_REGELN:
        if not text.startswith(praefixe):
            continue
        if ausschluesse and text.startswith(ausschluesse):
            continue
        return kategorie
    return "system"


def audit_ergebnis(action: str | None, details: str | None = None) -> str:
    """`failed` nur, wenn der Eintrag es hergibt — nie aus dem Bauch.

    Der laengste Weg ist ein `.failed` in der Aktion. Dazu kommen
    Fehlercodes und ausdrueckliche Erfolgs-/Statusfelder in den Details. Ein
    fehlender Wert heisst nicht „gescheitert“; er heisst nur, dass der Eintrag
    nichts darueber sagt.
    """
    text = (action or "").strip().lower()
    if (
        text.endswith(".failed")
        or text.endswith(".fehlgeschlagen")
        or text.endswith(".denied")
    ):
        return "failed"
    if not details:
        return "success"
    try:
        daten = json.loads(details)
    except (TypeError, ValueError):
        return "success"
    if not isinstance(daten, dict):
        return "success"
    if daten.get("error_code") not in (None, "", False):
        return "failed"
    if daten.get("success") is False:
        return "failed"
    if str(daten.get("status") or "").strip().lower() in {"failed", "error", "fehlgeschlagen"}:
        return "failed"
    return "success"


def audit_sicherheitsrelevant(action: str | None) -> bool:
    """Ob ein Eintrag unter „Sicherheitsrelevant“ zaehlt.

    Das sind Zugang, Geheimnisse und Rechte — die Felder, in denen ein Fehlgriff
    fremden Zugang schafft. Reine Betriebsaktionen (Start, Stopp, Backup)
    zaehlen nicht, auch wenn sie wichtig sind. Ein verweigerter Dokumentzugriff
    steht in der Kategorie `docs`, ist aber ein Rechtefehler und zaehlt deshalb
    hier mit.
    """
    return (
        audit_kategorie(action) in {"security", "role"}
        or (action or "").strip().lower() == "docs.access.denied"
    )


def _sicherheits_bedingung():
    """SQL-Fassung von `audit_sicherheitsrelevant` fuer die Kennzahlen."""
    return or_(
        _kategorie_bedingung("security"),
        _kategorie_bedingung("role"),
        AuditLog.action == "docs.access.denied",
    )


def _kategorie_bedingung(kategorie: str):
    """SQL-Fassung von `audit_kategorie`, damit Filter und Anzeige gleich sind."""
    if kategorie not in AUDIT_KATEGORIEN:
        raise ValueError("Unbekannte Audit-Kategorie.")

    def treffer(praefixe: tuple[str, ...], ausschluesse: tuple[str, ...]):
        bedingung = or_(*[AuditLog.action.like(f"{praefix}%") for praefix in praefixe])
        if ausschluesse:
            bedingung = and_(
                bedingung,
                ~or_(*[AuditLog.action.like(f"{ausschluss}%") for ausschluss in ausschluesse]),
            )
        return bedingung

    if kategorie == "system":
        bekannt = [treffer(praefixe, ausschluesse) for _, praefixe, ausschluesse in _KATEGORIE_REGELN]
        return ~or_(*bekannt)

    for name, praefixe, ausschluesse in _KATEGORIE_REGELN:
        if name == kategorie:
            return treffer(praefixe, ausschluesse)
    return _kategorie_bedingung("system")


def _failed_bedingung():
    """Was als gescheitert gilt — dieselbe Regel wie `audit_ergebnis` in SQL."""
    return or_(
        AuditLog.action.like("%.failed"),
        AuditLog.action.like("%.fehlgeschlagen"),
        AuditLog.action.like("%.denied"),
        AuditLog.details.like('%"error_code": "%'),
        AuditLog.details.like('%"success": false%'),
        AuditLog.details.like('%"status": "failed"%'),
        AuditLog.details.like('%"status": "error"%'),
        AuditLog.details.like('%"status": "fehlgeschlagen"%'),
    )


def _such_bedingungen(db: Session, search: str) -> list:
    """Freitext ueber Aktion, Details, Vorgang, Benutzer- und Servernamen."""
    like = f"%{search.strip()}%"
    benutzer_ids = db.query(User.id).filter(User.username.ilike(like))
    server_ids = db.query(cast(Server.id, String)).filter(Server.name.ilike(like))
    return [
        or_(
            AuditLog.action.ilike(like),
            AuditLog.details.ilike(like),
            AuditLog.correlation_id.ilike(like),
            AuditLog.target_id.ilike(like),
            AuditLog.user_id.in_(benutzer_ids),
            and_(AuditLog.target_type == "server", AuditLog.target_id.in_(server_ids)),
        )
    ]


def suche_audit_logs(
    db: Session,
    *,
    limit: int = 25,
    offset: int = 0,
    action: str | None = None,
    target_type: str | None = None,
    target_id: str | int | None = None,
    user_id: int | None = None,
    search: str | None = None,
    origin: str | None = None,
    result: str | None = None,
    kategorie: str | None = None,
    tage: int | None = None,
    jetzt: datetime | None = None,
) -> tuple[list[AuditLog], int]:
    """Filterbare Audit-Suche mit Gesamtzahl fuer die Seitenleiste.

    `tage` ist ein Fenster ab jetzt; `limit`/`offset` blaettern darin. Die
    Gesamtzahl kommt aus derselben Bedingung wie die Zeilen — sonst behauptet
    die Oberflaeche eine andere Menge, als sie zeigt.
    """
    limit = min(max(int(limit), 1), 200)
    offset = max(int(offset), 0)
    bedingungen: list = []

    if tage is not None:
        start = (jetzt or datetime.now(timezone.utc)) - timedelta(days=min(max(int(tage), 1), 365))
        bedingungen.append(AuditLog.created_at >= start)
    if action:
        bedingungen.append(AuditLog.action == action.strip())
    if target_type:
        bedingungen.append(AuditLog.target_type == target_type.strip())
    if target_id is not None:
        bedingungen.append(AuditLog.target_id == str(target_id))
    if user_id is not None:
        bedingungen.append(AuditLog.user_id == int(user_id))
    if search and search.strip():
        bedingungen.extend(_such_bedingungen(db, search))
    if origin:
        bedingungen.append(AuditLog.origin == origin.strip())
    if kategorie:
        bedingungen.append(_kategorie_bedingung(kategorie.strip()))
    if result == "failed":
        bedingungen.append(_failed_bedingung())
    elif result == "success":
        bedingungen.append(~_failed_bedingung())

    basis = db.query(AuditLog).filter(*bedingungen)
    gesamt = basis.count()
    rows = (
        basis.order_by(AuditLog.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return rows, int(gesamt)


def audit_uebersicht(
    db: Session,
    *,
    tage: int = 7,
    jetzt: datetime | None = None,
) -> dict[str, Any]:
    """Kennzahlen fuer einen Zeitraum samt Vergleich zum Zeitraum davor."""
    tage = min(max(int(tage), 1), 365)
    ende = jetzt or datetime.now(timezone.utc)
    start = ende - timedelta(days=tage)
    vorher_start = start - timedelta(days=tage)

    def zahlen(von: datetime, bis: datetime) -> dict[str, int]:
        basis = db.query(AuditLog).filter(
            AuditLog.created_at >= von,
            AuditLog.created_at < bis,
        )
        return {
            "total": int(basis.count()),
            "users": int(
                basis.with_entities(func.count(func.distinct(AuditLog.user_id))).scalar() or 0
            ),
            "security": int(basis.filter(_sicherheits_bedingung()).count()),
            "failed": int(basis.filter(_failed_bedingung()).count()),
        }

    gruppen = (
        db.query(AuditLog.action, func.count(AuditLog.id))
        .filter(AuditLog.created_at >= start, AuditLog.created_at < ende)
        .group_by(AuditLog.action)
        .all()
    )
    nach_kategorie: dict[str, int] = {}
    for aktion, anzahl in gruppen:
        name = audit_kategorie(aktion)
        nach_kategorie[name] = nach_kategorie.get(name, 0) + int(anzahl)
    top_aktionen = sorted(gruppen, key=lambda paar: (-int(paar[1]), paar[0]))[:10]

    return {
        "range_days": tage,
        "start": start.isoformat(),
        "end": ende.isoformat(),
        "current": zahlen(start, ende),
        "previous": zahlen(vorher_start, start),
        "by_category": [
            {"category": name, "count": anzahl}
            for name, anzahl in sorted(nach_kategorie.items(), key=lambda paar: (-paar[1], paar[0]))
        ],
        "top_actions": [
            {"action": aktion, "category": audit_kategorie(aktion), "count": int(anzahl)}
            for aktion, anzahl in top_aktionen
        ],
    }


def _ziel_namen(db: Session, rows: list[AuditLog]) -> dict[tuple[str, str], str]:
    """Loest Zielkennungen gesammelt auf — hoechstens eine Abfrage je Art."""
    ids: dict[str, set[int]] = {}
    for row in rows:
        if not row.target_type or row.target_id is None:
            continue
        try:
            zahl = int(str(row.target_id))
        except (TypeError, ValueError):
            continue
        ids.setdefault(row.target_type, set()).add(zahl)

    namen: dict[tuple[str, str], str] = {}
    modelle = {
        "server": Server,
        "user": User,
        "users": User,
        "roles": Role,
        "role": Role,
        "team": Team,
        "node": Node,
        "nodes": Node,
        "managed_node": Node,
    }
    for typ, kennungen in ids.items():
        modell = modelle.get(typ)
        if modell is None or not kennungen:
            continue
        # `User` traegt seinen Namen in `username`, alle anderen in `name`.
        spalte = modell.username if modell is User else modell.name
        for kennung, name in db.query(modell.id, spalte).filter(modell.id.in_(kennungen)).all():
            if name:
                namen[(typ, str(kennung))] = str(name)
    return namen


def audit_zeilen(db: Session, rows: list[AuditLog]) -> list[dict[str, Any]]:
    """Anzeigefertige Zeilen: Name des Benutzers, Zielname, Gruppe, Ergebnis.

    Die Details werden beim Anzeigen noch einmal durch dieselbe Redaktion
    geschickt wie beim Schreiben. Ein Altbestand aus einer Fassung vor der
    Redaktion soll nicht durch die neue Oberflaeche sichtbar werden.
    """
    benutzer_ids = {row.user_id for row in rows if row.user_id is not None}
    benutzernamen = (
        dict(db.query(User.id, User.username).filter(User.id.in_(benutzer_ids)).all())
        if benutzer_ids
        else {}
    )
    zielnamen = _ziel_namen(db, rows)

    ergebnis: list[dict[str, Any]] = []
    for row in rows:
        typ = row.target_type
        ziel = zielnamen.get((typ or "", str(row.target_id))) if typ and row.target_id is not None else None
        ergebnis.append(
            {
                "id": row.id,
                "user_id": row.user_id,
                "username": benutzernamen.get(row.user_id) if row.user_id is not None else None,
                "action": row.action,
                "category": audit_kategorie(row.action),
                "result": audit_ergebnis(row.action, row.details),
                "target_type": row.target_type,
                "target_id": row.target_id,
                "target_label": ziel,
                "origin": row.origin,
                "correlation_id": row.correlation_id,
                "details": sanitize_audit_details(row.details),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return ergebnis
