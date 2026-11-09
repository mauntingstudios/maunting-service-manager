"""Serverbezogene Schreibfaehigkeiten.

Die Schemas standen im Katalog in `server_tools`; die Bauer bleiben in
`ai_proposals.lifecycle.server_vorschlag` (Serveraufloesung, Guardian-Bindung,
Rechtepruefung). Die Specs zeigen ueber `vorschlag_server` darauf.
"""

from __future__ import annotations

from services.ai_tool_spec import ausfuehrung_aus_tabelle, vorschlag_server, werkzeug
from services.ai_tools.base import (
    MAX_BACKUP_NAME_CHARS,
    MAX_CONFIG_CHARS,
    MAX_PATCH_CHUNK_CHARS,
    MAX_PATCH_EDITS,
    _RATIONALE_REQUIRED,
    _RATIONALE_SCHEMA,
    _SERVER_ID_SCHEMA,
    _function,
    _server_function,
)

_PROPOSE_BACKUP = _server_function(
            "propose_backup",
            "Schlaegt ein Server-Backup zur manuellen Bestaetigung vor. Der "
            "Name hilft dem Benutzer, es spaeter wiederzuerkennen — nenne den "
            "Anlass, nicht das Datum.",
            {
                **_RATIONALE_SCHEMA,
                "name": {"type": "string", "maxLength": MAX_BACKUP_NAME_CHARS},
            },
            list(_RATIONALE_REQUIRED),
        )

_PROPOSE_BACKUP_RESTORE = _server_function(
            "propose_backup_restore",
            "Spielt ein Backup ein: ueberschreibt **alle** Serverdaten und "
            "stoppt den Server; alles seit dem Backup ist weg. Immer mit "
            "Bestaetigung. backup_id aus read_server_backups, nie raten.",
            {
                **_RATIONALE_SCHEMA,
                "backup_id": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "ID aus read_server_backups.",
                },
            },
            ["backup_id", *_RATIONALE_REQUIRED],
        )

_PROPOSE_BACKUP_SCHEDULE_SET = _server_function(
            "propose_backup_schedule_set",
            "Setzt den eingebauten Auto-Backup-Zeitplan dieses Servers. "
            "Nur genannte Felder werden angefasst; die übrigen bleiben stehen.",
            {
                "backup_on_start": {
                    "type": "boolean",
                    "description": "Vor jedem Serverstart automatisch sichern.",
                },
                "interval_hours": {
                    "type": "integer", "minimum": 0, "maximum": 720,
                    "description": (
                        "Backup alle N Stunden; 0 = aus, 24 = täglich, "
                        "168 = wöchentlich, 720 = alle 30 Tage."
                    ),
                },
                "retention_count": {
                    "type": "integer", "minimum": 1, "maximum": 100,
                    "description": "Aufbewahrte Backups (1-100); ältere werden gelöscht.",
                },
                **_RATIONALE_SCHEMA,
            },
            [*_RATIONALE_REQUIRED],
        )

_PROPOSE_BIND_IP_UPDATE = _server_function(
            "propose_bind_ip_update",
            "Andere Bind-IP, etwa statt einer Docker- oder Loopback-Adresse. "
            "Nur Adressen des Hosts aus read_server_network; ein laufender "
            "Server startet neu.",
            {
                "bind_ip": {"type": "string", "maxLength": 45},
                **_RATIONALE_SCHEMA,
            },
            ["bind_ip", *_RATIONALE_REQUIRED],
        )

