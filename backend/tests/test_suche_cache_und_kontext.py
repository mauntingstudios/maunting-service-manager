"""Cache, Kontextdeckel und Bilddaten der Suche.

Der Browser sucht oft dieselbe Anfrage (Zurück, Reiterwechsel, zwei Fenster).
Diese Tests halten fest, dass das eine Anfrage bleibt, dass Fehler nicht
gespeichert werden, dass der KI-Kontext gedeckelt ist und dass Bildtreffer
Vorschau und Original trennen.
"""

from __future__ import annotations

import concurrent.futures
import threading
import time

import pytest

from services import ai_search_summary_service as zusammenfassung
from services import ai_web_search_service as dienst


class Antwort:
    def __init__(self, daten: dict, status: int = 200) -> None:
        self.status_code = status
        self._daten = daten

    def json(self) -> dict:
        return self._daten


class Client:
    def __init__(self, antwort: dict | None = None, status: int = 200, verzoegerung: float = 0.0) -> None:
        self.antwort = antwort or {"results": [], "suggestions": []}
        self.status = status
        self.verzoegerung = verzoegerung
        self.anfragen = 0
        self._lock = threading.Lock()

    def get(self, url: str, *, params=None, headers=None) -> Antwort:
        with self._lock:
            self.anfragen += 1
        if self.verzoegerung:
            time.sleep(self.verzoegerung)
        return Antwort(self.antwort, self.status)


@pytest.fixture(autouse=True)
def _cache_leeren() -> None:
    with dienst._cache_lock:
        dienst._cache.clear()
        dienst._inflight.clear()


def _such(ein_client: Client, monkeypatch: pytest.MonkeyPatch, *, kategorie: str | None = None, q: str = "wetter"):
    monkeypatch.setattr(dienst, "_http_client", lambda: ein_client)
    monkeypatch.setattr(dienst, "api_key", lambda: None)
    return dienst.searxng_ergebnis(
        q,
        seite=1,
        sprache="de",
        kategorie=kategorie,
        s_url="http://127.0.0.1:8888",
        cache_scope="browser",
    )


def _treffer(url: str, titel: str = "Titel") -> dict:
    return {"title": titel, "url": url, "snippet": "Auszug"}


