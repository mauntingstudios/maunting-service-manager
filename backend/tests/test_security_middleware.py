"""Tests for rate limiting, CSP, CORS, and security headers."""
from fastapi.testclient import TestClient


class TestRateLimiting:
    def test_auth_endpoint_rate_limit(self, client: TestClient):
        """Auth endpoints should be rate-limited to 10 req/min via slowapi."""
        for i in range(12):
            response = client.post("/api/auth/login", json={
                "username": "nonexistent",
                "password": "wrong",
                "otp_code": None,
            })
            if response.status_code == 429:
                return
        assert False, "Auth rate limiting did not trigger"

    def test_general_endpoint_rate_limit(self, client: TestClient):
        """General endpoints allow 300 req/min via slowapi default limit."""
        for i in range(305):
            response = client.get("/api/health")
            if response.status_code == 429:
                return
        assert False, "General rate limiting did not trigger"

    def test_rate_limit_uses_x_forwarded_for_with_ip_isolation(self, client: TestClient):
        """Each client IP via X-Forwarded-For must have an isolated rate-limit bucket."""
        from middleware.rate_limit import limiter

        limiter.reset()
        saw_429 = False
        for _ in range(12):
            response = client.post(
                "/api/auth/login",
                json={"username": "nonexistent", "password": "wrong", "otp_code": None},
                headers={"X-Forwarded-For": "1.2.3.4"},
            )
            if response.status_code == 429:
                saw_429 = True
                break
        assert saw_429, "Rate limiting did not trigger for 1.2.3.4"

        other_ip_resp = client.post(
            "/api/auth/login",
            json={"username": "nonexistent", "password": "wrong", "otp_code": None},
            headers={"X-Forwarded-For": "5.6.7.8"},
        )
        assert other_ip_resp.status_code != 429, "Different X-Forwarded-For IP shared the exhausted bucket"

    def test_rate_limit_ignores_spoofed_leftmost_x_forwarded_for(self, client: TestClient):
        """Spoofing a leftmost X-Forwarded-For IP cannot bypass the real rightmost client IP."""
        from middleware.rate_limit import limiter

        limiter.reset()
        saw_429 = False
        for i in range(12):
            response = client.post(
                "/api/auth/login",
                json={"username": "nonexistent", "password": "wrong", "otp_code": None},
                headers={"X-Forwarded-For": f"9.9.9.{i + 1}, 198.51.100.42"},
            )
            if response.status_code == 429:
                saw_429 = True
                break
        assert saw_429, "Rightmost client IP was not enforced against leftmost XFF spoofing"

    def test_options_preflight_does_not_consume_rate_limit_budget(self, client: TestClient):
        """CORS OPTIONS preflight requests must never count against API rate limits."""
        from middleware.rate_limit import limiter

        limiter.reset()
        for _ in range(15):
            preflight = client.options(
                "/api/auth/login",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                    "X-Forwarded-For": "203.0.113.10",
                },
            )
            assert preflight.status_code == 200

        login_resp = client.post(
            "/api/auth/login",
            json={"username": "nonexistent", "password": "wrong", "otp_code": None},
            headers={"X-Forwarded-For": "203.0.113.10"},
        )
        assert login_resp.status_code != 429


class TestSecurityHeaders:
    def test_csp_header_present(self, client: TestClient):
        response = client.get("/api/health")
        assert "Content-Security-Policy" in response.headers
        csp = response.headers["Content-Security-Policy"]
        assert "default-src 'self'" in csp
        assert "script-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp

    def test_x_content_type_options(self, client: TestClient):
        response = client.get("/api/health")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"

    def test_x_frame_options(self, client: TestClient):
        response = client.get("/api/health")
        assert response.headers.get("X-Frame-Options") == "DENY"

    def test_referrer_policy(self, client: TestClient):
        response = client.get("/api/health")
        assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


