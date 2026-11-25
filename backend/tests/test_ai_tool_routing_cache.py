"""Prompt-Cache-Stabilitaet beim Tool-Routing (Ebene 1 allgemein + Ebene 2 Claude)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models import AiConversation, AiProvider, AiRun, User
from services import ai_provider_registry, ai_run_service
from services.ai_action_service import provider_tool_definitions
from services.ai_stream.lifecycle import (
    _vorherige_werkzeuge_laden,
    _werkzeuge_kanonisch_sortieren,
    _werkzeuge_semantisch_routen,
)
from services.ai_stream.types import MAX_STICKY_TOOLS
from services.ai_tool_registry import DESKTOP_TOOLS


def _tool_def(name: str, desc: str = "Beschreibung") -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def _tool_names(tools: list[dict]) -> list[str]:
    return [str((e.get("function") or {}).get("name")) for e in tools]


def test_canonical_sorting_places_hotset_then_panel_then_mcp() -> None:
    """HOTSET (0) -> ueberige Panel-Werkzeuge (1) -> MCP-Werkzeuge (2), je alphabetisch."""
    mixed = [
        _tool_def("mcp_zeta"),
        _tool_def("propose_role_set"),
        _tool_def("web_search"),
        _tool_def("mcp_alpha"),
        _tool_def("list_my_servers"),
        _tool_def("propose_backup"),
    ]
    sorted_tools = _werkzeuge_kanonisch_sortieren(
        mixed,
        hot={"web_search", "list_my_servers"},
        mcp_namen={"mcp_zeta", "mcp_alpha"},
    )
    assert _tool_names(sorted_tools) == [
        "list_my_servers",
        "web_search",
        "propose_backup",
        "propose_role_set",
        "mcp_alpha",
        "mcp_zeta",
    ]


@pytest.mark.asyncio
async def test_sticky_tools_preserve_prefix_across_turns_and_respect_rights() -> None:
    """Ebene 1: Vorherige Werkzeuge bleiben bei Folgefragen stabil und Rechtestopps greifen hart."""
    alle_tools = provider_tool_definitions()
    erlaubt = frozenset(_tool_names(alle_tools))
    zustand_t1 = {"provider_messages": [{"role": "user", "content": "Mach ein Backup"}]}

    gewaehlt_t1 = await _werkzeuge_semantisch_routen(
        tools=alle_tools,
        erlaubt=set(erlaubt),
        mcp_namen=set(),
        docs_kontext=None,
        herkunft="panel",
        zustand=zustand_t1,
    )
    namen_t1 = _tool_names(gewaehlt_t1)
    assert "propose_backup" in namen_t1
    assert "propose_backup" in zustand_t1["routed_tools"]

    # Turn 2: identische Frage / themennahe Rueckfrage liefert exakt dieselbe geordnete Tool-Liste.
    zustand_t2 = {"provider_messages": [{"role": "user", "content": "Mach ein Backup"}]}
    gewaehlt_t2 = await _werkzeuge_semantisch_routen(
        tools=alle_tools,
        erlaubt=set(erlaubt),
        mcp_namen=set(),
        docs_kontext=None,
        herkunft="panel",
        zustand=zustand_t2,
        vorherige_werkzeuge=tuple(zustand_t1["routed_tools"]),
    )
    assert _tool_names(gewaehlt_t2) == namen_t1

    # Turn 3: Themenwechsel (Rollen) behaelt `propose_backup` sticky bei.
    zustand_t3 = {"provider_messages": [{"role": "user", "content": "Erstelle eine Rolle Moderator"}]}
    gewaehlt_t3 = await _werkzeuge_semantisch_routen(
        tools=alle_tools,
        erlaubt=set(erlaubt),
        mcp_namen=set(),
        docs_kontext=None,
        herkunft="panel",
        zustand=zustand_t3,
        vorherige_werkzeuge=tuple(zustand_t2["routed_tools"]),
    )
    namen_t3 = _tool_names(gewaehlt_t3)
    assert "propose_backup" in namen_t3
    assert "propose_role_set" in namen_t3

    # Entzogenes Recht / Anhang ohne Desktop-Absicht entfernt Sticky-Werkzeug wieder hart.
    assert "desktop_system" in DESKTOP_TOOLS
    zustand_ohne_desktop = {
        "provider_messages": [{"role": "user", "content": "Was steht auf dem Bild?"}],
        "hat_anhaenge": True,
        "desktop_absicht": False,
    }
    ohne_desktop = await _werkzeuge_semantisch_routen(
        tools=alle_tools,
        erlaubt=set(erlaubt),
        mcp_namen=set(),
        docs_kontext=None,
        herkunft="desktop",
        zustand=zustand_ohne_desktop,
        vorherige_werkzeuge=("desktop_system", "propose_backup"),
    )
    namen_ohne_desktop = set(_tool_names(ohne_desktop))
    assert not (namen_ohne_desktop & DESKTOP_TOOLS)
    assert "propose_backup" in namen_ohne_desktop


@pytest.mark.asyncio
async def test_sticky_tools_respect_max_sticky_cap() -> None:
    """Uebersteigt die Summe MAX_STICKY_TOOLS, bleibt der Bestand gedeckelt."""
    alle_tools = provider_tool_definitions()
    erlaubt = frozenset(_tool_names(alle_tools))
    viele_vorherige = tuple(
        n for n in sorted(erlaubt) if n.startswith("propose_")
    )[: MAX_STICKY_TOOLS + 5]
    zustand = {"provider_messages": [{"role": "user", "content": "Erstelle eine Rolle Moderator"}]}

    await _werkzeuge_semantisch_routen(
        tools=alle_tools,
        erlaubt=set(erlaubt),
        mcp_namen=set(),
        docs_kontext=None,
        herkunft="panel",
        zustand=zustand,
        vorherige_werkzeuge=viele_vorherige,
    )
    assert len(zustand["routed_tools"]) <= MAX_STICKY_TOOLS
    assert "propose_role_set" in zustand["routed_tools"]


@pytest.mark.asyncio
async def test_tool_search_mode_keeps_catalog_and_marks_non_hotset_as_deferred() -> None:
    """Ebene 2: Mit ``tool_search_aktiv`` bleiben Nicht-HOTSET-Tools im Katalog und landen in ``defer_tool_names``."""
    alle_tools = provider_tool_definitions()
    erlaubt = set(_tool_names(alle_tools))
    zustand = {"provider_messages": [{"role": "user", "content": "Mach ein Backup"}]}

    gewaehlt = await _werkzeuge_semantisch_routen(
        tools=alle_tools,
        erlaubt=erlaubt,
        mcp_namen=set(),
        docs_kontext=None,
        herkunft="panel",
        zustand=zustand,
        tool_search_aktiv=True,
    )
    assert len(gewaehlt) == len(alle_tools)
    assert "propose_backup" in zustand["defer_tool_names"]
    assert "list_my_servers" not in zustand["defer_tool_names"]


def test_vorherige_werkzeuge_laden_reads_latest_run_in_conversation(
    db: Session, regular_user: User
) -> None:
    """Liest gemerkte ``routed_tools`` aus dem juengsten anderen Lauf derselben Konversation."""
    conv = AiConversation(id=str(uuid4()), user_id=regular_user.id, title="Routing Cache")
    provider = AiProvider(
        name="Test OpenRouter",
        provider_kind="openrouter",
        default_model="openai/gpt-5",
        enabled=True,
        requires_api_key=False,
    )
    db.add_all([conv, provider])
    db.flush()

    t0 = datetime.now(timezone.utc) - timedelta(minutes=5)
    alt = AiRun(
        id=str(uuid4()),
        conversation_id=conv.id,
        user_id=regular_user.id,
        provider_id=provider.id,
        status="completed",
        created_at=t0,
    )
    alt_state = ai_run_service.leerer_zustand([], request_id=str(uuid4()))
    alt_state["routed_tools"] = ["propose_backup"]
    ai_run_service.zustand_schreiben(alt, alt_state)

    neu = AiRun(
        id=str(uuid4()),
        conversation_id=conv.id,
        user_id=regular_user.id,
        provider_id=provider.id,
        status="completed",
        created_at=t0 + timedelta(minutes=2),
    )
    neu_state = ai_run_service.leerer_zustand([], request_id=str(uuid4()))
    neu_state["routed_tools"] = ["propose_role_set", "list_users"]
    ai_run_service.zustand_schreiben(neu, neu_state)

    aktuell_id = str(uuid4())
    aktuell = AiRun(
        id=aktuell_id,
        conversation_id=conv.id,
        user_id=regular_user.id,
        provider_id=provider.id,
        status="running",
        created_at=t0 + timedelta(minutes=4),
    )
    db.add_all([alt, neu, aktuell])
    db.commit()

    geladen = _vorherige_werkzeuge_laden(db, conversation_id=conv.id, exclude_run_id=aktuell_id)
    assert geladen == ("propose_role_set", "list_users")


def test_provider_registry_tool_search_extension_flags() -> None:
    """``tool_search`` ist fuer Anthropic direkt aktiv, nicht fuer OpenAI oder OpenRouter."""
    assert "tool_search" in ai_provider_registry.anbieter("anthropic").anfrage_erweiterungen
    assert "tool_search" not in ai_provider_registry.anbieter("openai").anfrage_erweiterungen
    assert "tool_search" not in ai_provider_registry.anbieter("openrouter").anfrage_erweiterungen
