# Nordkapp Cloud — Beispiel-Shop & Hoster-API-Testsuite (`example-with-test`)

Referenzimplementierung eines vollständig entkoppelten externen Shops für die **MSM Hoster-API** (`docs/hoster-api.md` / `docs/de-docs/hoster-api.md`) mit **Stripe Checkout & Webhooks** sowie automatisierter Black-Box-Testsuite.

## Enthaltene Dateien

- `hoster_client.py` — Server-to-Server-Client (`/api/hoster/v1/health`, `/catalog`, `/apply`, `/services/{id}`, `/handoffs`) inklusive Rohbody-HMAC-Prüfung (`verify_msm_webhook`).
- `stripe_service.py` — Stripe Checkout (`subscription` / `payment`) und Webhook-Signaturprüfung (`stripe.Webhook.construct_event`).
- `store.py` — Eigenständige SQLite-Persistenz für Verträge, Stripe-Verknüpfungen und Webhook-Logs.
- `app.py` & `static/` — FastAPI-Backend + unabhängige Storefront-Oberfläche (Katalog-Spiegelung, Checkout, Vertrags-Lifecycle, Ein-Klick-Handoff, Webhook-Inspektor).
- `test_phase8_e2e.py` — Pytest-Suite (Doku-HMAC-Testvektor, Webhook-Signaturprüfung, Stripe-Sandbox-Test, Live-Hoster-API-Lifecycle).
- `run_live_blackbox.py` — Startet lokal ein isoliertes MSM-Backend auf PostgreSQL (Port `15499`) und testet den Shop per echtem HTTP dagegen.

## Einrichtung & Start

1. Virtuelle Umgebung anlegen und Abhängigkeiten installieren:
   ```bash
   cd example-with-test
   python -m venv .venv
   # Linux/macOS: source .venv/bin/activate
   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. `.env.example` nach `.env` kopieren und Zugangsdaten eintragen:
   - `MSM_PANEL_URL`, `MSM_HOSTER_KEY`, `MSM_WEBHOOK_SECRET`
   - `STRIPE_SECRET_KEY` (`sk_test_...`) und `STRIPE_WEBHOOK_SECRET` (`whsec_...`)
3. Beispiel-Shop starten:
   ```bash
   python app.py
   ```
4. Optional Stripe-Webhooks lokal weiterleiten:
   ```bash
   stripe listen --forward-to http://127.0.0.1:8090/webhooks/stripe
   ```

## Tests ausführen

```bash
# Eigenständige Shop- & HMAC-Tests
pytest -v test_phase8_e2e.py -k "not test_real_stripe_sandbox and not test_live_msm_hoster_api"

# Mit echtem Stripe Sandbox Key
STRIPE_SECRET_KEY=sk_test_... pytest -v test_phase8_e2e.py -k "not test_live_msm_hoster_api"

# Gegen ein laufendes MSM-Panel (Live-Lifecycle)
MSM_PANEL_URL=https://panel.example MSM_HOSTER_KEY=... pytest -v test_phase8_e2e.py
```
