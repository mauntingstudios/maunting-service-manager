"""Singra KI-Router (Smart Model Routing) — semantisch + mathematisch ohne Wortlisten.

Kombiniert das lokale Satz-Embedding (`paraphrase-multilingual-MiniLM-L12-v2`, ~6 ms)
bzw. den konfigurierten Betreiber-Rueckfall (Google AI Studio / OpenAI) mit rein
mathematisch-strukturellen Signalen (Textlaenge, Zeilenstruktur, Syntaxdichte,
Anhaenge, Reasoning, Verlaufstiefe). Enthaelt bewusst keine Regex- oder Wortlisten.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from typing import TYPE_CHECKING, Iterable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import AiProvider, AiRouterConfig
from services import ai_embedding_service, ai_provider_registry, ai_provider_service

if TYPE_CHECKING:
    from models import User


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

_TIER_PROTOTYPES: dict[str, tuple[str, ...]] = {
    "eco": (
        "Kurze Begrüßung, Hallo, Guten Tag, Danke, Smalltalk oder Verabschiedung. "
        "Short greeting, hello, thanks, smalltalk or goodbye.",
        "Einfache Wissensfrage, kurze Erklärung, kleine Übersetzung, Rechtschreibprüfung oder knappe Zusammenfassung. "
        "Simple factual question, quick definition, short translation, spell check or brief summary.",
        "Kleine Routineaufgabe, einzelne Konfigurationszeile anpassen, Mod installieren oder Port freigeben. "
        "Simple routine task, tweak a single config option, install a mod or change one setting.",
    ),
    "standard": (
        "Alltägliche technische Arbeitsaufgabe, Server-Status prüfen, Logs analysieren oder Dienst neu starten. "
        "Everyday technical support, inspect server status, read logs or restart a service.",
        "Einzelne Funktion schreiben, Hilfsskript erstellen, konkreten Bug eingrenzen oder API-Aufruf umsetzen. "
        "Write a helper script, implement a single endpoint or debug a localized bug.",
        "Vergleich mehrerer Optionen, schrittweise Anleitung oder strukturierte Auswertung von Daten. "
        "Compare technical options, write a step-by-step guide or evaluate structured data.",
    ),
    "flagship": (
        "Komplexe Softwarearchitektur entwerfen, Systemdesign über mehrere Module und langfristige Abwägungen. "
        "Design complex software architecture across multiple modules and evaluate deep trade-offs.",
        "Tiefes Root-Cause-Debugging über Stacktraces und verteilte Komponenten oder kritisches Refactoring. "
        "Deep root-cause debugging across stacktraces and distributed systems or large refactoring.",
        "Umfassendes Sicherheitsaudit, Schwachstellenanalyse, Kryptographie oder komplexe Datenbank-Migration. "
        "Comprehensive security audit, vulnerability analysis, cryptography or complex database migration.",
    ),
}

_SYNTAX_CHARS = frozenset("{}()[];=/\\`<>|")

_COOLDOWN_LOCK = threading.Lock()
_COOLDOWNS: dict[tuple[int, str], float] = {}

_PROTO_LOCK = threading.Lock()
_PROTO_CACHE: dict[str, dict[str, list[list[float]]]] = {}


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


def _encode_single(
    text: str, *, db: Session | None = None
) -> tuple[list[float], str] | None:
    """Kodiert einen Text ueber lokales Embedding oder Betreiber-Rueckfall."""
    res = ai_embedding_service.encode([text[:1500]], db=db)
    if res is None or not res.vektoren:
        return None
    return list(res.vektoren[0]), res.modell


def _get_tier_prototypes(
    model_tag: str, *, db: Session | None = None
) -> dict[str, list[list[float]]] | None:
    """Laedt bzw. berechnet die Prototyp-Vektoren passend zum aktiven Modellraum."""
    with _PROTO_LOCK:
        cached = _PROTO_CACHE.get(model_tag)
        if cached is not None:
            return cached

    ordered_tiers: list[str] = []
    flat_texts: list[str] = []
    for tier, phrases in _TIER_PROTOTYPES.items():
        for phrase in phrases:
            ordered_tiers.append(tier)
            flat_texts.append(phrase)

    res = ai_embedding_service.encode(flat_texts, db=db)
    if res is None or len(res.vektoren) != len(flat_texts):
        return None

    grouped: dict[str, list[list[float]]] = {t: [] for t in _TIER_PROTOTYPES}
    for tier, vec in zip(ordered_tiers, res.vektoren):
        grouped[tier].append(list(vec))

    with _PROTO_LOCK:
        _PROTO_CACHE[res.modell] = grouped
        return _PROTO_CACHE.get(model_tag)


def _semantic_classify(
    text: str, *, db: Session | None = None
) -> tuple[str, float, str] | None:
    """Semantische Stufenerkennung ueber lokales Modell oder konfigurierten Rueckfall."""
    if not text:
        return None
    try:
        encoded = _encode_single(text, db=db)
        if encoded is None:
            return None
        query_vec, model_tag = encoded
        protos = _get_tier_prototypes(model_tag, db=db)
        if not protos:
            return None

        scores = {
            tier: max(_cosine_similarity(query_vec, pvec) for pvec in vecs)
            for tier, vecs in protos.items()
            if vecs
        }
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        if len(ranked) < 2:
            return None
        margin = ranked[0][1] - ranked[1][1]
        return ranked[0][0], margin, model_tag
    except Exception:
        logger.debug("Router-Embedding-Klassifikation uebersprungen", exc_info=True)
        return None


def _structural_score(
    cleaned: str,
    *,
    has_images: bool,
    reasoning: bool,
    history_len: int,
) -> float:
    """Rein mathematische Komplexitaetsbewertung ohne Wortlisten oder Regex."""
    length = len(cleaned)
    if length <= 60:
        score = 0.10
    elif length <= 220:
        score = 0.24
    elif length <= 700:
        score = 0.42
    elif length <= 1800:
        score = 0.58
    else:
        score = 0.74

    lines = cleaned.count("\n") + 1
    if lines >= 12:
        score += 0.14
    elif lines >= 4:
        score += 0.07

    non_ws = sum(1 for ch in cleaned if not ch.isspace())
    if non_ws >= 20:
        syntax_count = sum(1 for ch in cleaned if ch in _SYNTAX_CHARS)
        density = syntax_count / non_ws
        if density >= 0.08:
            score += 0.18
        elif density >= 0.04:
            score += 0.10

    if has_images:
        score += 0.18
    if reasoning:
        score += 0.12
    if history_len >= 8:
        score += 0.06

    return round(max(0.0, min(1.0, score)), 3)


def classify_request(
    *,
    text: str,
    has_images: bool = False,
    reasoning: bool = False,
    project_id: str | None = None,
    history_len: int = 0,
    db: Session | None = None,
) -> tuple[str, float, str]:
    """Klassifiziert eine Anfrage semantisch und rein mathematisch in ``eco``, ``standard`` oder ``flagship``."""
    del project_id  # Projektkontext allein erzwingt kein hoeheres Modell mehr
    cleaned = (text or "").strip()
    struct_score = _structural_score(
        cleaned,
        has_images=has_images,
        reasoning=reasoning,
        history_len=history_len,
    )

    math_tier = "eco" if struct_score < 0.30 else ("flagship" if struct_score > 0.65 else "standard")
    semantic = _semantic_classify(cleaned, db=db)

    if semantic is not None:
        sem_tier, margin, model_tag = semantic
        source = "local" if model_tag == ai_embedding_service.MODEL_TAG else "remote"

        if struct_score >= 0.80:
            return "flagship", struct_score, f"semantic_{source}"

        if margin >= 0.02:
            tier = sem_tier
            if has_images and tier == "eco":
                tier = "standard"
            if struct_score >= 0.70 and tier == "eco":
                tier = "standard"
            elif struct_score >= 0.75 and tier == "standard":
                tier = "flagship"
            return tier, struct_score, f"semantic_{source}"

        tie_tier = math_tier
        if has_images and tie_tier == "eco":
            tie_tier = "standard"
        return tie_tier, struct_score, "math_tiebreaker"

    if has_images and math_tier == "eco":
        math_tier = "standard"
    return math_tier, struct_score, "math_fallback"


def resolve_route_for_text(
    db: Session,
    *,
    user: "User",
    text: str,
    has_images: bool = False,
    reasoning: bool = False,
    project_id: str | None = None,
    history_len: int = 0,
) -> tuple[AiProvider, str, dict] | None:
    """Klassifiziert eine Anfrage, prueft 5h-Soft-Cap und liefert (Provider, Modell, routing_meta)."""
    from services import ai_limit_service, ai_usage_service

    effective_limits = ai_limit_service.resolve_effective_limits(db, user)
    soft_cap = bool(
        effective_limits.soft_cap_downgrade
        and ai_usage_service.is_five_hour_limit_exceeded(
            db, user, max(1, len(text) // 4 + 2048)
        )
    )
    if soft_cap:
        tier, score, route_reason = "fallback", 0.0, "soft_cap_5h"
    else:
        tier, score, route_reason = classify_request(
            text=text,
            has_images=has_images,
            reasoning=reasoning,
            project_id=project_id,
            history_len=history_len,
            db=db,
        )
    candidates = resolve_candidates(db, tier=tier, soft_cap=soft_cap)
    for idx, cand in enumerate(candidates):
        resolved = db.get(AiProvider, cand["provider_id"])
        if resolved is None or not resolved.enabled:
            continue
        routing_meta = {
            "tier": cand["tier"],
            "model": cand["model"],
            "provider_id": cand["provider_id"],
            "provider_name": cand["provider_name"],
            "reason": route_reason,
            "score": score,
            "weight": cand["weight"],
            "soft_cap": soft_cap,
            "candidates": candidates,
            "candidate_index": idx,
        }
        return resolved, cand["model"], routing_meta
    return None


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
