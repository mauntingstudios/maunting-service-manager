"""Ein Anhang-Turn darf nicht automatisch zum Rechner greifen.

Der semantische Router schneidet Werkzeuge weg, aber `pflichtwerkzeuge` hielt
aus der App bisher Bildschirm und Eingabe immer im Angebot. Genau deshalb
uebergab das Modell eine Einkaufsliste an Computer-Use, statt sie zu lesen.
"""

from services.ai_tool_registry import GEHIRN_DESKTOP
from services.tool_selection_port import (
    DESKTOP_STEUERUNG,
    desktop_absicht,
    pflichtwerkzeuge,
)


def test_attachment_turn_without_desktop_intent_keeps_only_launch_app() -> None:
    erlaubt = frozenset({"desktop_system", "desktop_steuern", "desktop_launch_app", "web_search"})
    pflicht = pflichtwerkzeuge(
        erlaubt, "desktop", hat_anhaenge=True, query="Was steht auf diesem Bild?",
    )
    assert pflicht == {"desktop_launch_app"}
    assert not (pflicht & DESKTOP_STEUERUNG)


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
