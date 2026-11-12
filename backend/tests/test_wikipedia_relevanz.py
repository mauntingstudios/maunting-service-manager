"""Die Wissenskarte zeigt nur, was zur Anfrage gehört.

Der alte Weg nahm den ersten MediaWiki-Volltexttreffer. „GTA 6“ konnte so bei
einem Lied oder einer Band landen. Diese Tests halten die Zuordnung fest:
Titel, Weiterleitung, Kürzel und Zahl müssen die Anfrage tragen; eine
Begriffsklärung bleibt leer.
"""

from __future__ import annotations

import urllib.parse

import pytest

from services import ai_web_search_service as dienst


class Antwort:
    def __init__(self, daten: dict, status: int = 200) -> None:
        self.status_code = status
        self._daten = daten

    def json(self) -> dict:
        return self._daten


class Client:
    """Bildet die drei Wikipedia-Aufrufe nach und zählt sie."""

    def __init__(
        self,
        *,
        titel: dict[str, dict] | None = None,
        kandidaten: dict[str, list[dict]] | None = None,
        summaries: dict[str, dict] | None = None,
        wikitext: str = "Text ohne Infobox",
    ) -> None:
        self.titel = titel or {}
        self.kandidaten = kandidaten or {}
        self.summaries = summaries or {}
        self.wikitext = wikitext
        self.anfragen: list[dict] = []

    def get(self, url: str, *, params=None, headers=None) -> Antwort:
        p = dict(params or {})
        self.anfragen.append({"url": url, "params": p})
        if "/api/rest_v1/page/summary/" in url:
            roh = url.rsplit("/", 1)[-1]
            name = urllib.parse.unquote(roh).replace("_", " ")
            return Antwort(self.summaries.get(name, {}))
        if p.get("prop") == "revisions":
            return Antwort(
                {"query": {"pages": {"1": {"revisions": [{"slots": {"main": {"*": self.wikitext}}}]}}}}
            )
        if p.get("titles"):
            treffer = self.titel.get(str(p["titles"]))
            if treffer is None:
                return Antwort({"query": {"pages": [{"title": p["titles"], "missing": True}]}})
            return Antwort(treffer)
        if p.get("generator") == "search":
            return Antwort({"query": {"pages": self.kandidaten.get(str(p["gsrsearch"]), [])}})
        raise AssertionError(f"unerwartete Anfrage: {url} {p}")


def _seite(titel: str, *, begriffsklaerung: bool = False, aliase: tuple[str, ...] = ()) -> dict:
    daten: dict = {
        "query": {
            "pages": [
                {
                    "title": titel,
                    "pageprops": {"disambiguation": ""} if begriffsklaerung else {},
                }
            ]
        }
    }
    if aliase:
        daten["query"]["redirects"] = [{"from": alias, "to": titel} for alias in aliase]
    return daten


def _kandidat(titel: str, beschreibung: str = "", *, begriffsklaerung: bool = False) -> dict:
    return {
        "title": titel,
        "description": beschreibung,
        "pageprops": {"disambiguation": ""} if begriffsklaerung else {},
    }


def _summary(titel: str, beschreibung: str = "", *, typ: str = "standard") -> dict:
    return {
        "title": titel,
        "description": beschreibung,
        "type": typ,
        "extract": f"{titel} ist ein Artikel.",
        "content_urls": {
            "desktop": {"page": f"https://de.wikipedia.org/wiki/{urllib.parse.quote(titel.replace(' ', '_'))}"}
        },
    }


@pytest.fixture(autouse=True)
def _cache_leeren() -> None:
    with dienst._wissen_lock:
        dienst._wissen_cache.clear()


def _einbauen(monkeypatch: pytest.MonkeyPatch, client: Client) -> Client:
    monkeypatch.setattr(dienst, "_http_client", lambda: client)
    return client