class TestCors:
    def test_cors_preflight_allowed(self, client: TestClient):
        response = client.options("/api/health", headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        })
        assert response.status_code == 200
        assert "access-control-allow-origin" in response.headers

    def test_app_darf_den_mailbox_nachweis_mitschicken(self, client: TestClient):
        """Die Desktop-App spricht von fremder Herkunft und fragt deshalb vorab.

        Fehlte `X-Mailbox-Token` in der Liste, lehnte der Server die Vorabfrage
        mit 400 ab, und die App konnte in keine Mailbox mit Nachweis senden oder
        daraus lesen — Direktchats mit Chatgeheimnis und Gruppen. So stand es am
        26.09.2026 im Log des Live-Servers.
        """
        for pfad, methode in (("/api/social/e2ee/relay", "POST"), ("/api/social/e2ee/mailbox/" + "ab" * 32, "GET")):
            response = client.options(pfad, headers={
                "Origin": "tauri://localhost",
                "Access-Control-Request-Method": methode,
                "Access-Control-Request-Headers": "content-type,x-csrf-token,x-mailbox-token",
            })
            assert response.status_code == 200, (pfad, response.text)
            assert "x-mailbox-token" in response.headers["access-control-allow-headers"].lower()

    def test_jeder_eigene_kopf_des_frontends_steht_in_der_liste(self, client: TestClient):
        """Ein neuer `X-…`-Kopf im Frontend braucht seinen Eintrag in `allow_headers`.

        Im Panel fällt das Fehlen nicht auf — gleiche Herkunft, keine
        Vorabfrage. Erst die App merkt es, und dort liest niemand ein Log.
        """
        import re
        from pathlib import Path

        quelle = Path(__file__).resolve().parents[2] / "frontend" / "src"
        if not quelle.is_dir():
            import pytest

            pytest.skip("Frontend liegt nicht daneben")
        koepfe: set[str] = set()
        gelesen: set[str] = set()
        for datei in quelle.rglob("*.ts*"):
            if ".test." in datei.name:
                continue
            text = datei.read_text(encoding="utf-8")
            koepfe.update(re.findall(r"""['"](X-[A-Za-z0-9-]+)['"]""", text))
            gelesen.update(re.findall(r"""headers\.get\(['"]([A-Za-z0-9-]+)['"]\)""", text))
        # Was aus einer Antwort gelesen wird, schickt das Frontend nicht mit.
        koepfe -= gelesen
        assert koepfe, "keine eigenen Köpfe gefunden — Muster veraltet?"

        response = client.options("/api/health", headers={
            "Origin": "tauri://localhost",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": ",".join(sorted(k.lower() for k in koepfe)),
        })
        assert response.status_code == 200, (sorted(koepfe), response.text)

    def test_jeder_gelesene_kopf_einer_antwort_ist_freigegeben(self, client: TestClient):
        """Liest das Frontend einen Kopf aus der Antwort, muss er in `expose_headers` stehen.

        Sonst sieht die App (fremde Herkunft) `null`: bis 29.09.2026 fehlten
        Dateiname, Größe und Prüfsumme der Studio-Downloads und der Hinweis auf
        einen gekürzten Export.
        """
        import re
        from pathlib import Path

        quelle = Path(__file__).resolve().parents[2] / "frontend" / "src"
        if not quelle.is_dir():
            import pytest

            pytest.skip("Frontend liegt nicht daneben")
        gelesen: set[str] = set()
        for datei in quelle.rglob("*.ts*"):
            if ".test." in datei.name:
                continue
            gelesen.update(re.findall(r"""headers\.get\(['"]([A-Za-z0-9-]+)['"]\)""", datei.read_text(encoding="utf-8")))
        assert gelesen, "keine gelesenen Köpfe gefunden — Muster veraltet?"

        response = client.get("/api/health", headers={"Origin": "tauri://localhost"})
        freigegeben = {k.strip().lower() for k in response.headers.get("access-control-expose-headers", "").split(",")}
        fehlend = sorted(k for k in gelesen if k.lower() not in freigegeben)
        assert not fehlend, fehlend

    def test_cors_origin_reflected(self, client: TestClient):
        response = client.get("/api/health", headers={
            "Origin": "http://localhost:3000",
        })
        assert "access-control-allow-origin" in response.headers