_PROPOSE_CONFIG_PATCH = _server_function(
            "propose_config_patch",
            "Ersetzt **einzelne Stellen** einer Datei und laesst den Rest "
            "unberuehrt — der Weg fuer grosse Dateien, auch bei `editable: "
            "false`: je Eintrag wird `find` durch `replace` ersetzt. `find` muss "
            "**genau einmal** vorkommen — nimm die ganze Zeile oder das Element "
            "mit, sonst wird abgewiesen. `expected_revision` aus read_config. "
            "Keine Zugangsdaten.",
            {
                **_RATIONALE_SCHEMA,
                "path": {"type": "string", "maxLength": 256},
                "expected_revision": {"type": "string", "maxLength": 71},
                "edits": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_PATCH_EDITS,
                    "description": "Ersetzungen, der Reihe nach angewandt.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "find": {
                                "type": "string",
                                "maxLength": MAX_PATCH_CHUNK_CHARS,
                                "description": "Exakter Text, genau einmal vorhanden.",
                            },
                            "replace": {
                                "type": "string",
                                "maxLength": MAX_PATCH_CHUNK_CHARS,
                                "description": "Was stattdessen dastehen soll; leer loescht.",
                            },
                        },
                        "required": ["find", "replace"],
                        "additionalProperties": False,
                    },
                },
            },
            ["path", "expected_revision", "edits", *_RATIONALE_REQUIRED],
        )

_PROPOSE_CONFIG_SET = _server_function(
            "propose_config_set",
            "Setzt Schluessel in einer INI-artigen Datei — **der Normalfall "
            "fuer Spieleinstellungen**: Sektion wird gefunden oder angelegt, "
            "Schluessel ueberschrieben statt gedoppelt, Fehlendes angelegt. "
            "Dauerhaft (vor jedem Start neu geschrieben), wirkt ab dem "
            "naechsten Neustart. `expected_revision` aus read_config, `null` "
            "legt die Datei an. Keine Passwortfelder.",
            {
                **_RATIONALE_SCHEMA,
                "path": {"type": "string", "maxLength": 256},
                "expected_revision": {"type": ["string", "null"], "maxLength": 71},
                "entries": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": MAX_PATCH_EDITS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "section": {
                                "type": "string",
                                "maxLength": 128,
                                "description": "Abschnitt ohne Klammern.",
                            },
                            "key": {"type": "string", "maxLength": 128},
                            "value": {"type": "string", "maxLength": 512},
                        },
                        "required": ["section", "key", "value"],
                        "additionalProperties": False,
                    },
                },
            },
            ["path", "expected_revision", "entries", *_RATIONALE_REQUIRED],
        )

_PROPOSE_CONFIG_UPDATE = _server_function(
            "propose_config_update",
            "Ersetzt eine Datei **vollstaendig** — nur neue oder ganz gelesene "
            "(`editable: true`); sonst propose_config_patch. Keine Secrets.",
            {
                "path": {"type": "string", "maxLength": 256},
                "content": {"type": "string", "maxLength": MAX_CONFIG_CHARS},
                "expected_revision": {"type": ["string", "null"]},
                **_RATIONALE_SCHEMA,
            },
            ["path", "content", "expected_revision", *_RATIONALE_REQUIRED],
        )

_PROPOSE_DATABASE_CHANGE = _server_function(
            "propose_database_change",
            "Aendert eine PostgreSQL-Datenbank wie das Studio: genau eines von operation, rows, sql.",
            {
                "database": {"type": "string", "maxLength": 63},
                "operation": {"type": "object"},
                "rows": {"type": "object"},
                "sql": {"type": "string"},
                "rollback": {"type": "boolean"},
                **_RATIONALE_SCHEMA,
            },
            list(_RATIONALE_REQUIRED),
        )

_PROPOSE_FILE_DELETE = _server_function(
            "propose_file_delete",
            "Loescht **genau eine** Datei — fuer haengende Sperrdateien "
            "(`session.lock`, `*.pid`) oder nachweislich kaputte Einzeldateien; "
            "vorher entsteht ein Versionsschnappschuss. Im autonomen "
            "Guardian-Betrieb nur mit erfolgreichem Backup, juenger als der "
            "Vorfall — fehlt es, leg erst eines an. Kein Verzeichnis, keine Platzhalter: ein Pfad, den du "
            "gesehen hast.",
            {
                "path": {"type": "string", "maxLength": 256},
                **_RATIONALE_SCHEMA,
            },
            ["path", *_RATIONALE_REQUIRED],
        )

