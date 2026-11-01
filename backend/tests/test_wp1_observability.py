"""Tests für Hardening WP1: Beobachtbarkeit und Backend-Fehlervertrag."""

import asyncio
import io
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from starlette.requests import Request
from starlette.testclient import TestClient

from main import app
from middleware.request_id import JsonFormatter, RequestIDFilter, request_id_ctx
from services.task_runner import sichere_aufgabe
from database import get_db


def test_request_id_header_und_json_log():
    client = TestClient(app, raise_server_exceptions=False)

    # 1. Anfrage ohne X-Request-ID -> Server generiert eine
    res1 = client.get("/api/health")
    assert res1.status_code == 200
    req_id_1 = res1.headers.get("x-request-id")
    assert req_id_1 is not None and len(req_id_1) > 0

    # 2. Anfrage mit übergebener X-Request-ID -> Server spiegelt sie
    custom_id = "test-custom-12345"
    res2 = client.get("/api/health", headers={"X-Request-ID": custom_id})
    assert res2.status_code == 200
    assert res2.headers.get("x-request-id") == custom_id

    # 2b. Anfrage mit bösartiger X-Request-ID (CRLF-Injection) -> Server generiert neue UUID
    malicious_id = "injected\r\nSet-Cookie: evil=true"
    res_malicious = client.get("/api/health", headers={"X-Request-ID": malicious_id})
    assert res_malicious.status_code == 200
    returned_id = res_malicious.headers.get("x-request-id")
    assert returned_id != malicious_id
    assert "\r" not in returned_id and "\n" not in returned_id
    assert len(returned_id) == 16  # uuid.uuid4().hex[:16] Fallback

    # 3. JsonFormatter prüft Format
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="msm.test",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="Test-Nachricht",
        args=(),
        exc_info=None,
    )
    record.request_id = custom_id
    record.method = "GET"
    record.path = "/api/health"
    record.status = 200
    record.duration_ms = 12.34

    log_str = formatter.format(record)
    parsed = json.loads(log_str)
    assert parsed["level"] == "INFO"
    assert parsed["msg"] == "Test-Nachricht"
    assert parsed["request_id"] == custom_id
    assert parsed["method"] == "GET"
    assert parsed["path"] == "/api/health"
    assert parsed["status"] == 200
    assert parsed["duration_ms"] == 12.34
    assert "ts" in parsed


def test_unerwarteter_fehler_ohne_internas():
    # Wir fügen eine Testroute hinzu, die einen unerwarteten Fehler wirft
    test_client = TestClient(app, raise_server_exceptions=False)


    # Direkter Test des Exception-Handlers über TestClient
    @app.get("/api/test-fault-500", include_in_schema=False)
    def crash_route():
        raise RuntimeError("Geheimer DB-Pfad /var/lib/postgresql/data und Token secret123")

    res = test_client.get("/api/test-fault-500", headers={"X-Request-ID": "err-test-id-99"})
    assert res.status_code == 500
    assert res.headers.get("x-request-id") == "err-test-id-99"

    body = res.json()
    assert "detail" in body
    detail = body["detail"]
    assert detail["code"] == "internal"
    assert detail["message"] == "Interner Fehler"
    assert detail["request_id"] == "err-test-id-99"

    # Keine Interna, Stacktraces oder Dateipfade im Body!
    raw_text = res.text
    assert "/var/lib/postgresql" not in raw_text
    assert "secret123" not in raw_text
    assert "Traceback" not in raw_text


@pytest.mark.asyncio
async def test_health_deep_503_bei_db_ausfall():
    from services import health_service

    # Normaler Health-Check
    client = TestClient(app, raise_server_exceptions=False)
    res_normal = client.get("/api/health")
    assert res_normal.status_code == 200
    assert res_normal.json() == {"status": "ok"}

    # Mock DB Ausfall bei deep=1
    with patch("services.health_service._pruefe_datenbank", new_callable=AsyncMock) as mock_db:
        mock_db.return_value = (False, "Fehler: Timeout")
        with patch("services.health_service._pruefe_dis_sidecar", new_callable=AsyncMock) as mock_dis:
            mock_dis.return_value = (True, "ok")

            res_deep = client.get("/api/health?deep=1")
            assert res_deep.status_code == 503
            data = res_deep.json()
            assert data["status"] == "degraded"
            assert data["checks"]["database"] == "Fehler: Timeout"
            assert data["checks"]["dis_sidecar"] == "ok"


