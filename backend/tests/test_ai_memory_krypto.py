"""Der Krypto-Teil des Gedaechtnisses bleibt ueber den Dienst erreichbar."""

from __future__ import annotations

from types import SimpleNamespace

from services import ai_memory_krypto as krypto
from services import ai_memory_service as service

NAMEN = (
    "_aad",
    "_versions_aad",
    "_schluessel_indizes",
    "_stapel",
    "_sammeln",
    "_schluessel_laden",
    "_index_nachziehen",
    "schluessel_bedingung",
    "schluessel_nachziehen",
    "_utc",
    "_entschluesseln",
    "_entschluesseln_lesbare",
    "_oeffnen",
    "_memory_line",
)


def test_der_dienst_reexportiert_jeden_namen() -> None:
    for name in NAMEN:
        assert getattr(service, name) is getattr(krypto, name), name
    assert service.SCHLUSS is krypto.SCHLUSS
    assert service._STAPEL_WERTE == krypto._STAPEL_WERTE


def test_das_modell_laesst_sich_importieren() -> None:
    import models.ai_memory  # noqa: F401


def test_die_aad_bindet_bereich_und_kennung() -> None:
    neu = SimpleNamespace(id=7, aad_version=2, scope_identity="user:1")
    alt = SimpleNamespace(id=7, aad_version=1, scope_identity="user:1")
    assert krypto._aad(neu) == "msm:ai:memory:user:1:7"
    assert krypto._aad(alt) == "msm:ai:memory:7"


def test_die_fassungs_aad_bindet_feld_bereich_kennung_und_fassung() -> None:
    fassung = SimpleNamespace(
        scope_identity="team:3", memory_id=11, id=5
    )
    assert (
        krypto._versions_aad(fassung, "text")
        == "msm:ai:memory:version:text:team:3:11:5"
    )
    assert (
        krypto._versions_aad(fassung, "titel")
        == "msm:ai:memory:version:titel:team:3:11:5"
    )
