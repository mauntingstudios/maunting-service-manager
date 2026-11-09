"""Globale Schreibfaehigkeiten ohne Serverbezug.

Die Schemas standen im Katalog in `server_tools`, die Bauer in
`ai_proposals/lifecycle._GLOBALE_PAYLOADS`. Die Specs verweisen ueber den
Roh-Snapshot auf genau diese Bauer; die Tabellen bleiben die Umsetzung.
"""

from __future__ import annotations

from services.ai_tool_spec import ausfuehrung_aus_tabelle, vorschlag_aus_tabelle, werkzeug
from services.ai_tools.base import _RATIONALE_REQUIRED, _RATIONALE_SCHEMA, _function

_PROPOSE_BLUEPRINT_CHANGE = _function(
            "propose_blueprint_change",
            "Leitet aus einem Blueprint einen neuen ab, ohne die Vorlage "
            "anzufassen — so aendert man Spielversion oder Startparameter. "
            "Aenderbar: meta.name, meta.description, runtime.image, runtime.env "
            "(wird gemischt) und runtime.startup. Fuehrt die Quelle "
            "runtime.startupProfiles, wird eine Aenderung an runtime.startup "
            "abgewiesen.",
            {
                **_RATIONALE_SCHEMA,
                "source_id": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Vorlage aus list_blueprints, auch eine native.",
                },
                "new_id": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Neue ID, nur a-z, 0-9 und _.",
                },
                "changes": {
                    "type": "object",
                    "description": (
                        'Punktpfade auf Werte, z. B. {"runtime.env": '
                        '{"VERSION": "1.20.1"}}.'
                    ),
                },
            },
            ["source_id", "new_id", "changes", *_RATIONALE_REQUIRED],
        )

_PROPOSE_BLUEPRINT_DELETE = _function(
            "propose_blueprint_delete",
            "Loescht einen selbst erstellten oder abgeleiteten Community-Blueprint. "
            "Native Blueprints koennen nicht geloescht werden.",
            {
                "blueprint_id": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "ID des zu loeschenden Community-Blueprints.",
                },
                **_RATIONALE_SCHEMA,
            },
            ["blueprint_id", *_RATIONALE_REQUIRED],
        )

_PROPOSE_SERVER_CREATE = _function(
            "propose_server_create",
            "Schlaegt einen neuen Server zur Bestaetigung vor; Ports und Verzeichnis vergibt MSM. "
            "server_kind 'database' legt eine eigene PostgreSQL-Instanz an (ohne game_type). "
            "modpack_mod_id wird danach automatisch installiert.",
            {
                "name": {"type": "string", "maxLength": 128},
                "server_kind": {"type": "string", "enum": ["application", "database"]},
                "game_type": {"type": "string", "maxLength": 64, "description": "Blueprint-ID, z. B. 'valheim'."},
                "ram_limit_mb": {"type": "integer", "minimum": 512, "maximum": 4_194_304},
                "cpu_limit_percent": {"type": "integer", "minimum": 10, "maximum": 3_200, "description": "100 = 1 Kern."},
                "disk_limit_gb": {"type": "integer", "minimum": 1, "maximum": 1_048_576},
                "node_id": {"type": ["integer", "null"]},
                "public_bind_ip": {"type": ["string", "null"], "maxLength": 64},
                "postgres_database_count": {
                    "type": ["integer", "null"], "minimum": 1, "maximum": 20,
                    "description": "Anwendung: Datenbanken im gemeinsamen Cluster.",
                },
                "database": {
                    "type": ["object", "null"],
                    "description": "Datenbankserver. Das Passwort erzeugt das Panel.",
                    "properties": {
                        "database_name": {"type": "string", "maxLength": 63},
                        "username": {"type": "string", "maxLength": 59},
                        "allowed_cidrs": {"type": "array", "items": {"type": "string"}, "description": "Leer: nur intern."},
                        "ssl_required": {"type": "boolean"},
                        "port": {"type": ["integer", "null"], "minimum": 1024, "maximum": 65535},
                    },
                },
                "modpack_mod_id": {"type": ["string", "null"], "maxLength": 32, "description": "CurseForge-Modpack-ID."},
                "modpack_name": {"type": ["string", "null"], "maxLength": 128},
                "modpack_file_id": {"type": ["string", "null"], "maxLength": 32},
                **_RATIONALE_SCHEMA,
            },
            [
                "name",
                "ram_limit_mb",
                "cpu_limit_percent",
                "disk_limit_gb",
                *_RATIONALE_REQUIRED,
            ],
        )