@pytest.mark.asyncio
async def test_health_deep_503_bei_speichermangel():
    client = TestClient(app, raise_server_exceptions=False)

    with patch("services.health_service._pruefe_datenbank", new_callable=AsyncMock) as mock_db:
        mock_db.return_value = (True, "ok")
        with patch("services.health_service._pruefe_dis_sidecar", new_callable=AsyncMock) as mock_dis:
            mock_dis.return_value = (True, "ok")
            with patch("services.health_service._pruefe_festplatte") as mock_disk:
                mock_disk.return_value = (
                    False,
                    {"status": "low_space", "free_gb": 4.0, "total_gb": 100.0, "free_percent": 4.0},
                )

                res_deep = client.get("/api/health?deep=1")
                assert res_deep.status_code == 503
                data = res_deep.json()
                assert data["status"] == "degraded"
                assert data["checks"]["database"] == "ok"
                assert data["checks"]["dis_sidecar"] == "ok"
                assert data["checks"]["disk"]["status"] == "low_space"
                assert data["checks"]["disk"]["free_percent"] == 4.0


@pytest.mark.asyncio
async def test_ungelesene_task_ausnahme_wird_protokolliert():
    token = request_id_ctx.set("task-req-1234")
    logged_errors = []

    class DummyHandler(logging.Handler):
        def emit(self, record):
            logged_errors.append(record)

    dummy_handler = DummyHandler()
    logger = logging.getLogger("msm.tasks")
    logger.addHandler(dummy_handler)

    async def fehlschlagende_aufgabe():
        await asyncio.sleep(0.01)
        raise ValueError("Kritischer Task-Fehler")

    try:
        task = sichere_aufgabe(fehlschlagende_aufgabe(), name="test-hintergrund-task")
        await asyncio.wait_for(task, timeout=1.0)
    except ValueError:
        pass  # Erwartet bei direktem await

    # Task muss abgeschlossen sein
    assert task.done()
    # Der Done-Callback muss die Ausnahme abgeholt und protokolliert haben
    assert len(logged_errors) >= 1
    rec = logged_errors[-1]
    assert "test-hintergrund-task" in rec.getMessage()
    assert getattr(rec, "request_id", None) == "task-req-1234"

    logger.removeHandler(dummy_handler)
    request_id_ctx.reset(token)


def test_get_db_rollt_offene_transaktion_zurueck():
    mock_session = MagicMock()

    with patch("database.SessionLocal", return_value=mock_session):
        gen = get_db()
        db = next(gen)
        assert db == mock_session
        assert mock_session.rollback.call_count == 0

        # Generator beenden (simuliert Request-Ende / Teardown)
        try:
            next(gen)
        except StopIteration:
            pass

        # In finally muss rollback() vor close() aufgerufen werden
        assert mock_session.rollback.call_count == 1
        assert mock_session.close.call_count == 1


def test_prometheus_metrics_histogram_und_buckets():
    import re
    from routers.metrics import record_request_metrics, generate_prometheus_metrics

    # Test-Aufrufe mit bekannten Laufzeiten
    path = "/api/test-histogram-check"
    record_request_metrics("GET", path, 200, 0.04)  # 40ms -> <= 0.05
    record_request_metrics("GET", path, 200, 0.08)  # 80ms -> <= 0.1

    metrics_text = generate_prometheus_metrics()
    assert "http_request_duration_seconds_bucket" in metrics_text
    assert "http_request_duration_seconds_sum" in metrics_text
    assert "http_request_duration_seconds_count" in metrics_text

    # Histogramm-Buckets extrahieren für diesen Pfad
    lines = [l for l in metrics_text.splitlines() if f'path="{path}"' in l]
    # Summe und Count
    count_line = [l for l in lines if l.startswith("http_request_duration_seconds_count")][0]
    sum_line = [l for l in lines if l.startswith("http_request_duration_seconds_sum")][0]

    assert count_line.endswith(" 2")
    # 0.04 + 0.08 = 0.12s
    total_sum = float(sum_line.split()[-1])
    assert abs(total_sum - 0.12) < 0.0001

    # Monoton steigend für le="0.05", le="0.1", le="+Inf"
    bucket_005 = [l for l in lines if 'le="0.05"' in l][0]
    bucket_010 = [l for l in lines if 'le="0.1"' in l][0]
    bucket_inf = [l for l in lines if 'le="+Inf"' in l][0]

    assert bucket_005.endswith(" 1")
    assert bucket_010.endswith(" 2")
    assert bucket_inf.endswith(" 2")