_PROPOSE_GUARDIAN_TUNING = _server_function(
            "propose_guardian_tuning",
            "Stellt Guardian **nur fuer diesen Server** anders ein — wenn der "
            "Server nicht kaputt ist, sondern Guardian falsch erwartet (etwa "
            "laengerer Start auf voller Node). Nur zu aendernde Werte angeben; "
            "`reset: true` nimmt alles zurueck. Aendert keine Datei.",
            {
                "startup_grace_period_seconds": {
                    "type": "integer", "minimum": 1, "maximum": 600,
                    "description": "Ruhe nach dem Start, bevor Proben zaehlen.",
                },
                "startup_timeout_seconds": {
                    "type": "integer", "minimum": 10, "maximum": 3600,
                    "description": (
                        "Ab wann ein Start als gescheitert gilt. "
                        "Muss ueber der Ruhezeit liegen."
                    ),
                },
                "probe_interval_seconds": {
                    "type": "integer", "minimum": 1, "maximum": 600,
                    "description": "Abstand zwischen zwei Proben (alle Proben).",
                },
                "probe_timeout_seconds": {
                    "type": "integer", "minimum": 1, "maximum": 30,
                    "description": "Geduld einer Netzprobe.",
                },
                "probe_failure_threshold": {
                    "type": "integer", "minimum": 1, "maximum": 20,
                    "description": "Fehlschlaege in Folge bis zum Vorfall.",
                },
                "probe_success_threshold": {
                    "type": "integer", "minimum": 1, "maximum": 20,
                    "description": "Erfolge in Folge bis 'gesund'.",
                },
                "recovery_max_attempts": {
                    "type": "integer", "minimum": 0, "maximum": 10,
                    "description": (
                        "Wieviele Selbstheilungsversuche Guardian unternimmt. "
                        "0 heisst: gar keine mehr, nur noch melden."
                    ),
                },
                "recovery_attempt_window_seconds": {
                    "type": "integer", "minimum": 60, "maximum": 86400,
                    "description": "Zeitfenster, in dem die Versuche gezaehlt werden.",
                },
                "recovery_cooldown_seconds": {
                    "type": "integer", "minimum": 1, "maximum": 3600,
                    "description": "Pause zwischen zwei Versuchen.",
                },
                "verification_min_healthy_seconds": {
                    "type": "integer", "minimum": 0, "maximum": 600,
                    "description": "Wie lange gesund, damit es als geheilt gilt.",
                },
                "verification_required_successes": {
                    "type": "integer", "minimum": 1, "maximum": 20,
                    "description": "Erfolge in Folge fuer die Bestaetigung.",
                },
                "verification_timeout_seconds": {
                    "type": "integer", "minimum": 10, "maximum": 3600,
                    "description": "Ab wann die Bestaetigung als gescheitert gilt.",
                },
                "reset": {
                    "type": "boolean",
                    "description": (
                        "Alle Uebersteuerungen zuruecknehmen. Schliesst jede "
                        "andere Angabe aus."
                    ),
                },
                **_RATIONALE_SCHEMA,
            },
            [*_RATIONALE_REQUIRED],
        )

_PROPOSE_MOD_INSTALL = _server_function(
            "propose_mod_install",
            "Schlaegt Installation, Aktualisierung oder Neuinstallation einer Workshop- oder CurseForge-Mod vor. "
            "Der Download laeuft ueber den vorhandenen MSM-Installationspfad.",
            {
                "workshop_id": {"type": "string", "maxLength": 20, "description": "Aus search_curseforge_mods oder search_workshop_mods."},
                "mod_id": {"type": "string", "maxLength": 20, "description": "Alias fuer workshop_id."},
                "action": {"type": "string", "enum": ["install", "update", "reinstall"]},
                "name": {"type": "string", "maxLength": 256},
                **_RATIONALE_SCHEMA,
            },
            ["workshop_id", "action", *_RATIONALE_REQUIRED],
        )

_PROPOSE_MOD_TOGGLE = _server_function(
            "propose_mod_toggle",
            "Schaltet eine installierte Mod an oder aus (Mod-Liste des Panels, "
            "nie Spielkonfiguration). Wirkt ab dem naechsten Start.",
            {
                "workshop_id": {"type": "string", "maxLength": 20},
                "enabled": {"type": "boolean"},
                **_RATIONALE_SCHEMA,
            },
            ["workshop_id", "enabled", *_RATIONALE_REQUIRED],
        )

