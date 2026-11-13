"""Eingefrorene Werkzeugmengen und Katalog-Schnappschuss.

Diese Werte sind das Sicherheitsnetz fuer den Umbau auf `ToolSpec`: jede
Scheibe muss sie unveraendert lassen. Aendert sich hier etwas, ist das eine
bewusste Entscheidung und gehoert im selben Commit in die Nachricht — nie ein
Nebeneffekt eines Umzugs.

Der Katalog haengt an drei Konfigurationen (Websuche, Cloudflare, Lernpolitik).
Alle drei werden hier festgesetzt, damit der Schnappschuss ohne Datenbank und
ohne Betreibereinstellungen derselbe bleibt.
"""

from __future__ import annotations

import hashlib
import importlib
import json

import pytest

from services import ai_tool_registry as registry
from services.ai_tools import server_tools


def _hash(defs: list[dict]) -> str:
    return hashlib.sha256(
        json.dumps(defs, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def _katalog(monkeypatch, *, suche: bool, cloudflare: bool, politik: str) -> list[dict]:
    import services.ai_learning_policy as learning_policy
    import services.ai_web_search_service as web_search
    import services.cloudflare_service as cloudflare_service

    monkeypatch.setattr(web_search, "is_configured", lambda: suche)
    monkeypatch.setattr(cloudflare_service, "is_configured", lambda: cloudflare)
    monkeypatch.setattr(learning_policy, "policy", lambda: politik)
    return server_tools.provider_tool_definitions()


MENGEN = {
    "SERVER_READ_TOOLS": [
        "check_server_reachability", "list_server_files", "read_ai_action_history",
        "read_config", "read_database", "read_guardian_incidents", "read_mod_updates",
        "read_server_backups", "read_server_capacity", "read_server_logs",
        "read_server_mods", "read_server_network", "read_server_ports",
        "read_server_status", "search_server_files", "search_workshop_mods",
    ],
    "GLOBAL_READ_TOOLS": [
        "advise_node_placement", "analyze_region", "ask_user", "calendar_read",
        "cloudflare_list_dns_records", "cloudflare_list_zones", "control_region_camera",
        "desktop_artifact", "desktop_aufraeumen", "desktop_dateien", "desktop_launch_app",
        "desktop_steuern", "desktop_system", "email_read", "email_search",
        "execute_server_action", "forget_skill", "get_document_outline", "learn_skill",
        "learn_team_skill", "list_blueprints", "list_document_comments", "list_documents",
        "list_my_servers", "list_roles", "list_tasks", "list_users", "notes_read",
        "popups_read", "project_create", "project_workspace", "read_audit_summary",
        "read_blueprint", "read_chat_attachment", "read_docs", "read_document",
        "read_document_selection", "read_document_skill", "read_document_structure",
        "read_hoster_integration_guide", "read_hoster_setup", "read_node_capacity",
        "read_node_health", "read_skill", "read_team_calendar", "read_team_notes",
        "read_user_permissions", "read_web_page", "search_audit_log",
        "search_chat_attachments", "search_curseforge_modpacks", "search_curseforge_mods",
        "search_docs", "search_memory", "search_team_memory", "send_test_email",
        "wait_until", "web_search", "worker_antwort", "worker_cancel", "worker_frage",
        "worker_start",
    ],
    "READ_TOOLS": [
        "add_document_comment", "advise_node_placement", "analyze_region", "ask_user",
        "calendar_read", "check_server_reachability", "cloudflare_list_dns_records",
        "cloudflare_list_zones", "control_region_camera", "desktop_artifact",
        "desktop_aufraeumen", "desktop_dateien", "desktop_launch_app", "desktop_steuern",
        "desktop_system", "edit_document", "email_read", "email_search",
        "execute_server_action", "forget_skill", "get_document_outline", "learn_skill",
        "learn_team_skill", "list_blueprints", "list_document_comments", "list_documents",
        "list_my_servers", "list_roles", "list_server_files", "list_tasks", "list_users",
        "notes_read", "popups_read", "project_create", "project_workspace",
        "read_ai_action_history", "read_audit_summary", "read_blueprint", "read_chat_attachment", "read_config",
        "read_database", "read_docs", "read_document", "read_document_selection",
        "read_document_skill", "read_document_structure", "read_guardian_incidents",
        "read_hoster_integration_guide", "read_hoster_setup", "read_mod_updates",
        "read_node_capacity", "read_node_health", "read_server_backups",
        "read_server_capacity", "read_server_logs", "read_server_mods",
        "read_server_network", "read_server_ports", "read_server_status", "read_skill",
        "read_team_calendar", "read_team_notes", "read_user_permissions", "read_web_page",
        "search_audit_log", "search_chat_attachments", "search_curseforge_modpacks", "search_curseforge_mods",
        "search_docs", "search_memory", "search_server_files", "search_team_memory",
        "search_workshop_mods", "send_test_email", "undo_ai_edit", "update_document_title",
        "wait_until", "web_search", "worker_antwort", "worker_cancel", "worker_frage",
        "worker_start",
    ],
    "WRITE_TOOLS": [
        "propose_ai_tarif_role", "propose_backup", "propose_backup_restore",
        "propose_backup_schedule_set", "propose_bind_ip_update", "propose_blueprint_change",
        "propose_blueprint_delete", "propose_calendar_event_create",
        "propose_calendar_event_delete", "propose_calendar_event_update",
        "propose_cloudflare_dns_delete", "propose_cloudflare_dns_record",
        "propose_config_patch", "propose_config_set", "propose_config_update",
        "propose_database_change", "propose_email_send", "propose_file_delete",
        "propose_guardian_tuning", "propose_hoster_integration", "propose_hoster_product",
        "propose_mod_install", "propose_mod_toggle", "propose_modpack_install",
        "propose_note_create", "propose_note_delete", "propose_note_update",
        "propose_popup_set", "propose_restart_schedule_set", "propose_role_delete",
        "propose_role_set", "propose_server_blueprint_switch", "propose_server_create",
        "propose_server_delete", "propose_server_lifecycle", "propose_server_repair",
        "propose_task_delete", "propose_task_set", "propose_user_roles",
        "propose_user_server_permission",
    ],
    "ALWAYS_CONFIRM_TOOLS": [
        "propose_ai_tarif_role", "propose_backup_restore", "propose_blueprint_delete",
        "propose_file_delete", "propose_hoster_integration", "propose_hoster_product",
        "propose_role_delete", "propose_secret_rotation", "propose_server_delete",
        "propose_server_reinstall", "propose_server_wipe",
    ],
    "ASK_TOOLS": ["ask_user", "worker_frage"],
    "DELEGATION_TOOLS": [
        "desktop_artifact", "desktop_aufraeumen", "desktop_dateien", "desktop_launch_app",
        "desktop_steuern", "desktop_system", "wait_until", "worker_antwort",
        "worker_cancel", "worker_start",
    ],
    "DESKTOP_TOOLS": [
        "desktop_artifact", "desktop_aufraeumen", "desktop_dateien", "desktop_launch_app",
        "desktop_steuern", "desktop_system",
    ],
    "MEMORY_TOOLS": ["search_memory"],
    "SKILL_TOOLS": ["forget_skill", "learn_skill", "read_skill"],
    "CALENDAR_TOOLS": [
        "calendar_read", "propose_calendar_event_create", "propose_calendar_event_delete",
        "propose_calendar_event_update",
    ],
    "NOTES_TOOLS": [
        "notes_read", "propose_note_create", "propose_note_delete", "propose_note_update",
    ],
    "PROJECTS_TOOLS": ["project_create", "project_workspace"],
    "DOCUMENTS_TOOLS": [
        "add_document_comment", "edit_document", "get_document_outline", "learn_team_skill",
        "list_document_comments", "list_documents", "read_document",
        "read_document_selection", "read_document_skill", "read_document_structure",
        "read_team_calendar", "read_team_notes", "search_team_memory", "undo_ai_edit",
        "update_document_title",
    ],
    "DOCUMENTS_WRITE_TOOLS": [
        "add_document_comment", "edit_document", "undo_ai_edit", "update_document_title",
    ],
    "DOCUMENTS_READ_TOOLS": [
        "get_document_outline", "learn_team_skill", "list_document_comments",
        "list_documents", "read_document", "read_document_selection",
        "read_document_skill", "read_document_structure", "read_team_calendar",
        "read_team_notes", "search_team_memory",
    ],
    "DOCS_TEAM_TOOLS": [
        "learn_team_skill", "read_document_skill", "read_team_calendar",
        "read_team_notes", "search_team_memory",
    ],
    "DOCS_ECOSYSTEM_READ": [
        "check_server_reachability", "list_my_servers", "read_chat_attachment",
        "read_guardian_incidents", "read_mod_updates", "read_node_capacity",
        "read_node_health", "read_server_backups", "read_server_capacity",
        "read_server_mods", "read_server_network", "read_server_ports",
        "read_server_status", "search_chat_attachments",
    ],
    "MAIL_TOOLS": ["email_read", "email_search", "propose_email_send"],
    "POPUP_TOOLS": ["popups_read", "propose_popup_set"],
    "TASK_TOOLS": ["list_tasks", "propose_task_delete", "propose_task_set", "send_test_email"],
    "ATTACHMENT_TOOLS": ["read_chat_attachment", "search_chat_attachments"],
    "CHAT_INTERACTION_TOOLS": [
        "calendar_read", "email_read", "email_search", "list_tasks", "notes_read",
        "popups_read", "propose_calendar_event_create", "propose_calendar_event_delete",
        "propose_calendar_event_update", "propose_email_send", "propose_note_create",
        "propose_note_delete", "propose_note_update", "propose_popup_set",
        "propose_task_delete", "propose_task_set", "read_chat_attachment",
        "search_chat_attachments", "send_test_email",
    ],
    "VOICE_CONTROL_TOOLS": [
        "voice_leave_region_view", "voice_resolve_latest_proposal", "voice_set_region_view",
    ],
    "GUARDIAN_HEILUNG_TOOLS": [
        "check_server_reachability", "list_blueprints", "list_server_files",
        "propose_backup", "propose_bind_ip_update", "propose_blueprint_change",
        "propose_config_patch", "propose_config_set", "propose_config_update",
        "propose_file_delete", "propose_guardian_tuning", "propose_mod_install",
        "propose_mod_toggle", "propose_server_lifecycle", "propose_server_repair",
        "read_ai_action_history", "read_blueprint", "read_config", "read_docs",
        "read_guardian_incidents", "read_node_health", "read_server_backups",
        "read_server_capacity", "read_server_logs", "read_server_mods",
        "read_server_network", "read_server_ports", "read_server_status", "search_docs",
        "search_server_files",
    ],
    "GUARDIAN_BACKUP_PFLICHT_TOOLS": [
        "propose_bind_ip_update", "propose_config_patch", "propose_config_set",
        "propose_config_update", "propose_file_delete", "propose_mod_install",
        "propose_server_repair",
    ],
    "EIGENE_DATEN_LOESCHEN": [
        "forget_skill", "propose_calendar_event_delete", "propose_cloudflare_dns_delete",
        "propose_note_delete", "propose_task_delete",
    ],
    "RECHTE_SCHREIBEN": [
        "propose_role_delete", "propose_role_set", "propose_user_roles",
        "propose_user_server_permission",
    ],
    "AUFGABEN_LESEN": [
        "analyze_region", "calendar_read", "check_server_reachability", "email_read",
        "email_search", "list_blueprints", "list_my_servers", "list_server_files",
        "list_tasks", "read_ai_action_history", "read_blueprint", "read_config",
        "read_docs", "read_guardian_incidents", "read_mod_updates", "read_node_capacity",
        "read_node_health", "read_server_backups", "read_server_capacity",
        "read_server_logs", "read_server_mods", "read_server_network", "read_server_ports",
        "read_server_status", "read_web_page", "search_docs", "search_server_files",
        "search_workshop_mods", "web_search",
    ],
    "AUFGABEN_HANDELN": [
        "propose_backup", "propose_backup_schedule_set", "propose_bind_ip_update",
        "propose_calendar_event_create", "propose_calendar_event_update",
        "propose_config_patch", "propose_config_set", "propose_config_update",
        "propose_email_send", "propose_mod_install", "propose_mod_toggle",
        "propose_restart_schedule_set", "propose_server_lifecycle", "propose_server_repair",
    ],
}

KATALOG = [
    (False, False, "off", 118, "0a9f65f2149206d6045969a226df9248e301c24dc0a16ca61f27d3703a4f62e4"),
    (False, False, "review", 118, "89b1048cefd0922a87976c7e4447187ed3c06c8381b2efd61b2ba00e0c88f80d"),
    (False, True, "off", 120, "f4b026d396fbb991a9756778c216eafdc648863ca068332f73025d49597d6ff3"),
    (False, True, "review", 120, "364b7578a4298cc8b0f47e34e7e8e05b3a295486bd348e2b01c583ef50460541"),
    (True, False, "off", 120, "46f909f22a9c86cd3bbf56e3b37cbcce4ab9d4a36cb20f8bb10f9a4452861ce1"),
    (True, False, "review", 120, "71703f66f3728848a27a9cf6a1fba02527176a0e9911bf44a51feb5f0969a182"),
    (True, True, "off", 122, "8ec2600a7092ca64cfd30c2c05fc28ad188e0a5a8206329526adcd72d03ab476"),
    (True, True, "review", 122, "6437051dd2614ca5fcd9b79e3997262ea55e9119475b9ff645b156a9dbb8b0e6"),
]

SPRACHE_KATALOG_HASH = "d616c67eee2793c462ef37b9540cffa53dc445688fbd8a890aa3e82bc41cf266"

# Diese Werkzeuge stehen schon in `ALWAYS_CONFIRM_TOOLS`, sind aber noch nicht
# gebaut. Sie bleiben hier sichtbar, bis sie im Katalog auftauchen.
GEPLANTE_DAUERBESTAETIGUNG = {
    "propose_secret_rotation",
    "propose_server_reinstall",
    "propose_server_wipe",
}


@pytest.mark.parametrize("name", sorted(MENGEN))
def test_die_mengen_sind_eingefroren(name: str) -> None:
    """Jede abgeleitete Menge bleibt woertlich, was sie heute ist."""
    ist = getattr(registry, name)
    assert sorted(ist) == MENGEN[name], f"{name} hat sich geaendert"


def test_aufgaben_tools_trennt_bericht_und_handlung() -> None:
    bericht = registry.aufgaben_tools("report")
    handlung = registry.aufgaben_tools("act")
    assert sorted(bericht) == MENGEN["AUFGABEN_LESEN"]
    assert sorted(handlung) == sorted(set(MENGEN["AUFGABEN_LESEN"]) | set(MENGEN["AUFGABEN_HANDELN"]))


def test_herkunft_schnitt_nimmt_dem_panel_die_desktop_werkzeuge() -> None:
    """Aus dem Browser erreicht die KI keinen Rechner; aus der App alles."""
    erlaubt = frozenset(registry.WERKZEUGE)
    panel = registry.herkunft_schnitt(erlaubt, "panel")
    desktop = registry.herkunft_schnitt(erlaubt, "desktop")
    assert sorted(erlaubt - panel) == MENGEN["DESKTOP_TOOLS"]
    assert desktop == erlaubt


def test_sicherheitsmengen_liegen_im_katalog() -> None:
    for name in (
        "GUARDIAN_HEILUNG_TOOLS",
        "GUARDIAN_BACKUP_PFLICHT_TOOLS",
        "EIGENE_DATEN_LOESCHEN",
        "RECHTE_SCHREIBEN",
        "AUFGABEN_LESEN",
        "AUFGABEN_HANDELN",
    ):
        ist = set(getattr(registry, name))
        assert ist <= set(registry.WERKZEUGE), f"{name} nennt unbekannte Werkzeuge: {ist - set(registry.WERKZEUGE)}"


def test_die_geplanten_dauerbestaetigungen_sind_noch_nicht_gebaut() -> None:
    """Sichtbar halten, was die Bestaetigungsliste schon nennt, der Katalog nicht."""
    assert set(registry.ALWAYS_CONFIRM_TOOLS) - set(registry.WERKZEUGE) == GEPLANTE_DAUERBESTAETIGUNG


@pytest.mark.parametrize("suche,cloudflare,politik,anzahl,erwartet", KATALOG)
def test_der_katalog_bleibt_byte_gleich(
    monkeypatch, suche: bool, cloudflare: bool, politik: str, anzahl: int, erwartet: str
) -> None:
    """Schema, Reihenfolge und Wortlaut des Katalogs aendern sich nicht."""
    defs = _katalog(
        monkeypatch, suche=suche, cloudflare=cloudflare, politik=politik
    )
    assert len(defs) == anzahl
    assert _hash(defs) == erwartet


def test_jede_konfiguration_fuegt_nur_ihre_eigenen_werkzeuge_hinzu(monkeypatch) -> None:
    ohne = _katalog(monkeypatch, suche=False, cloudflare=False, politik="off")
    mit_suche = _katalog(monkeypatch, suche=True, cloudflare=False, politik="off")
    mit_cloudflare = _katalog(monkeypatch, suche=False, cloudflare=True, politik="off")

    namen = lambda defs: {d["function"]["name"] for d in defs}  # noqa: E731
    assert namen(mit_suche) - namen(ohne) == {"web_search", "read_web_page"}
    assert namen(mit_cloudflare) - namen(ohne) == {
        "cloudflare_list_zones",
        "cloudflare_list_dns_records",
    }


def test_die_lernpolitik_aendert_nur_die_auswahl_nicht_den_namen(monkeypatch) -> None:
    """`off` nimmt "global" aus der Auswahl; kein Werkzeug verschwindet."""
    aus = _katalog(monkeypatch, suche=False, cloudflare=False, politik="off")
    an = _katalog(monkeypatch, suche=False, cloudflare=False, politik="review")
    namen = lambda defs: {d["function"]["name"] for d in defs}  # noqa: E731
    assert namen(aus) == namen(an)
    assert _hash(aus) != _hash(an)


def test_der_sprachkatalog_bleibt_gleich() -> None:
    from services.ai_tools.geo_tools import voice_control_tool_definitions

    defs = voice_control_tool_definitions()
    assert len(defs) == 3
    assert _hash(defs) == SPRACHE_KATALOG_HASH


def test_der_import_der_ki_schicht_bleibt_moeglich() -> None:
    """Ein Zyklus faellt hier auf, nicht erst beim Start des Panels."""
    for modul in (
        "services.ai_action_service",
        "services.ai_proposal_service",
        "services.ai_proposals.lifecycle",
        "services.ai_stream.engine",
        "services.ai_stream.read_tools",
        "services.ai_voice.realtime_session",
        "services.tool_selection_port",
        "services.ai_tool_compat",
    ):
        importlib.import_module(modul)
    assert len(registry.WERKZEUGE) == 125