def test_http_exception_string_detail_bleibt_unveraendert():
    from fastapi import HTTPException
    from errors import problem, ErrorCode

    test_client = TestClient(app, raise_server_exceptions=False)

    @app.get("/api/test-string-detail-404", include_in_schema=False)
    def string_404_route():
        raise HTTPException(status_code=404, detail="Nicht da")

    @app.get("/api/test-problem-detail-404", include_in_schema=False)
    def problem_404_route():
        raise problem(ErrorCode.NOT_FOUND, 404, "Nicht gefunden")

    # 1. Bestehende String-Details bleiben String (nicht in Objekt gewrappt!)
    res_str = test_client.get("/api/test-string-detail-404")
    assert res_str.status_code == 404
    assert res_str.json() == {"detail": "Nicht da"}
    assert res_str.headers.get("x-request-id") is not None

    # 2. Neue problem()-Exceptions liefern das standardisierte Objekt
    res_prob = test_client.get("/api/test-problem-detail-404")
    assert res_prob.status_code == 404
    assert res_prob.json() == {
        "detail": {
            "code": "not_found",
            "message": "Nicht gefunden",
        }
    }
    assert res_prob.headers.get("x-request-id") is not None


def test_rate_limit_429_enthaelt_retry_after_und_detail():
    from main import limiter

    test_client = TestClient(app, raise_server_exceptions=False)

    @app.get("/api/test-rate-limit-hit", include_in_schema=False)
    @limiter.limit("1/minute")
    async def rate_limit_route(request: Request):
        return {"ok": True}

    res1 = test_client.get("/api/test-rate-limit-hit")
    assert res1.status_code == 200

    res2 = test_client.get("/api/test-rate-limit-hit")
    assert res2.status_code == 429
    body = res2.json()
    assert body["detail"]["code"] == "rate_limited"
    assert "Retry-After" in res2.headers or "retry-after" in res2.headers
    assert res2.headers.get("x-request-id") is not None


def test_prometheus_sidecar_und_queue_metriken():
    from routers.metrics import (
        record_sidecar_metrics,
        generate_prometheus_metrics,
    )

    record_sidecar_metrics(0.015)
    metrics_text = generate_prometheus_metrics()

    assert "sidecar_request_duration_seconds_sum" in metrics_text
    assert "sidecar_request_duration_seconds_count" in metrics_text
    assert "sidecar_latency_seconds" in metrics_text
    assert "queue_depth" in metrics_text


def test_sensitive_data_scrubbing_in_logs_und_sentry():
    import json
    from middleware.request_id import JsonFormatter, scrub_sensitive_data
    import os

    # 1. Prüfe scrub_sensitive_data direkt
    raw_text = (
        "Failed with Bearer eyJhbGciOi.secret.signature and password=supersecret "
        "and api_key=xyz123 at postgresql://user:mysecretpassword@127.0.0.1:5432/msmdb"
    )
    scrubbed = scrub_sensitive_data(raw_text)
    assert "supersecret" not in scrubbed
    assert "mysecretpassword" not in scrubbed
    assert "eyJhbGciOi" not in scrubbed
    assert "Bearer [REDACTED]" in scrubbed
    assert "password=[REDACTED]" in scrubbed
    assert "api_key=[REDACTED]" in scrubbed
    assert "postgresql://user:[REDACTED]@127.0.0.1:5432/msmdb" in scrubbed

    # 2. Prüfe JsonFormatter Exception- und Message-Scrubbing
    formatter = JsonFormatter()
    try:
        raise ValueError("Sensitive error: password=secretpass in postgresql://dbuser:topsecret@localhost:5432/db")
    except Exception as exc:
        record = logging.LogRecord(
            name="msm.test",
            level=logging.ERROR,
            pathname="test.py",
            lineno=42,
            msg="Database error with token=secrettoken",
            args=(),
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        formatted = formatter.format(record)
        parsed = json.loads(formatted)
        assert "secretpass" not in parsed["exc"]
        assert "topsecret" not in parsed["exc"]
        assert "secrettoken" not in parsed["msg"]
        assert "[REDACTED]" in parsed["exc"]
        assert "[REDACTED]" in parsed["msg"]



