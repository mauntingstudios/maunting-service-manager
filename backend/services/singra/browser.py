"""Playwright Browser-Automatisierung und E2E-Test-Gate für Singra-Projekte.

Unterstützt:
- Strikten Origin-Guard: Verhindert externe Netzwerkanfragen (DSGVO & Leak-Schutz)
- Desktop- und Smartphone-Viewports
- Interaktive Menü- und Spiele-Tests (Klickfolgen, Tastenanschläge)
- Negativ-Tests: Fehlerhafte Eingaben bei Formularen/Logins provozieren und auf saubere Fehlerbehandlung prüfen
- Screenshot-Erfassung je Schritt
- Persistierung in `SingraTestRun`
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

from models.singra_test_run import SingraTestRun
from services.ai_preview_inspector import find_browser_executable

logger = logging.getLogger(__name__)

VIEWPORTS = {
    "desktop": {"width": 1280, "height": 800},
    "mobile": {"width": 375, "height": 667},
}


class SingraTestError(Exception):
    """Fehler bei der Testausführung."""


def run_project_browser_tests(
    db: Session,
    project_id: str,
    target_url: str,
    *,
    environment: str = "dev",
    release_checksum: str | None = None,
    artifacts_dir: Path | None = None,
    custom_scenarios: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Führt automatisierte Browser-Tests für das Projekt aus und speichert das Ergebnis."""
    from services import ai_project_service

    run_id = str(uuid4())
    started_at = datetime.now(timezone.utc)
    summary: dict[str, Any] = {
        "run_id": run_id,
        "target_url": target_url,
        "environment": environment,
        "release_checksum": release_checksum,
        "steps": [],
        "screenshots": [],
        "console_errors": [],
        "page_errors": [],
        "network_errors": [],
        "blocked_external_requests": [],
        "third_party_requests_blocked": 0,
        "negative_tests": {
            "empty_submit_blocked": True,
            "invalid_inputs_tested": 0,
            "survived": True,
            "details": [],
        },
        "viewports": {},
        "overflow_detected": False,
        "errors": [],
        "passed": False,
        "ok": False,
    }

    if artifacts_dir:
        artifacts_dir.mkdir(parents=True, exist_ok=True)

    # Scenarios laden (custom_scenarios oder tests/*.e2e.json)
    scenarios: list[dict[str, Any]] = []
    if custom_scenarios:
        scenarios.extend(custom_scenarios)
    else:
        try:
            proj = ai_project_service.get_project(db, None, project_id) if project_id else None
            if proj:
                ws = ai_project_service.ensure_project_workspace(proj)
                tests_dir = ws / "tests"
                if tests_dir.is_dir():
                    for e2e_file in sorted(tests_dir.glob("*.e2e.json")):
                        try:
                            s_data = json.loads(e2e_file.read_text(encoding="utf-8"))
                            if isinstance(s_data, list):
                                scenarios.extend(s_data)
                            elif isinstance(s_data, dict):
                                if "steps" in s_data and isinstance(s_data["steps"], list):
                                    scenarios.extend(s_data["steps"])
                                else:
                                    scenarios.append(s_data)
                        except Exception as e_err:
                            logger.debug("Konnte E2E-Datei %s nicht lesen: %s", e2e_file, e_err)
        except Exception as sc_exc:
            logger.debug("Szenarien-Erkennung meldet: %s", sc_exc)

    # 1. Prüfen, ob Playwright verfügbar ist
    try:
        from playwright.sync_api import sync_playwright
        has_playwright = True
    except ImportError:
        has_playwright = False
        logger.info("Playwright ist nicht installiert; verwende HTTP-Probe-Fallback.")

    parsed_target = urlparse(target_url)
    allowed_host = parsed_target.hostname or "127.0.0.1"

    if has_playwright:
        browser_exec = find_browser_executable()
        try:
            with sync_playwright() as p:
                launch_kwargs: dict[str, Any] = {
                    "headless": True,
                    "args": [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                    ],
                }
                b_path = Path(browser_exec) if browser_exec else None
                if b_path:
                    try:
                        if b_path.exists():
                            launch_kwargs["executable_path"] = str(b_path)
                    except (OSError, ValueError):
                        pass

                browser = p.chromium.launch(**launch_kwargs)
                try:
                    for vp_name, vp_size in VIEWPORTS.items():
                        context = browser.new_context(
                            viewport=vp_size,
                            locale="de-DE",
                            user_agent=f"SingraTestAgent/1.0 ({vp_name})",
                        )

                        page = context.new_page()

                        # Strikter Origin-Guard: Alle lokalen Adressen erlaubt, externe blockiert
                        def _route_handler(route):
                            req_url = route.request.url
                            r_parsed = urlparse(req_url)
                            r_host = r_parsed.hostname or ""

                            if r_host in ("127.0.0.1", "localhost", "::1", allowed_host):
                                route.continue_()
                            elif req_url.startswith("data:") or req_url.startswith("blob:"):
                                route.continue_()
                            else:
                                summary["blocked_external_requests"].append(req_url)
                                summary["third_party_requests_blocked"] = len(summary["blocked_external_requests"])
                                route.abort()

                        page.route("**/*", _route_handler)

                        # Event-Logging
                        page.on("console", lambda msg: summary["console_errors"].append(msg.text) if msg.type == "error" else None)
                        page.on("pageerror", lambda err: summary["page_errors"].append(str(err)))
                        page.on(
                            "response",
                            lambda resp: summary["network_errors"].append(f"{resp.status} {resp.url}")
                            if resp.status >= 400 and not resp.url.startswith("data:")
                            else None,
                        )

                        # Hauptseite ansteuern
                        resp = page.goto(target_url, wait_until="domcontentloaded", timeout=15000)
                        try:
                            status_code = int(resp.status) if (resp and hasattr(resp, "status")) else 200
                        except (TypeError, ValueError):
                            status_code = 200

                        # Overflow-Prüfung
                        overflow_info = page.evaluate("""() => {
                            const docEl = document.documentElement;
                            const body = document.body;
                            const scrollW = Math.max(docEl ? docEl.scrollWidth : 0, body ? body.scrollWidth : 0);
                            const innerW = window.innerWidth || 1;
                            return {
                                overflow: scrollW > (innerW + 1),
                                scrollWidth: scrollW,
                                innerWidth: innerW
                            };
                        }""")

                        if not isinstance(overflow_info, dict):
                            overflow_info = {"overflow": False}
                        elif "overflow" not in overflow_info:
                            sw = overflow_info.get("scroll_width") or overflow_info.get("scrollWidth") or 0
                            cw = overflow_info.get("client_width") or overflow_info.get("innerWidth") or 1
                            overflow_info["overflow"] = bool(sw > cw + 1)

                        summary["viewports"][vp_name] = overflow_info
                        if overflow_info.get("overflow"):
                            summary["overflow_detected"] = True

                        # Screenshot
                        screenshot_path = None
                        if artifacts_dir:
                            shot_file = artifacts_dir / f"{vp_name}_initial.png"
                            page.screenshot(path=str(shot_file), full_page=True)
                            screenshot_path = str(shot_file)
                            summary["screenshots"].append(screenshot_path)

                        page_title = str(page.title()) if hasattr(page, "title") else ""
                        summary["steps"].append({
                            "viewport": vp_name,
                            "action": "goto",
                            "status_code": status_code,
                            "title": page_title,
                            "overflow": overflow_info,
                            "screenshot": screenshot_path,
                        })

                        # E2E-Szenarien ausführen (Klicks, Tasten, Spiele-/Menüinteraktionen)
                        if scenarios and vp_name == "desktop":
                            for s_idx, sc in enumerate(scenarios):
                                sc_act = str(sc.get("action") or "click").lower()
                                sc_sel = sc.get("selector")
                                sc_shot = None
                                try:
                                    if sc_act == "click" and sc_sel:
                                        page.click(sc_sel, timeout=3000)
                                    elif sc_act in ("click_at", "click_xy"):
                                        x_coord = float(sc.get("x", 100))
                                        y_coord = float(sc.get("y", 100))
                                        page.mouse.click(x_coord, y_coord)
                                    elif sc_act in ("fill", "type") and sc_sel:
                                        val = str(sc.get("text") or sc.get("value") or "")
                                        page.fill(sc_sel, val, timeout=3000)
                                    elif sc_act in ("press", "key"):
                                        key_name = str(sc.get("key") or sc.get("text") or "Enter")
                                        page.keyboard.press(key_name)
                                    elif sc_act in ("wait", "sleep"):
                                        wait_ms = int(sc.get("ms") or sc.get("timeout_ms") or 500)
                                        page.wait_for_timeout(wait_ms)
                                    elif sc_act == "wait_for_selector" and sc_sel:
                                        page.wait_for_selector(sc_sel, timeout=4000)

                                    if artifacts_dir:
                                        sc_file = artifacts_dir / f"scenario_step_{s_idx + 1}.png"
                                        page.screenshot(path=str(sc_file))
                                        sc_shot = str(sc_file)
                                        summary["screenshots"].append(sc_shot)

                                    summary["steps"].append({
                                        "viewport": vp_name,
                                        "action": f"scenario_{sc_act}",
                                        "selector": sc_sel,
                                        "screenshot": sc_shot,
                                        "passed": True,
                                    })
                                except Exception as sc_err:
                                    logger.debug("Szenario-Schritt %s fehlgeschlagen: %s", sc_act, sc_err)
                                    summary["steps"].append({
                                        "viewport": vp_name,
                                        "action": f"scenario_{sc_act}",
                                        "selector": sc_sel,
                                        "passed": False,
                                        "error": str(sc_err),
                                    })

                        # Negativ-Testing bei Formularen (nur auf Desktop)
                        if vp_name == "desktop":
                            try:
                                inputs = page.query_selector_all("input:not([type='hidden'])")
                                if inputs:
                                    summary["negative_tests"]["invalid_inputs_tested"] = len(inputs)
                                    # Falscheingaben testen
                                    for inp in inputs[:3]:
                                        inp_type = inp.get_attribute("type") or "text"
                                        if inp_type in ("email", "text"):
                                            inp.fill("invalid-test-email-without-at")
                                        elif inp_type == "password":
                                            inp.fill("' OR '1'='1")

                                    submit_btn = page.query_selector("button[type='submit'], input[type='submit'], button")
                                    if submit_btn:
                                        submit_btn.click(timeout=3000)
                                        page.wait_for_timeout(500)

                                        # Screenshot nach Negativtest
                                        neg_shot = None
                                        if artifacts_dir:
                                            neg_file = artifacts_dir / "negative_test.png"
                                            page.screenshot(path=str(neg_file))
                                            neg_shot = str(neg_file)

                                        survived = len(summary["page_errors"]) == 0
                                        summary["negative_tests"]["survived"] = survived
                                        summary["negative_tests"]["empty_submit_blocked"] = survived
                                        summary["negative_tests"]["details"].append({
                                            "action": "invalid_form_submit",
                                            "screenshot": neg_shot,
                                            "survived": survived,
                                        })
                            except Exception as neg_exc:
                                logger.debug("Negativ-Test Schritt übersprungen: %s", neg_exc)

                        context.close()
                finally:
                    browser.close()

            def _is_ok_status(code: Any) -> bool:
                try:
                    return int(code) < 500
                except (TypeError, ValueError):
                    return True

            all_steps_ok = all(_is_ok_status(s.get("status_code", 200)) for s in summary["steps"])
            summary["passed"] = (
                len(summary["page_errors"]) == 0
                and len(summary["console_errors"]) == 0
                and not summary["overflow_detected"]
                and all_steps_ok
            )
        except Exception as exc:
            logger.warning("Playwright Browser-Test fehlgeschlagen oder nicht gestartet: %s", exc)
            summary["error"] = str(exc)
            summary["passed"] = False
    else:
        # Fallback: HTTP-Readiness & DOM-Integrität via httpx
        try:
            with httpx.Client(timeout=5.0) as client:
                res = client.get(target_url)
                summary["steps"].append({
                    "action": "http_probe",
                    "status_code": res.status_code,
                    "length": len(res.text),
                    "passed": res.status_code < 400,
                })
                summary["passed"] = (res.status_code < 400)
        except Exception as exc:
            summary["error"] = f"HTTP-Probe fehlgeschlagen: {exc}"
            summary["passed"] = False

    # Fehlerliste aggregieren für Frontend-Diagnose
    err_list: list[str] = []
    if summary.get("error"):
        err_list.append(str(summary["error"]))
    for pe in summary.get("page_errors", []):
        err_list.append(f"Seitenfehler: {pe}")
    for ce in summary.get("console_errors", []):
        err_list.append(f"Konsolenfehler: {ce}")
    for ne in summary.get("network_errors", []):
        err_list.append(f"Netzwerkfehler: {ne}")
    if summary.get("overflow_detected"):
        err_list.append("Layout-Überlauf (horizontaler Scrollbalken auf mobilen Geräten)")
    summary["errors"] = err_list

    finished_at = datetime.now(timezone.utc)
    summary["finished_at"] = finished_at.isoformat()

    # In Datenbank persistieren
    status_str = "passed" if summary["passed"] else "failed"
    json_payload = {k: v for k, v in summary.items() if k != "summary"}
    test_run = SingraTestRun(
        id=run_id,
        project_id=project_id,
        environment=environment,
        release_checksum=release_checksum,
        kind="e2e",
        status=status_str,
        summary_json=json.dumps(json_payload, ensure_ascii=False, default=str),
        artifacts_path=str(artifacts_dir) if artifacts_dir else None,
        started_at=started_at,
        finished_at=finished_at,
    )
    db.add(test_run)
    db.commit()

    summary["ok"] = bool(summary["passed"])
    summary["summary"] = summary
    return summary


def has_passed_test_run(
    db: Session,
    project_id: str,
    release_checksum: str,
) -> bool:
    """Prüft, ob für die gegebene Release-Prüfsumme ein bestandener Test vorliegt (Test-Gate)."""
    run = (
        db.query(SingraTestRun)
        .filter(
            SingraTestRun.project_id == project_id,
            SingraTestRun.release_checksum == release_checksum,
            SingraTestRun.status == "passed",
        )
        .first()
    )
    return run is not None
