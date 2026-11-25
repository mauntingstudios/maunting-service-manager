"""Provideruebergreifende 2026-Guardrails gegen Indirect Prompt Injection und Prompt-Leaks.

Alle Funktionen arbeiten rein funktional und ohne externe Abhaengigkeiten,
damit derselbe Schutz fuer Anthropic (Claude), OpenAI, OpenRouter, Google
und Custom-Provider greift.
"""

from __future__ import annotations

import re


_SAFE_SOURCE_RE = re.compile(r"[^A-Za-z0-9._-]+")
_OPEN_TAG_RE = re.compile(r"<\s*untrusted_data\b", re.IGNORECASE)
_CLOSE_TAG_RE = re.compile(r"<\s*/\s*untrusted_data\s*>", re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"\s+")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")

_INJECTION_SIGNALS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "ignore_previous_instructions",
        re.compile(
            r"\b(?:ignore|disregard|forget|override|bypass)\b.{0,40}\b(?:previous|prior|above|system|all)\b.{0,30}\b(?:instructions?|rules?|prompts?|guidelines?)\b"
            r"|\b(?:ignoriere|missachte|ueberschreibe|umgehe)\b.{0,40}\b(?:vorherigen?|bisherigen?|alle|system)\b.{0,30}\b(?:anweisungen?|regeln?|prompts?)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "system_prompt_extraction",
        re.compile(
            r"\b(?:reveal|show|print|repeat|leak|output|dump)\b.{0,35}\b(?:system\s*prompt|developer\s*(?:prompt|instructions?)|hidden\s*instructions?)\b"
            r"|\b(?:zeige|nenn(?:e)?|gib\s+aus|wiederhole)\b.{0,35}\b(?:systemprompt|system-?anweisungen?|interne\s+regeln?)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "role_override",
        re.compile(
            r"\b(?:you\s+are\s+now|act\s+as\s+(?:root|admin|unrestricted|dan)|enter\s+developer\s+mode)\b"
            r"|\b(?:du\s+bist\s+jetzt|vergiss\s+deine\s+rolle|entwicklermodus)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "tool_hijack",
        re.compile(
            r"\b(?:execute|run|call|invoke)\s+(?:immediately|now|silently)\b.{0,40}\b(?:tool|command|delete|wipe|rm\s+-rf|curl|wget)\b",
            re.IGNORECASE,
        ),
    ),
)

_MIN_FINGERPRINT_WORDS = 10


def wrap_untrusted_data(text: str, *, source: str) -> str:
    """Kapselt Fremdtext in eindeutigen XML-Grenzen und verhindert Tag-Breakouts."""
    safe_source = _SAFE_SOURCE_RE.sub("_", (source or "external").strip()).strip("_") or "external"
    escaped = _CLOSE_TAG_RE.sub("&lt;/untrusted_data&gt;", text or "")
    escaped = _OPEN_TAG_RE.sub("&lt;untrusted_data", escaped)
    return f'<untrusted_data source="{safe_source}">\n{escaped}\n</untrusted_data>'


def detect_injection_signals(text: str) -> list[str]:
    """Erkennt typische Indirect-Injection-Muster in Fremddaten rein zur Markierung."""
    if not text:
        return []
    hits = [name for name, pattern in _INJECTION_SIGNALS if pattern.search(text)]
    return sorted(set(hits))


def _normalize(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip().lower()


def build_prompt_fingerprints(system_prompt: str) -> tuple[str, ...]:
    """Erzeugt charakteristische Mehrwort-Fingerabdruecke (ab 10 Woertern) aus dem Systemprompt."""
    if not system_prompt:
        return ()
    fingerprints: list[str] = []
    seen: set[str] = set()
    for segment in _SENTENCE_SPLIT_RE.split(system_prompt):
        norm = _normalize(segment)
        if not norm:
            continue
        words = norm.split(" ")
        if len(words) < _MIN_FINGERPRINT_WORDS:
            continue
        # Nimmt den ersten charakteristischen 10-Wort-Anker je langem Satz.
        anchor = " ".join(words[:_MIN_FINGERPRINT_WORDS])
        if anchor not in seen:
            seen.add(anchor)
            fingerprints.append(anchor)
    return tuple(fingerprints)


def scrub_prompt_leak(text: str, fingerprints: tuple[str, ...]) -> tuple[str, bool]:
    """Entfernt wörtlich geleakte Systemprompt-Saetze aus der Modellantwort."""
    if not text or not fingerprints:
        return text, False
    norm_full = _normalize(text)
    if not any(fp in norm_full for fp in fingerprints):
        return text, False

    leaked = False
    lines = text.splitlines()
    cleaned_lines: list[str] = []
    for line in lines:
        norm_line = _normalize(line)
        if norm_line and any(fp in norm_line for fp in fingerprints):
            # Satzweise bereinigen, damit begleitender legitimer Text auf derselben Zeile nicht verloren geht.
            parts = _SENTENCE_SPLIT_RE.split(line)
            kept: list[str] = []
            for part in parts:
                if any(fp in _normalize(part) for fp in fingerprints):
                    leaked = True
                    kept.append("[INTERNE ANWEISUNG ENTFERNT]")
                elif part:
                    kept.append(part)
            cleaned_lines.append(" ".join(kept))
        else:
            cleaned_lines.append(line)

    if not leaked:
        # Fallback: Treffer spannte sich ueber Zeilenumbruch hinweg.
        return "[INTERNE ANWEISUNG ENTFERNT]", True
    return "\n".join(cleaned_lines), True