_PROPOSE_MODPACK_INSTALL = _function(
            "propose_modpack_install",
            "Installiert ein CurseForge-Modpack auf einem bestehenden Server.",
            {
                **_SERVER_ID_SCHEMA,
                "modpack_mod_id": {"type": "string", "maxLength": 32, "description": "Aus search_curseforge_modpacks."},
                "file_id": {"type": "string", "maxLength": 32, "description": "Version; leer = neueste."},
                **_RATIONALE_SCHEMA,
            },
            ["server_id", "modpack_mod_id", *_RATIONALE_REQUIRED],
        )

_PROPOSE_RESTART_SCHEDULE_SET = _server_function(
            "propose_restart_schedule_set",
            "Setzt den eingebauten Auto-Neustart-Zeitplan dieses Servers. "
            "Entweder `interval_hours` oder `times`, nie beides; "
            "`enabled: false` schaltet aus und braucht keinen Plan. "
            "`times` sind UTC und gelten täglich — rechne die Ortszeit des "
            "Benutzers um und nenne ihm beide Werte.",
            {
                "enabled": {"type": "boolean"},
                "interval_hours": {
                    "type": "integer", "minimum": 1, "maximum": 168,
                    "description": "Neustart alle N Stunden (1-168).",
                },
                "times": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 12,
                    "items": {"type": "string", "maxLength": 5},
                    "description": "Bis zu 12 Neustartzeiten 'HH:MM' in UTC, gelten täglich.",
                },
                **_RATIONALE_SCHEMA,
            },
            ["enabled", *_RATIONALE_REQUIRED],
        )

_PROPOSE_SERVER_BLUEPRINT_SWITCH = _server_function(
            "propose_server_blueprint_switch",
            # Der Satz "die Portrollen beider Blueprints muessen
            # uebereinstimmen" stand hier und ist ersatzlos gestrichen: er war
            # erfunden. `switch_server_blueprint` vergibt die Ports ohnehin neu
            # und prueft nichts dergleichen — dokumentiert in
            # `ai_proposal_service` bei den erfundenen Einschraenkungen. Eine
            # Bedingung, die es nicht gibt, haelt das Modell von Wechseln ab,
            # die durchgegangen waeren.
            "Stellt einen **gestoppten** Server auf einen anderen Blueprint um "
            "— so aendert man die Version (vorher mit propose_blueprint_change "
            "ableiten). Legt ein Backup an und **loescht danach alle "
            "Serverdateien**: Welt, Configs, Mods; sag das im Grund. Ist nur "
            "Guardian falsch eingestellt: "
            "propose_guardian_tuning.",
            {
                **_RATIONALE_SCHEMA,
                "blueprint_id": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Ziel-Blueprint aus list_blueprints.",
                },
            },
            ["blueprint_id", *_RATIONALE_REQUIRED],
        )

_PROPOSE_SERVER_DELETE = _server_function(
            "propose_server_delete",
            "Schlaegt vor, einen Server vollstaendig zu loeschen: Container, "
            "Dateien, Backups und Ports. Das ist nicht rueckgaengig zu machen "
            "und verlangt immer eine Bestaetigung durch den Benutzer, auch im "
            "autonomen Modus. Nenne im Grund, was verlorengeht.",
            dict(_RATIONALE_SCHEMA),
            list(_RATIONALE_REQUIRED),
        )

_PROPOSE_SERVER_LIFECYCLE = _server_function(
            "propose_server_lifecycle",
            "Schlaegt Start, Stop oder Neustart zur manuellen Bestaetigung vor (wird im autonomen Modus direkt ausgefuehrt).",
            {
                "operation": {
                    "type": "string",
                    "enum": ["start", "stop", "restart"],
                    "description": "Lebenszyklus-Aktion: start, stop oder restart.",
                },
                "action": {
                    "type": ["string", "null"],
                    "description": "Alias fuer operation: start, stop oder restart.",
                },
                **_RATIONALE_SCHEMA,
            },
            ["operation", *_RATIONALE_REQUIRED],
        )

