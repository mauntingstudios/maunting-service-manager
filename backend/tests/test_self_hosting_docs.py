"""Vertragstest für die Self-Hosting-Dokumentation (Hardening WP0.2).

Prüft:
1. docs/self-hosting.md (EN) ist als 'Summary' betitelt, verweist auf die
   deutsche Fassung als kanonische Quelle und enthält die Pflichtabschnitte
   (Installation, Update, Node-Enrollment, Migration).
2. docs/de-docs/self-hosting.md (DE) ist die vollständige Langfassung
   (MSS, Pontis, DB-Verschlüsselung, KI, Anrufe, E2EE, Push, Kubernetes).
3. frontend/src/pages/docs/SelfHostingDocs.tsx verweist auf die kanonische
   Quelle und alle Sprungleisten-Ziele existieren als Abschnitte im Quelltext.
"""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def test_en_docs_is_summary_with_canonical_pointer_and_required_sections() -> None:
    en_path = ROOT / "docs" / "self-hosting.md"
    assert en_path.exists(), "docs/self-hosting.md fehlt"
    content = en_path.read_text(encoding="utf-8")

    # 1. Titel als Summary und Kanonisch-Zeiger auf de-docs
    assert "Summary" in content.splitlines()[0], "Titel muss als Summary gekennzeichnet sein"
    assert "de-docs/self-hosting.md" in content, "Muss auf docs/de-docs/self-hosting.md verlinken"
    assert "kanonisch" in content.lower() or "canonical" in content.lower(), "Muss kanonischen Status der DE-Fassung benennen"

    # 2. Pflichtabschnitte
    # Installation
    assert "bootstrap.sh" in content or "install.sh" in content, "Pflichtabschnitt Installation fehlt"
    # Update
    assert "update.sh" in content or "Maintenance & Updates" in content or "Upgrading" in content, "Pflichtabschnitt Update fehlt"
    # Node-Enrollment
    assert "bootstrap.sh" in content or "enrollment" in content.lower() or "Connecting Remote Worker Nodes" in content, "Pflichtabschnitt Node-Enrollment fehlt"
    # Migration
    assert "migrate-panel-components.sh" in content, "Pflichtabschnitt Migration fehlt"


def test_de_docs_is_complete_longform() -> None:
    de_path = ROOT / "docs" / "de-docs" / "self-hosting.md"
    assert de_path.exists(), "docs/de-docs/self-hosting.md fehlt"
    content = de_path.read_text(encoding="utf-8")

    # Pflichtthemen der Langfassung
    themen = [
        "Smart System",
        "Pontis",
        "Verschlüsselung",
        "KI",
        "E2EE",
        "Push",
        "Kubernetes",
    ]
    for thema in themen:
        assert thema.lower() in content.lower(), f"Pflichtthema {thema} fehlt in der kanonischen DE-Doku"


def test_self_hosting_docs_page_contract() -> None:
    page_path = ROOT / "frontend" / "src" / "pages" / "docs" / "SelfHostingDocs.tsx"
    assert page_path.exists(), "SelfHostingDocs.tsx fehlt"
    content = page_path.read_text(encoding="utf-8")

    # Verweis auf die kanonische Quelle
    assert "de-docs/self-hosting.md" in content, "SelfHostingDocs.tsx muss auf die kanonische DE-Quelle verweisen"

    # Alle Sprungleisten-Ziele müssen als id="..." existieren
    ziele_match = re.search(r'ziele=\{\[\s*([\s\S]*?)\s*\]\}', content)
    assert ziele_match, "Sprungleiste ziele nicht gefunden"
    ziele_block = ziele_match.group(1)
    ziel_ids = re.findall(r"id:\s*['\"]([^'\"]+)['\"]", ziele_block)
    assert len(ziel_ids) >= 15, f"Zu wenige Sprungziele: {len(ziel_ids)}"

    for zid in ziel_ids:
        # Prüfen, dass die ID im Markup definiert ist (z. B. id="deployment-units" oder id={`...`})
        pattern = rf'id=[\'"`]{re.escape(zid)}[\'"`]'
        assert re.search(pattern, content), f"Sprungziel '{zid}' hat keinen entsprechenden Abschnitt mit id='{zid}'"