def test_zweiter_identischer_aufruf_fragt_nicht_noch_einmal(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Client({"results": [_treffer("https://example.org/a")], "suggestions": []})

    erster = _such(client, monkeypatch)
    zweiter = _such(client, monkeypatch)

    assert client.anfragen == 1
    assert erster == zweiter
    assert erster["treffer"][0]["url"] == "https://example.org/a"


def test_gleichzeitige_aufrufe_teilen_einen_lauf(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Client({"results": [_treffer("https://example.org/a")], "suggestions": []}, verzoegerung=0.2)
    monkeypatch.setattr(dienst, "_http_client", lambda: client)
    monkeypatch.setattr(dienst, "api_key", lambda: None)

    def lauf() -> dict:
        return dienst.searxng_ergebnis(
            "wetter",
            seite=1,
            sprache="de",
            s_url="http://127.0.0.1:8888",
            cache_scope="browser",
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        ergebnisse = [f.result(timeout=15) for f in [pool.submit(lauf), pool.submit(lauf)]]

    assert client.anfragen == 1
    assert ergebnisse[0] == ergebnisse[1]


def test_fehler_wird_nicht_gespeichert(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Client({}, status=500)
    monkeypatch.setattr(dienst, "_http_client", lambda: client)
    monkeypatch.setattr(dienst, "api_key", lambda: None)

    for _ in range(2):
        with pytest.raises(dienst.WebSearchUnavailable):
            dienst.searxng_ergebnis(
                "wetter",
                seite=1,
                s_url="http://127.0.0.1:8888",
                cache_scope="browser",
            )

    assert client.anfragen == 2


def test_nachrichten_verfallen_schneller_als_allgemeine_treffer(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Client({"results": [], "suggestions": []})
    _such(client, monkeypatch, kategorie="news")
    with dienst._cache_lock:
        ablauf = max(eintrag[0] for eintrag in dienst._cache.values())
    assert ablauf - time.monotonic() <= 30.5

    with dienst._cache_lock:
        dienst._cache.clear()
    _such(client, monkeypatch)
    with dienst._cache_lock:
        ablauf_allgemein = max(eintrag[0] for eintrag in dienst._cache.values())
    assert ablauf_allgemein - time.monotonic() > 30.5


def test_doppelquelle_rueckt_nach_vorn() -> None:
    brave = [_treffer("https://a.example", "A"), _treffer("https://b.example", "B")]
    searxng = [_treffer("https://c.example", "C"), _treffer("https://b.example/", "B")]

    gemischt = dienst._mische_treffer([brave, searxng], limit=5)

    assert [t["url"] for t in gemischt][0] == "https://b.example"
    assert len(gemischt) == 3


def test_bildfelder_trennen_vorschau_und_original(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dienst, "_is_safe_public_url", lambda url: True)

    felder = dienst._bild_felder_brave(
        {
            "thumbnail": {"src": "https://img.example/klein.jpg", "width": 480, "height": 270},
            "properties": {"url": "https://img.example/gross.jpg"},
            "meta_url": {"hostname": "www.beispiel.de"},
        }
    )

    assert felder["bild"] == "https://img.example/klein.jpg"
    assert felder["bildOriginal"] == "https://img.example/gross.jpg"
    assert felder["bildBreite"] == 480
    assert felder["bildHoehe"] == 270
    assert felder["quelle"] == "www.beispiel.de"

    searxng = dienst._bild_felder_searxng(
        {
            "thumbnail": "https://img.example/klein.jpg",
            "img_src": "https://img.example/gross.jpg",
            "resolution": "1920x1080",
            "source": "beispiel.de",
        }
    )
    assert searxng["bildOriginal"] == "https://img.example/gross.jpg"
    assert searxng["bildBreite"] == 1920
    assert searxng["bildHoehe"] == 1080


def _viele_treffer(anzahl: int = 15) -> list[dict]:
    return [
        {
            "index": i + 1,
            "titel": f"Titel {i + 1}",
            "url": f"https://example.org/{i + 1}",
            "inhalt": "x" * 800,
            "volltext": "y" * 3000,
        }
        for i in range(anzahl)
    ]


def test_kontext_budget_deckelt_die_gesamtlaenge() -> None:
    treffer = _viele_treffer()
    auswahl = zusammenfassung.waehle_suchkontext(treffer)

    assert 0 < len(auswahl) < len(treffer)
    assert [t["index"] for t in auswahl] == list(range(1, len(auswahl) + 1))
    assert len(zusammenfassung.baue_suchkontext(treffer)) <= zusammenfassung.KONTEXT_MAX_ZEICHEN


def test_deep_dive_bleibt_im_kontext() -> None:
    treffer = _viele_treffer()
    treffer[-1]["deep"] = True

    auswahl = zusammenfassung.waehle_suchkontext(treffer)

    assert 15 in [t["index"] for t in auswahl]


def test_brave_seitenwechsel_uebergibt_offset(monkeypatch: pytest.MonkeyPatch) -> None:
    aufrufe: list[dict] = []

    class BraveClient:
        def get(self, url, *, params=None, headers=None):
            aufrufe.append({"url": url, "params": dict(params or {})})
            return Antwort({"web": {"results": [{"url": "https://example.org/p2", "title": "Seite 2", "description": "Text"}]}})

    monkeypatch.setattr(dienst, "_http_client", lambda: BraveClient())
    monkeypatch.setattr(dienst, "api_key", lambda: "brave-test-key")
    monkeypatch.setattr(dienst, "searxng_url", lambda: None)
    monkeypatch.setattr(dienst, "_apis_aktiv_fuer_instanz", lambda _url: True)

    erg = dienst._searxng_ergebnis_berechnen("gta 6", limit=10, seite=2)

    assert len(aufrufe) == 1
    assert aufrufe[0]["params"]["offset"] == 1
    assert erg["treffer"][0]["url"] == "https://example.org/p2"


def test_paralleles_scraping_kappt_haengende_seiten_nach_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_scrape(url: str, max_chars: int = 3500, deep: bool = False):
        if "langsam" in url:
            time.sleep(0.5)
        return {"title": url, "url": url, "content": f"Inhalt {url}"}

    monkeypatch.setattr(dienst, "scrape_url", fake_scrape)

    t0 = time.monotonic()
    res = dienst.scrape_top_urls_parallel(
        ["https://fast.example/1", "https://langsam.example/2"],
        max_chars=1000,
        limit=2,
        timeout=0.08,
    )
    dauer = time.monotonic() - t0

    assert "https://fast.example/1" in res
    assert "https://langsam.example/2" not in res
    assert dauer < 0.35