_PROPOSE_SERVER_REPAIR = _server_function(
            "propose_server_repair",
            "Repariert die Anlage, nicht die Dateien. `repair_permissions`: "
            "Besitzrechte am Serververzeichnis ('permission denied', 'read-only "
            "file system'). `reallocate_port`: belegte Ports neu vergeben "
            "('address already in use'), nur bei **gestopptem** Server. Aendert "
            "keine Spielstaende. Fuer 'haengt' oder 'startet nicht': "
            "propose_server_lifecycle mit `restart`.",
            {
                "action": {
                    "type": "string",
                    "enum": ["repair_permissions", "reallocate_port"],
                },
                **_RATIONALE_SCHEMA,
            },
            ["action", *_RATIONALE_REQUIRED],
        )

MODPACK_DEFINITIONEN = [_PROPOSE_MODPACK_INSTALL]
SERVER_WRITE_DEFINITIONEN = [
    _PROPOSE_SERVER_LIFECYCLE,
    _PROPOSE_BACKUP,
    _PROPOSE_BACKUP_RESTORE,
    _PROPOSE_SERVER_BLUEPRINT_SWITCH,
    _PROPOSE_SERVER_DELETE,
    _PROPOSE_CONFIG_UPDATE,
    _PROPOSE_CONFIG_PATCH,
    _PROPOSE_CONFIG_SET,
    _PROPOSE_BIND_IP_UPDATE,
    _PROPOSE_MOD_INSTALL,
    _PROPOSE_MOD_TOGGLE,
    _PROPOSE_SERVER_REPAIR,
    _PROPOSE_GUARDIAN_TUNING,
    _PROPOSE_RESTART_SCHEDULE_SET,
    _PROPOSE_BACKUP_SCHEDULE_SET,
    _PROPOSE_FILE_DELETE,
    _PROPOSE_DATABASE_CHANGE,
]

DEFINITIONEN = [_PROPOSE_BACKUP, _PROPOSE_BACKUP_RESTORE, _PROPOSE_BACKUP_SCHEDULE_SET, _PROPOSE_BIND_IP_UPDATE, _PROPOSE_CONFIG_PATCH, _PROPOSE_CONFIG_SET, _PROPOSE_CONFIG_UPDATE, _PROPOSE_DATABASE_CHANGE, _PROPOSE_FILE_DELETE, _PROPOSE_GUARDIAN_TUNING, _PROPOSE_MOD_INSTALL, _PROPOSE_MOD_TOGGLE, _PROPOSE_MODPACK_INSTALL, _PROPOSE_RESTART_SCHEDULE_SET, _PROPOSE_SERVER_BLUEPRINT_SWITCH, _PROPOSE_SERVER_DELETE, _PROPOSE_SERVER_LIFECYCLE, _PROPOSE_SERVER_REPAIR]