_PROPOSE_AI_TARIF_ROLE = _function(
            "propose_ai_tarif_role",
            "Legt eine globale Rolle fuer einen Shop-Tarif an: **leere "
            "Rechteliste**, nur KI-Kontingent (Kontingente haengen an globalen "
            "Rollen). Rechte gehoeren in die Rollenverwaltung. Ein "
            "Kontingentfeld `null` heisst **unbegrenzt**. Setz nur, was der "
            "Benutzer genannt hat, und frag im Zweifel nach.",
            {
                "name": {"type": "string", "maxLength": 64},
                "description": {"type": ["string", "null"], "maxLength": 255},
                "daily_token_limit": {"type": ["integer", "null"], "minimum": 0, "description": "Je rollende 24 Stunden."},
                "weekly_token_limit": {"type": ["integer", "null"], "minimum": 0, "description": "Je rollende 7 Tage."},
                "monthly_token_limit": {"type": ["integer", "null"], "minimum": 0, "description": "Je rollende 30 Tage."},
                "monthly_realtime_minutes_limit": {"type": ["integer", "null"], "minimum": 0, "description": "Sprachminuten je 30 Tage."},
                "monthly_dictation_minutes_limit": {"type": ["integer", "null"], "minimum": 0, "description": "Diktierminuten je 30 Tage."},
                "max_reasoning_effort": {"type": ["integer", "null"], "minimum": 0},
                "max_memory_entries": {
                    "type": ["integer", "null"],
                    "minimum": 0,
                    "description": (
                        "Je Bereich; `null` unbegrenzt, 0 sperrt. Unter mehreren "
                        "Rollen gewinnt der hoechste Wert."
                    ),
                },
                **_RATIONALE_SCHEMA,
            },
            ["name", *_RATIONALE_REQUIRED],
        )

_PROPOSE_HOSTER_INTEGRATION = _function(
            "propose_hoster_integration",
            "Legt eine Hoster-Integration (panelseitige Shop-Anbindung) an oder "
            "aendert sie; mit `webhook_url` und ohne Secret wird eines erzeugt. "
            "**Vorher `read_hoster_setup`**: Slug panelweit eindeutig, "
            "Dienstbenutzer aktiv, kein Owner, mit `servers.create`. Der API-Key "
            "entsteht erst beim Ausfuehren und wird dem Benutzer **einmalig** "
            "gezeigt — du siehst ihn nie; sag ihm das vor der Bestaetigung.",
            {
                "integration_id": {
                    "type": ["integer", "null"],
                    "minimum": 1,
                    "description": "Zum Aendern. Weglassen legt neu an.",
                },
                "name": {"type": "string", "maxLength": 128},
                "slug": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Kleinbuchstaben, Ziffern, Bindestriche. Panelweit eindeutig.",
                },
                "service_user_id": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Aus service_user_candidates in read_hoster_setup.",
                },
                "webhook_url": {"type": ["string", "null"], "maxLength": 2048},
                "terminate_grace_days": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 365,
                    "description": "Tage bis zur Loeschbarkeit nach Kuendigung; 0 = sofort.",
                },
                "enabled": {"type": "boolean"},
                **_RATIONALE_SCHEMA,
            },
            [
                "name",
                "slug",
                "service_user_id",
                "terminate_grace_days",
                *_RATIONALE_REQUIRED,
            ],
        )

_PROPOSE_HOSTER_PRODUCT = _function(
            "propose_hoster_product",
            "Ordnet eine Produktkennung des Shops (**exakt** wie im Shop) einem "
            "Blueprint und Ressourcenpaket zu. **Vorher `read_hoster_setup`**; "
            "eine Rolle, die dort nicht als vergebbar steht, wird abgewiesen. "
            "`role_id` traegt der Kunde, solange sein Vertrag laeuft (sein "
            "KI-Kontingent; leer = keine Zusatzrolle). Leere Grenzen = "
            "Voreinstellung des Blueprints. Gilt "
            "fuer neu erstellte Server.",
            {
                "integration_id": {"type": "integer", "minimum": 1},
                "external_product_key": {"type": "string", "maxLength": 128},
                "game_type": {
                    "type": "string",
                    "maxLength": 64,
                    "description": "Blueprint aus list_blueprints.",
                },
                "ram_limit_mb": {"type": ["integer", "null"], "minimum": 1},
                "cpu_limit_percent": {"type": ["integer", "null"], "minimum": 1},
                "disk_limit_gb": {"type": ["integer", "null"], "minimum": 1},
                "node_id": {"type": ["integer", "null"], "minimum": 1},
                "backup_interval_hours": {"type": ["integer", "null"], "minimum": 1},
                "role_id": {
                    "type": ["integer", "null"],
                    "minimum": 1,
                    "description": "Aus grantable_roles in read_hoster_setup.",
                },
                "enabled": {"type": "boolean"},
                **_RATIONALE_SCHEMA,
            },
            [
                "integration_id",
                "external_product_key",
                "game_type",
                *_RATIONALE_REQUIRED,
            ],
        )

