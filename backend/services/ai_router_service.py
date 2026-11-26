"""Singra KI-Router (Smart Model Routing) — zweistufiges Routing ohne extra LLM-Kosten.

Stufe 1 bewertet jede Anfrage deterministisch (0-1 ms) nach Laenge, Code-/Fehler-
Mustern, Projektkontext, Reasoning-Anforderung und Anhaengen — inklusive
Qualitaets-Guard fuer Coding-Projekte und Multi-Step-Aufgaben.

Stufe 2 nutzt in der Grauzone (Score 0.35-0.65) optional das bereits geladene
lokale Satz-Embedding-Modell (`ai_embedding_service`), faellt aber konservativ
auf ``standard`` zurueck, falls das Modell offline/nicht geladen ist.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
from typing import Iterable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import AiProvider, AiRouterConfig
from services import ai_embedding_service, ai_provider_registry, ai_provider_service


logger = logging.getLogger(__name__)

ROUTER_PROVIDER_KIND = "singra_router"
ROUTER_PROVIDER_NAME = "Singra Router"
ROUTER_DEFAULT_MODEL = "auto"

TIERS = ("eco", "standard", "flagship", "fallback")
COOLDOWN_SECONDS = 60
WEIGHT_MIN = 0.1
WEIGHT_MAX = 10.0

_TIER_ORDER: dict[str, tuple[str, ...]] = {
    "eco": ("eco", "standard", "flagship", "fallback"),
    "standard": ("standard", "flagship", "eco", "fallback"),
    "flagship": ("flagship", "standard", "eco", "fallback"),
    "fallback": ("fallback", "eco", "standard", "flagship"),
}

_SIMPLE_GREETING_RE = re.compile(
    r"^(hallo|hi|hey|moin|servus|guten\s+(morgen|tag|abend)|"
    r"danke(\s+sch[oö]n)?|thanks|thank\s+you|thx|ok|okay|alles\s+klar|"
    r"tsch[uü]ss|bye|wie\s+geht(?:'s|\s+es\s+dir)?|how\s+are\s+you|wer\s+bist\s+du)[!.?\s]*$",
    re.IGNORECASE,
)

_CODE_SIGNAL_RE = re.compile(
    r"(```|traceback\b|exception:|stack\s*trace|diff\s+--git|"
    r"\b(def\s+\w+|class\s+\w+|function\s+\w+|async\s+def|const\s+\w+\s*=|"
    r"import\s+\w+|select\s+.+\s+from|create\s+table|alter\s+table|"
    r"systemctl|journalctl|docker\s+compose|kubernetes|kubectl|alembic)\b)",
    re.IGNORECASE,
)

_COMPLEX_KEYWORDS = (
    "architektur",
    "architecture",
    "refactor",
    "refactoring",
    "debug",
    "analyse",
    "analysiere",
    "analyze",
    "optimier",
    "optimize",
    "migration",
    "sicherheit",
    "security",
    "vulnerability",
    "schritt für schritt",
    "schritt fuer schritt",
    "step by step",
    "vergleich",
    "compare",
    "root cause",
    "ursache",
    "konzept",
    "implementier",
    "implement",
)

_PROTOTYPE_TEXTS: dict[str, str] = {
    "eco": (
        "Kurze Begrüßung, einfache Wissensfrage, kleine Übersetzung, Rechtschreibung prüfen "
        "oder knappe Zusammenfassung ohne Programmcode. "
        "Short greeting, quick factual question, simple translation or brief summary."
    ),
    "standard": (
        "Alltägliche Arbeitsaufgabe, Server-Status prüfen, Logzeilen erklären, kleine "
        "Konfigurationsänderung oder konkretes Hilfeskript schreiben. "
        "Everyday technical support, check logs, small configuration help or scripting."
    ),
    "flagship": (
        "Komplexe Softwarearchitektur, tiefes Debugging mit Stacktrace, Sicherheitsaudit, "
        "Datenbank-Migration, mehrstufige Systemanalyse und kritisches Refactoring. "
        "Complex architecture design, multi-file debugging, security audit and migration."
    ),
}

_COOLDOWN_LOCK = threading.Lock()
_COOLDOWNS: dict[tuple[int, str], float] = {}

_PROTO_LOCK = threading.Lock()
_PROTO_VECTORS: dict[str, list[float]] | None = None


def mark_model_cooldown(provider_id: int, model: str, seconds: int = COOLDOWN_SECONDS) -> None:
    """Sperrt eine (Provider, Modell)-Kombination kurzzeitig nach 429/5xx-Ausfaellen."""
    until = time.monotonic() + max(1, int(seconds))
    with _COOLDOWN_LOCK:
        _COOLDOWNS[(int(provider_id), str(model).strip())] = until


def is_in_cooldown(provider_id: int, model: str) -> bool:
    """True, solange das Modell noch in seiner Fehler-Abkuehlzeit liegt."""
    key = (int(provider_id), str(model).strip())
    now = time.monotonic()
    with _COOLDOWN_LOCK:
        until = _COOLDOWNS.get(key)
        if until is None:
            return False
        if now >= until:
            _COOLDOWNS.pop(key, None)
            return False
        return True


def clear_cooldowns() -> None:
    """Leert alle Modell-Cooldowns (vor allem fuer Tests)."""
    with _COOLDOWN_LOCK:
        _COOLDOWNS.clear()


def is_router_provider(provider: AiProvider | None) -> bool:
    """Prueft, ob ein Provider der eingebaute virtuelle Singra KI-Router ist."""
    return provider is not None and getattr(provider, "provider_kind", None) == ROUTER_PROVIDER_KIND


def _pool_field(tier: str) -> str:
    if tier not in TIERS:
        raise ValueError(f"Unbekannte Router-Stufe: {tier}")
    return f"{tier}_models_json"


def _weight_field(tier: str) -> str:
    if tier not in TIERS:
        raise ValueError(f"Unbekannte Router-Stufe: {tier}")
    return f"{tier}_weight"


def _clamp_weight(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 1.0
    if not math.isfinite(float(value)):
        return 1.0
    return round(max(WEIGHT_MIN, min(WEIGHT_MAX, float(value))), 2)


def parse_pool_json(raw: str | None) -> list[dict]:
    """Liest eine gespeicherte Pool-Liste robust als geordnete Liste aus."""
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except Exception:
        return []
    if not isinstance(items, list):
        return []
    result: list[dict] = []
    seen: set[tuple[int, str]] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_pid = item.get("provider_id")
        raw_model = item.get("model")
        if isinstance(raw_pid, bool):
            continue
        try:
            pid = int(raw_pid)
        except (TypeError, ValueError):
            continue
        model = str(raw_model or "").strip()
        if pid <= 0 or not model:
            continue
        key = (pid, model)
        if key in seen:
            continue
        seen.add(key)
        result.append({"provider_id": pid, "model": model[:256]})
    return result


def get_or_create_router_config(db: Session) -> AiRouterConfig:
    """Liefert die globale Singleton-Routerkonfiguration oder legt sie an."""
    cfg = db.get(AiRouterConfig, 1)
    if cfg is not None:
        return cfg
    try:
        with db.begin_nested():
            cfg = AiRouterConfig(id=1, enabled=False)
            db.add(cfg)
            db.flush()
            return cfg
    except IntegrityError:
        existing = db.get(AiRouterConfig, 1)
        if existing is not None:
            return existing
        raise


def ensure_router_provider(db: Session, *, enabled: bool | None = None) -> AiProvider:
    """Stellt sicher, dass der virtuelle Provider ``Singra Router`` existiert."""
    provider = (
        db.query(AiProvider)
        .filter(AiProvider.provider_kind == ROUTER_PROVIDER_KIND)
        .order_by(AiProvider.id.asc())
        .first()
    )
    if provider is None:
        try:
            with db.begin_nested():
                name = ROUTER_PROVIDER_NAME
                if db.query(AiProvider.id).filter(AiProvider.name == name).first() is not None:
                    name = "Singra Router (Auto)"
                provider = AiProvider(
                    name=name,
                    provider_kind=ROUTER_PROVIDER_KIND,
                    default_model=ROUTER_DEFAULT_MODEL,
                    enabled_models_json=json.dumps([ROUTER_DEFAULT_MODEL]),
                    allow_all_models=False,
                    standard_enabled=True,
                    requires_api_key=False,
                    enabled=bool(enabled) if enabled is not None else False,
                )
                db.add(provider)
                db.flush()
                return provider
        except IntegrityError:
            provider = (
                db.query(AiProvider)
                .filter(AiProvider.provider_kind == ROUTER_PROVIDER_KIND)
                .order_by(AiProvider.id.asc())
                .first()
            )
            if provider is None:
                raise
    else:
        changed = False
        if (provider.default_model or "").strip() != ROUTER_DEFAULT_MODEL:
            provider.default_model = ROUTER_DEFAULT_MODEL
            changed = True
        if provider.enabled_models_json != json.dumps([ROUTER_DEFAULT_MODEL]):
            provider.enabled_models_json = json.dumps([ROUTER_DEFAULT_MODEL])
            changed = True
        if provider.requires_api_key:
            provider.requires_api_key = False
            changed = True
        if not bool(getattr(provider, "standard_enabled", True)):
            provider.standard_enabled = True
            changed = True
        if enabled is not None and bool(provider.enabled) != bool(enabled):
            provider.enabled = bool(enabled)
            changed = True
        if changed:
            db.flush()
    return provider


def _eligible_provider_models(provider: AiProvider) -> list[str]:
    """Alle nutzbaren Chat-Modelle eines bereits konfigurierten Providers."""
    models: list[str] = []
    seen: set[str] = set()
    for candidate in (
        provider.default_model,
        *ai_provider_service.freigegebene_modelle(provider),
        provider.worker_model,
        provider.ethics_model,
    ):
        m = str(candidate or "").strip()
        if not m or m in seen:
            continue
        low = m.lower()
        if any(x in low for x in ("embedding", "dall-e", "tts-", "text-moderation", "whisper")):
            continue
        seen.add(m)
        models.append(m)
    return models


def _is_provider_usable_for_router(provider: AiProvider | None) -> bool:
    if provider is None or is_router_provider(provider) or not provider.enabled:
        return False
    if not ai_provider_registry.spricht(provider.provider_kind, ai_provider_registry.CHAT):
        return False
    if provider.requires_api_key and not provider.operator_api_key_encrypted:
        return False
    return True


def serialize_router_config(db: Session, cfg: AiRouterConfig, *, ensure_provider: bool = True) -> dict:
    """Bereitet Router-Konfiguration plus automatisch erkannte Provider-Modelle fuer das UI auf."""
    router_provider = (
        ensure_router_provider(db, enabled=cfg.enabled)
        if ensure_provider
        else db.query(AiProvider)
        .filter(AiProvider.provider_kind == ROUTER_PROVIDER_KIND)
        .order_by(AiProvider.id.asc())
        .first()
    )
    providers = (
        db.query(AiProvider)
        .filter(AiProvider.provider_kind != ROUTER_PROVIDER_KIND)
        .order_by(AiProvider.name.asc())
        .all()
    )
    providers_by_id = {p.id: p for p in providers}

    available_options: list[dict] = []
    for p in providers:
        if not _is_provider_usable_for_router(p):
            continue
        models = _eligible_provider_models(p)
        if models:
            available_options.append(
                {
                    "provider_id": p.id,
                    "provider_name": p.name,
                    "provider_kind": p.provider_kind,
                    "models": models,
                }
            )

    def _enrich_pool(raw: str | None) -> list[dict]:
        enriched: list[dict] = []
        for entry in parse_pool_json(raw):
            p = providers_by_id.get(entry["provider_id"])
            enriched.append(
                {
                    "provider_id": entry["provider_id"],
                    "model": entry["model"],
                    "provider_name": p.name if p is not None else f"Provider #{entry['provider_id']}",
                    "available": _is_provider_usable_for_router(p),
                }
            )
        return enriched

    eco_pool = _enrich_pool(cfg.eco_models_json)
    standard_pool = _enrich_pool(cfg.standard_models_json)
    flagship_pool = _enrich_pool(cfg.flagship_models_json)
    fallback_pool = _enrich_pool(cfg.fallback_models_json)
    total_active = sum(
        1 for pool in (eco_pool, standard_pool, flagship_pool, fallback_pool) for e in pool if e["available"]
    )
    return {
        "enabled": bool(cfg.enabled),
        "router_provider_id": router_provider.id if router_provider is not None else None,
        "ready": bool(cfg.enabled and total_active > 0),
        "eco_models": eco_pool,
        "standard_models": standard_pool,
        "flagship_models": flagship_pool,
        "fallback_models": fallback_pool,
        "eco_weight": float(cfg.eco_weight),
        "standard_weight": float(cfg.standard_weight),
        "flagship_weight": float(cfg.flagship_weight),
        "fallback_weight": float(cfg.fallback_weight),
        "available_providers": available_options,
        "updated_at": cfg.updated_at,
    }


def _validate_pool_entries(db: Session, entries: Iterable[dict] | None) -> list[dict]:
    if not entries:
        return []
    result: list[dict] = []
    seen: set[tuple[int, str]] = set()
    for item in entries:
        pid = int(item.get("provider_id"))
        model = str(item.get("model") or "").strip()
        if pid <= 0 or not model:
            raise ValueError("Jeder Pool-Eintrag benoetigt provider_id und model")
        provider = db.get(AiProvider, pid)
        if provider is None or is_router_provider(provider):
            raise ValueError(f"Ungueltiger Ziel-Provider {pid} im Router-Pool")
        if not ai_provider_registry.spricht(provider.provider_kind, ai_provider_registry.CHAT):
            raise ValueError(f"Provider {provider.name} unterstuetzt keinen Chat")
        key = (pid, model)
        if key in seen:
            continue
        seen.add(key)
        result.append({"provider_id": pid, "model": model[:256]})
    return result


def update_router_config(db: Session, payload: dict) -> dict:
    """Validiert und speichert Pools, Gewichte und Aktivierung des Singra KI-Routers."""
    cfg = get_or_create_router_config(db)
    if "enabled" in payload and payload["enabled"] is not None:
        cfg.enabled = bool(payload["enabled"])

    for tier in TIERS:
        key = f"{tier}_models"
        if key in payload and payload[key] is not None:
            cleaned = _validate_pool_entries(db, payload[key])
            setattr(cfg, _pool_field(tier), json.dumps(cleaned))
        w_key = _weight_field(tier)
        if w_key in payload and payload[w_key] is not None:
            w = float(payload[w_key])
            if not math.isfinite(w) or w < WEIGHT_MIN or w > WEIGHT_MAX:
                raise ValueError(f"Gewichtung fuer {tier} muss zwischen {WEIGHT_MIN} und {WEIGHT_MAX} liegen")
            setattr(cfg, w_key, round(w, 2))

    ensure_router_provider(db, enabled=cfg.enabled)
    db.flush()
    return serialize_router_config(db, cfg, ensure_provider=True)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _embedding_tiebreaker(text: str, *, guard_min_standard: bool) -> str | None:
    """Nutzt ausschliesslich das lokale Satz-Embedding fuer die Grauzone (0 kosten)."""
    global _PROTO_VECTORS
    if not text or not ai_embedding_service.is_ready():
        return None
    try:
        with _PROTO_LOCK:
            if _PROTO_VECTORS is None:
                proto_map: dict[str, list[float]] = {}
                for tier, desc in _PROTOTYPE_TEXTS.items():
                    vec = ai_embedding_service.encode(desc)
                    if vec is None:
                        return None
                    proto_map[tier] = list(vec)
                _PROTO_VECTORS = proto_map
            protos = _PROTO_VECTORS
        query_vec = ai_embedding_service.encode(text[:1500])
        if query_vec is None:
            return None
        q = list(query_vec)
        scores = {
            tier: _cosine_similarity(q, vec)
            for tier, vec in protos.items()
            if not (guard_min_standard and tier == "eco")
        }
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        if len(ranked) >= 2 and ranked[0][1] - ranked[1][1] >= 0.03:
            return ranked[0][0]
    except Exception:
        logger.debug("Router-Embedding-Tiebreaker uebersprungen", exc_info=True)
    return None


def classify_request(
    *,
    text: str,
    has_images: bool = False,
    reasoning: bool = False,
    project_id: str | None = None,
    history_len: int = 0,
) -> tuple[str, float, str]:
    """Klassifiziert eine Anfrage zweistufig in ``eco``, ``standard`` oder ``flagship``."""
    cleaned = (text or "").strip()
    low = cleaned.lower()
    length = len(cleaned)

    if length <= 60:
        score = 0.12
    elif length <= 220:
        score = 0.28
    elif length <= 700:
        score = 0.48
    elif length <= 1800:
        score = 0.64
    else:
        score = 0.80

    has_code = bool(_CODE_SIGNAL_RE.search(cleaned))
    if has_code:
        score += 0.28

    complex_hits = sum(1 for kw in _COMPLEX_KEYWORDS if kw in low)
    if complex_hits == 1:
        score += 0.22
    elif complex_hits >= 2:
        score += 0.34

    if not has_code and complex_hits == 0 and _SIMPLE_GREETING_RE.match(low):
        score -= 0.25

    if project_id:
        score += 0.24
    if reasoning:
        score += 0.20
    if has_images:
        score += 0.16
    if history_len >= 8:
        score += 0.08

    score = round(max(0.0, min(1.0, score)), 3)
    guard_min_standard = bool(project_id) or bool(reasoning) or has_code or bool(has_images)

    if score < 0.35 and not guard_min_standard:
        return "eco", score, "simple_score"
    if score < 0.35 and guard_min_standard:
        return "standard", max(0.35, score), "agentic_quality_guard"
    if score > 0.65:
        return "flagship", score, "complex_score"

    tied = _embedding_tiebreaker(cleaned, guard_min_standard=guard_min_standard)
    if tied in ("eco", "standard", "flagship"):
        return tied, score, "embedding_tiebreaker"
    return "standard", score, "grey_zone_default"


def resolve_candidates(
    db: Session,
    *,
    tier: str,
    soft_cap: bool = False,
) -> list[dict]:
    """Loest alle verfuegbaren Zielmodelle in priorisierter Failover-Reihenfolge auf."""
    cfg = get_or_create_router_config(db)
    order = ("fallback", "eco", "standard") if soft_cap else _TIER_ORDER.get(tier, _TIER_ORDER["standard"])

    providers = {
        p.id: p
        for p in db.query(AiProvider)
        .filter(AiProvider.provider_kind != ROUTER_PROVIDER_KIND)
        .all()
    }

    active: list[dict] = []
    cooled: list[dict] = []
    seen: set[tuple[int, str]] = set()

    for pool_tier in order:
        raw_pool = getattr(cfg, _pool_field(pool_tier), "[]")
        weight = _clamp_weight(getattr(cfg, _weight_field(pool_tier), 1.0))
        for entry in parse_pool_json(raw_pool):
            pid = entry["provider_id"]
            model = entry["model"]
            key = (pid, model)
            if key in seen:
                continue
            provider = providers.get(pid)
            if not _is_provider_usable_for_router(provider):
                continue
            seen.add(key)
            candidate = {
                "provider_id": pid,
                "provider_name": provider.name,
                "model": model,
                "tier": pool_tier,
                "weight": weight,
            }
            if is_in_cooldown(pid, model):
                cooled.append(candidate)
            else:
                active.append(candidate)

    return [*active, *cooled]
