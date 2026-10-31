"""Ein Anhang-Turn darf nicht automatisch zum Rechner greifen.

Der semantische Router schneidet Werkzeuge weg, aber `pflichtwerkzeuge` hielt
aus der App bisher Bildschirm und Eingabe immer im Angebot. Genau deshalb
uebergab das Modell eine Einkaufsliste an Computer-Use, statt sie zu lesen.
"""

from services.ai_tool_registry import DESKTOP_TOOLS, GEHIRN_DESKTOP
from services.tool_selection_port import (
    desktop_absicht,
    desktop_erlaubt,
    pflichtwerkzeuge,
)


def test_attachment_turn_without_desktop_intent_keeps_no_desktop_tool() -> None:
    erlaubt = frozenset({"desktop_system", "desktop_steuern", "desktop_launch_app", "web_search"})
    pflicht = pflichtwerkzeuge(
        erlaubt, "desktop", hat_anhaenge=True, query="Was steht auf diesem Bild?",
    )
    # Auch `desktop_launch_app` bleibt draussen. Genau dieses Werkzeug war der
    # Weg, auf dem ein hochgeladenes Bild als Rechnerauftrag endete.
    assert pflicht == frozenset()
    assert desktop_erlaubt(
        query="Was steht auf diesem Bild?", hat_anhaenge=True, computer_use_aktiv=True,
    ) is False


def test_desktop_tools_are_allowed_only_for_an_explicit_desktop_request() -> None:
    assert desktop_erlaubt(
        query="Öffne die Datei auf meinem PC", hat_anhaenge=True, computer_use_aktiv=True,
    ) is True
    assert desktop_erlaubt(
        query="Was steht in der Datei?", hat_anhaenge=True, computer_use_aktiv=True,
    ) is False
    assert desktop_erlaubt(
        query="Öffne die Datei", hat_anhaenge=True, computer_use_aktiv=False,
    ) is False
    assert DESKTOP_TOOLS


def test_the_frozen_intent_wins_over_the_last_provider_message() -> None:
    """Im Lauf steht die Absicht der Frage, nicht der letzte Gedaechtnisblock.

    `letzte` in der Providerliste ist oft ein Gedaechtnis- oder Anhangsblock.
    Der eingefrorene Wert verhindert, dass ein „starte" aus einer Erinnerung
    die Desktop-Werkzeuge oeffnet oder eine echte Rechnerbitte sie verliert.
    """
    erlaubt = frozenset({"desktop_system", "desktop_steuern", "desktop_launch_app"})
    assert pflichtwerkzeuge(
        erlaubt, "desktop", hat_anhaenge=True,
        query="Gedaechtnis: starte den Server", desktop_intent=False,
    ) == frozenset()
    assert pflichtwerkzeuge(
        erlaubt, "desktop", hat_anhaenge=True,
        query="Was steht auf dem Bild?", desktop_intent=True,
    ) == GEHIRN_DESKTOP & erlaubt
    assert desktop_erlaubt(
        hat_anhaenge=True, computer_use_aktiv=True, desktop_intent=True,
    ) is True
    assert desktop_erlaubt(
        hat_anhaenge=True, computer_use_aktiv=True, desktop_intent=False,
    ) is False


def test_desktop_intent_with_attachment_keeps_the_full_desktop_set() -> None:
    erlaubt = frozenset({"desktop_system", "desktop_steuern", "desktop_launch_app"})
    assert pflichtwerkzeuge(
        erlaubt, "desktop", hat_anhaenge=True, query="Öffne die Datei auf meinem PC",
    ) == (GEHIRN_DESKTOP & erlaubt)
    assert desktop_absicht("Sieh auf meinen Bildschirm") is True
    assert desktop_absicht("Was steht in der Datei?") is False


def test_panel_never_gets_desktop_tools_through_the_mandatory_set() -> None:
    erlaubt = frozenset({"desktop_system", "desktop_steuern", "web_search"})
    assert pflichtwerkzeuge(erlaubt, "panel", hat_anhaenge=True, query="Rechner") == frozenset()
