"""Die feste Denkstufe der Suchzusammenfassung am Anbieter-Zugang.

Die Suche im Browser fragt nicht je Anfrage nach einer Denkstufe: der
Betreiber legt sie einmal pro Zugang fest (leer = schnellste Antwort), und
das Rollenlimit kappt sie nach oben. Diese Tests halten die Validierung im
Service fest, damit ein erfundenes Wort nicht erst zur Laufzeit auffällt.
"""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from models import AiProvider
from services import ai_provider_service
from services.ai_provider_service import AiProviderConfigurationError


def _such_provider(db: Session, **extra) -> AiProvider:
    provider = ai_provider_service.create_provider(
        db,
        name="Suchzugang",
        provider_kind="openrouter",
        default_model="schnelles-modell",
        enabled=True,
        requires_api_key=True,
        operator_api_key="sk-or-v1-test",
        search_summary_model="such-modell",
        **extra,
    )
    db.commit()
    return provider


class TestSuchDenkstufeValidierung:
    def test_stufe_wird_gespeichert(self, db: Session) -> None:
        provider = _such_provider(db, search_summary_reasoning_effort="high")

        db.refresh(provider)
        assert provider.search_summary_reasoning_effort == "high"
        assert provider.search_summary_enabled is True

    def test_leer_heisst_ohne_denken(self, db: Session) -> None:
        provider = _such_provider(db, search_summary_reasoning_effort="")

        assert provider.search_summary_reasoning_effort is None

    def test_ein_erfundenes_stufenwort_faellt_beim_speichern_auf(
        self, db: Session
    ) -> None:
        with pytest.raises(AiProviderConfigurationError, match="Such-Denkstufe"):
            _such_provider(db, search_summary_reasoning_effort="ultra")

    def test_ein_erfundenes_wort_faellt_auch_beim_aendern_auf(
        self, db: Session
    ) -> None:
        provider = _such_provider(db)

        with pytest.raises(AiProviderConfigurationError, match="Such-Denkstufe"):
            ai_provider_service.update_provider(
                db,
                provider,
                values={"search_summary_reasoning_effort": "ultra"},
                operator_api_key=None,
                clear_operator_api_key=False,
            )

    def test_die_stufe_wird_normalisiert(self, db: Session) -> None:
        provider = _such_provider(db, search_summary_reasoning_effort=" HIGH ")

        assert provider.search_summary_reasoning_effort == "high"

    def test_eine_stufe_ohne_suchmodell_darf_stehen(self, db: Session) -> None:
        """Anders als beim Worker: die Stufe gilt, sobald eine Zusammenfassung
        eingerichtet ist, und bleibt sonst wirkungslos stehen."""
        provider = ai_provider_service.create_provider(
            db,
            name="Ohne Suche",
            provider_kind="openrouter",
            default_model="schnelles-modell",
            enabled=True,
            requires_api_key=True,
            operator_api_key="sk-or-v1-test",
            search_summary_reasoning_effort="low",
        )
        db.commit()

        assert provider.search_summary_reasoning_effort == "low"
        assert provider.search_summary_enabled is False

    def test_die_stufe_laesst_sich_abschalten(self, db: Session) -> None:
        provider = _such_provider(db, search_summary_reasoning_effort="high")

        ai_provider_service.update_provider(
            db,
            provider,
            values={"search_summary_reasoning_effort": None},
            operator_api_key=None,
            clear_operator_api_key=False,
        )
        db.commit()

        assert provider.search_summary_reasoning_effort is None

    def test_nicht_mitgeschickt_laesst_die_stufe_stehen(self, db: Session) -> None:
        provider = _such_provider(db, search_summary_reasoning_effort="medium")

        ai_provider_service.update_provider(
            db,
            provider,
            values={"name": "Suchzugang umbenannt"},
            operator_api_key=None,
            clear_operator_api_key=False,
        )
        db.commit()

        assert provider.search_summary_reasoning_effort == "medium"