_PROPOSE_CLOUDFLARE_DNS_RECORD = _function(
            "propose_cloudflare_dns_record",
            "Legt einen Cloudflare-DNS-Record (Subdomain) an, jeder Typ. zone_id vorher aus cloudflare_list_zones. Name als voller Hostname, etwa {game}-{slug}.{zone} oder _minecraft._tcp.{subdomain}.{zone}.",
            {
                "zone_id": {"type": "string", "maxLength": 64, "description": "Zonen-ID oder -Name."},
                "name": {"type": "string", "maxLength": 253},
                "rtype": {
                    "type": "string",
                    "enum": [
                        "A",
                        "AAAA",
                        "CNAME",
                        "TXT",
                        "SRV",
                        "MX",
                        "NS",
                        "PTR",
                        "CAA",
                        "HTTPS",
                        "SVCB",
                        "DNSKEY",
                        "DS",
                        "NAPTR",
                        "SMIMEA",
                        "SSHFP",
                        "TLSA",
                        "URI",
                        "LOC",
                        "CERT",
                    ],
                },
                "content": {"type": "string", "maxLength": 253, "description": "IP, Ziel oder Inhalt (SRV: '0 5 25566 mc.example.com')."},
                "proxied": {"type": "boolean", "description": "Nur A, AAAA, CNAME."},
                "priority": {"type": "integer", "description": "MX/SRV."},
                "ttl": {"type": "integer", "description": "Sekunden, 1 = automatisch."},
                "data": {"type": "object", "description": "Strukturiert (SRV, CAA, HTTPS)."},
                **_RATIONALE_SCHEMA,
            },
            ["zone_id", "name", "rtype", *_RATIONALE_REQUIRED],
        )

_PROPOSE_CLOUDFLARE_DNS_DELETE = _function(
            "propose_cloudflare_dns_delete",
            "Loescht einen Cloudflare-DNS-Record per record_id oder Hostname.",
            {
                "record_id": {"type": "string", "maxLength": 253, "description": "Hex-ID oder Hostname."},
                "zone_id": {"type": "string", "maxLength": 64},
                **_RATIONALE_SCHEMA,
            },
            ["record_id", *_RATIONALE_REQUIRED],
        )

DEFINITIONEN = [_PROPOSE_BLUEPRINT_CHANGE, _PROPOSE_BLUEPRINT_DELETE, _PROPOSE_SERVER_CREATE, _PROPOSE_AI_TARIF_ROLE, _PROPOSE_HOSTER_INTEGRATION, _PROPOSE_HOSTER_PRODUCT, _PROPOSE_CLOUDFLARE_DNS_RECORD, _PROPOSE_CLOUDFLARE_DNS_DELETE]

werkzeug(
    _PROPOSE_BLUEPRINT_CHANGE,
    art="global_write", recht="blueprints.manage", recht_global=True,
    hinweis="Leitet aus einem Blueprint eine neue Vorlage ab.",
    vorschlag=vorschlag_aus_tabelle("propose_blueprint_change"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_blueprint_change"),
)
werkzeug(
    _PROPOSE_BLUEPRINT_DELETE,
    art="global_write", recht="blueprints.manage", recht_global=True, immer_bestaetigen=True,
    hinweis="Loescht einen Blueprint nach Bestaetigung.",
    vorschlag=vorschlag_aus_tabelle("propose_blueprint_delete"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_blueprint_delete"),
)
werkzeug(
    _PROPOSE_SERVER_CREATE,
    art="global_write", recht="servers.create", recht_global=True,
    hinweis="Legt einen neuen Server nach Bestaetigung an.",
    vorschlag=vorschlag_aus_tabelle("propose_server_create"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_server_create"),
)
werkzeug(
    _PROPOSE_AI_TARIF_ROLE,
    art="global_write", recht="roles.manage", recht_global=True, immer_bestaetigen=True,
    hinweis="Setzt die Tarif-Rolle eines Benutzers.",
    vorschlag=vorschlag_aus_tabelle("propose_ai_tarif_role"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_ai_tarif_role"),
)
werkzeug(
    _PROPOSE_HOSTER_INTEGRATION,
    art="global_write", recht="panel.hoster.write", recht_global=True, immer_bestaetigen=True,
    hinweis="Legt eine Hoster-Integration als Vorschlag an.",
    vorschlag=vorschlag_aus_tabelle("propose_hoster_integration"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_hoster_integration"),
)
werkzeug(
    _PROPOSE_HOSTER_PRODUCT,
    art="global_write", recht="panel.hoster.write", recht_global=True, immer_bestaetigen=True,
    hinweis="Verknuepft ein Hosting-Produkt.",
    vorschlag=vorschlag_aus_tabelle("propose_hoster_product"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_hoster_product"),
)
werkzeug(
    _PROPOSE_CLOUDFLARE_DNS_RECORD,
    art="global_write", gruppe="domains", recht="cloudflare.manage", recht_global=True,
    hinweis="Legt einen DNS-Eintrag als Vorschlag an.",
    vorschlag=vorschlag_aus_tabelle("propose_cloudflare_dns_record"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_cloudflare_dns_record"),
)
werkzeug(
    _PROPOSE_CLOUDFLARE_DNS_DELETE,
    art="global_write", gruppe="domains", recht="cloudflare.manage", recht_global=True,
    hinweis="Loescht einen DNS-Eintrag nach Bestaetigung.",
    vorschlag=vorschlag_aus_tabelle("propose_cloudflare_dns_delete"),
    ausfuehren=ausfuehrung_aus_tabelle("propose_cloudflare_dns_delete"),
)