werkzeug(
    _PROPOSE_BACKUP,
    art="server_write",
    recht="server.backups.create",
    hinweis="Legt ein Backup des Servers an.",
    vorschlag=vorschlag_server("propose_backup"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_backup"),
)

werkzeug(
    _PROPOSE_BACKUP_RESTORE,
    art="server_write",
    recht="server.backups.restore", immer_bestaetigen=True,
    hinweis="Spielt ein Backup nach Bestaetigung ein.",
    vorschlag=vorschlag_server("propose_backup_restore"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_backup_restore"),
)

werkzeug(
    _PROPOSE_BACKUP_SCHEDULE_SET,
    art="server_write",
    recht="server.config.write",
    hinweis="Richtet den Backup-Zeitplan ein.",
    vorschlag=vorschlag_server("propose_backup_schedule_set"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_backup_schedule_set"),
)

werkzeug(
    _PROPOSE_BIND_IP_UPDATE,
    art="server_write",
    recht="server.network.manage",
    hinweis="Aendert die Bind-IP des Servers.",
    vorschlag=vorschlag_server("propose_bind_ip_update"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_bind_ip_update"),
)

werkzeug(
    _PROPOSE_CONFIG_PATCH,
    art="server_write",
    recht="server.files.write",
    hinweis="Ersetzt eine Stelle in einer Serverdatei.",
    vorschlag=vorschlag_server("propose_config_patch"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_config_patch"),
)

werkzeug(
    _PROPOSE_CONFIG_SET,
    art="server_write",
    recht="server.files.write",
    hinweis="Setzt einen Wert in einer Serverdatei.",
    vorschlag=vorschlag_server("propose_config_set"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_config_set"),
)

werkzeug(
    _PROPOSE_CONFIG_UPDATE,
    art="server_write",
    recht="server.files.write",
    hinweis="Aendert eine Konfigurationsdatei.",
    vorschlag=vorschlag_server("propose_config_update"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_config_update"),
)

werkzeug(
    _PROPOSE_DATABASE_CHANGE,
    art="server_write",
    recht="server.databases.write",
    hinweis="Aendert eine Datenbank des Servers.",
    vorschlag=vorschlag_server("propose_database_change"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_database_change"),
)

werkzeug(
    _PROPOSE_FILE_DELETE,
    art="server_write",
    recht="server.files.delete", immer_bestaetigen=True,
    hinweis="Loescht eine Serverdatei nach Bestaetigung.",
    vorschlag=vorschlag_server("propose_file_delete"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_file_delete"),
)

werkzeug(
    _PROPOSE_GUARDIAN_TUNING,
    art="server_write",
    recht="server.config.write",
    hinweis="Stellt die Schwellen des Autopiloten ein.",
    vorschlag=vorschlag_server("propose_guardian_tuning"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_guardian_tuning"),
)

werkzeug(
    _PROPOSE_MOD_INSTALL,
    art="server_write",
    recht="server.mods.write",
    hinweis="Installiert eine Mod auf dem Server.",
    vorschlag=vorschlag_server("propose_mod_install"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_mod_install"),
)

werkzeug(
    _PROPOSE_MOD_TOGGLE,
    art="server_write",
    recht="server.mods.toggle",
    hinweis="Schaltet eine installierte Mod an oder aus.",
    vorschlag=vorschlag_server("propose_mod_toggle"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_mod_toggle"),
)

werkzeug(
    _PROPOSE_MODPACK_INSTALL,
    art="server_write",
    recht="server.mods.write", gruppe="mods",
    hinweis="Installiert ein Modpack auf dem Server.",
    vorschlag=vorschlag_server("propose_modpack_install"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_modpack_install"),
)

werkzeug(
    _PROPOSE_RESTART_SCHEDULE_SET,
    art="server_write",
    recht="server.config.write",
    hinweis="Richtet den Neustart-Zeitplan ein.",
    vorschlag=vorschlag_server("propose_restart_schedule_set"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_restart_schedule_set"),
)

werkzeug(
    _PROPOSE_SERVER_BLUEPRINT_SWITCH,
    art="server_write",
    recht="server.config.write",
    hinweis="Wechselt den Blueprint des Servers.",
    vorschlag=vorschlag_server("propose_server_blueprint_switch"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_server_blueprint_switch"),
)

werkzeug(
    _PROPOSE_SERVER_DELETE,
    art="server_write",
    recht="servers.delete", recht_global=True, immer_bestaetigen=True,
    hinweis="Loescht den Server nach Bestaetigung.",
    vorschlag=vorschlag_server("propose_server_delete"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_server_delete"),
)

werkzeug(
    _PROPOSE_SERVER_LIFECYCLE,
    art="server_write",
    angebot=("server.start", "server.stop", "server.restart"),
    hinweis="Startet, stoppt oder startet den Server neu.",
    vorschlag=vorschlag_server("propose_server_lifecycle"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_server_lifecycle"),
)

werkzeug(
    _PROPOSE_SERVER_REPAIR,
    art="server_write",
    angebot=("server.files.write", "server.network.manage"),
    hinweis="Repariert Rechte oder Ports des Servers.",
    vorschlag=vorschlag_server("propose_server_repair"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_server_repair"),
)