def test_gta_6_zeigt_grand_theft_auto_vi(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _einbauen(
        monkeypatch,
        Client(
            titel={"GTA 6": _seite("Grand Theft Auto VI", aliase=("GTA 6",))},
            summaries={"Grand Theft Auto VI": _summary("Grand Theft Auto VI", "Action-Adventure")},
        ),
    )

    wissen = dienst.wikipedia_wissen("GTA 6", sprache="de")

    assert wissen is not None
    assert wissen["titel"] == "Grand Theft Auto VI"
    assert len(client.anfragen) <= 3


def test_gta_6_waehlt_keinen_saenger(monkeypatch: pytest.MonkeyPatch) -> None:
    _einbauen(
        monkeypatch,
        Client(
            titel={},
            kandidaten={
                "GTA 6": [
                    _kandidat("GTA", "Lied des Sängers"),
                    _kandidat("GTA 6 (Lied)", "Lied"),
                    _kandidat("Grand Theft Auto VI", "Action-Adventure-Spiel"),
                ]
            },
            summaries={"Grand Theft Auto VI": _summary("Grand Theft Auto VI", "Action-Adventure-Spiel")},
        ),
    )

    wissen = dienst.wikipedia_wissen("GTA 6", sprache="de")

    assert wissen is not None
    assert wissen["titel"] == "Grand Theft Auto VI"


def test_begriffsklaerung_bleibt_leer(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _einbauen(
        monkeypatch,
        Client(titel={"Mercury": _seite("Mercury", begriffsklaerung=True)}),
    )

    assert dienst.wikipedia_wissen("Mercury", sprache="de") is None
    assert len(client.anfragen) == 1


def test_albert_einstein(monkeypatch: pytest.MonkeyPatch) -> None:
    _einbauen(
        monkeypatch,
        Client(
            titel={"Albert Einstein": _seite("Albert Einstein")},
            summaries={"Albert Einstein": _summary("Albert Einstein", "Physiker")},
        ),
    )

    wissen = dienst.wikipedia_wissen("Albert Einstein", sprache="de")

    assert wissen is not None
    assert wissen["titel"] == "Albert Einstein"


def test_kleinschreibung_und_nvidia(monkeypatch: pytest.MonkeyPatch) -> None:
    _einbauen(
        monkeypatch,
        Client(
            titel={"berlin": _seite("Berlin"), "NVIDIA": _seite("NVIDIA")},
            summaries={"Berlin": _summary("Berlin", "Hauptstadt"), "NVIDIA": _summary("NVIDIA", "Unternehmen")},
        ),
    )

    assert dienst.wikipedia_wissen("berlin", sprache="de")["titel"] == "Berlin"
    with dienst._wissen_lock:
        dienst._wissen_cache.clear()
    assert dienst.wikipedia_wissen("NVIDIA", sprache="de")["titel"] == "NVIDIA"


def test_ohne_treffer_bleibt_leer(monkeypatch: pytest.MonkeyPatch) -> None:
    _einbauen(monkeypatch, Client(titel={}, kandidaten={"asdfgh": []}))

    assert dienst.wikipedia_wissen("asdfgh", sprache="de") is None


def test_zweiter_aufruf_kommt_aus_dem_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _einbauen(
        monkeypatch,
        Client(
            titel={"Berlin": _seite("Berlin")},
            summaries={"Berlin": _summary("Berlin", "Hauptstadt")},
        ),
    )

    erster = dienst.wikipedia_wissen("Berlin", sprache="de")
    anzahl = len(client.anfragen)
    zweiter = dienst.wikipedia_wissen("Berlin", sprache="de")

    assert zweiter == erster
    assert len(client.anfragen) == anzahl


def test_infobox_mit_teilbegriff_wird_verworfen() -> None:
    assert dienst._infobox_ist_teilbegriff("GTA 6", "GTA") is True
    assert dienst._infobox_ist_teilbegriff("GTA 6", "Grand Theft Auto VI") is False
    assert dienst._infobox_ist_teilbegriff("Hauptstadt von Frankreich", "Paris") is False


def test_gta_6_release_modifier_findet_grand_theft_auto_vi(monkeypatch: pytest.MonkeyPatch) -> None:
    assert dienst.extrahiere_wissens_begriff("GTA 6 Release") == "GTA 6"
    assert dienst.extrahiere_wissens_begriff("GTA 6 PC Release 2026") == "GTA 6"
    assert dienst.extrahiere_wissens_begriff("NVIDIA Aktienkurs") == "NVIDIA"
    assert dienst.extrahiere_wissens_begriff("Test") == "Test"

    _einbauen(
        monkeypatch,
        Client(
            titel={"GTA 6": _seite("Grand Theft Auto VI", aliase=("GTA 6",))},
            summaries={"Grand Theft Auto VI": _summary("Grand Theft Auto VI", "Action-Adventure-Videospiel")},
            wikitext=(
                "{{Infobox Computer- und Videospiel\n"
                "| Bild = GTA6.png\n"
                "| Genre = [[Action-Adventure]], [[Open World]]\n"
                "| Entwickler = [[Rockstar North]]\n"
                "}}\n"
                "[[Grand Theft Auto VI]] wird von [[Rockstar Games]] veröffentlicht."
            ),
        ),
    )

    wissen = dienst.wikipedia_wissen("GTA 6 Release", sprache="de")

    assert wissen is not None
    assert wissen["titel"] == "Grand Theft Auto VI"
    assert all(a["label"] not in ("Beschreibung", "Description", "Bild") for a in wissen["attribute"])
    assert {"label": "Genre", "value": "Action-Adventure, Open World"} in wissen["attribute"]
    assert wissen.get("verwandte") == ["Action-Adventure", "Open World", "Rockstar North", "Rockstar Games"]
