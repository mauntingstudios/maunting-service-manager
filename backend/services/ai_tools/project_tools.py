"""KI-Projekte: anlegen und im Arbeitsbereich arbeiten.

Der Handler stand als 320-Zeilen-Zweig in `_execute_global_read_tool` und
verteilt selbst auf die Aktionen. Die Schemas standen im Katalog derselben
Datei. Beide gehoeren zum Projektfach.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import User
from services.ai_tool_spec import werkzeug
from services.ai_tools.base import _function

_WORKSPACE = _function(
        "project_workspace",
        "Arbeitet in KI-Projekten (Dateien, Coding, Vorschau, Tests, Dev-Sandbox, DB, Deploy & Git).",
        {
            "action": {
                "type": "string",
                "enum": [
                    "list_projects",
                    "create_project",
                    "list_files",
                    "read_file",
                    "write_file",
                    "patch_file",
                    "delete_file",
                    "configure_preview",
                    "preview_inspect",
                    "test_project",
                    "run_command",
                    "get_environment",
                    "publish_production",
                    "search_components",
                    "run_sql",
                    "db_status",
                    "db_tables",
                    "db_rows",
                    "apply_migrations",
                    "git_status",
                    "git_sync",
                    "git_commit",
                    "dev_start",
                    "dev_stop",
                    "dev_status",
                    "git_branch",
                    "git_open_pr",
                    "merge_to_main",
                ],
            },
            "project_id": {"type": "string", "description": "Projekt-ID (UUID)."},
            "name": {"type": "string", "maxLength": 160},
            "description": {"type": "string", "maxLength": 500},
            "project_kind": {"type": "string", "enum": ["coding", "docs", "general"]},
            "path": {"type": "string", "maxLength": 240},
            "entry_file": {"type": "string", "maxLength": 240, "description": "Vorschau-Einstieg (index.html, src/App.tsx)."},
            "framework": {"type": "string", "maxLength": 64, "description": "html, react, fullstack."},
            "viewports": {
                "type": "array",
                "items": {"type": "string", "enum": ["mobile", "tablet", "desktop"]},
            },
            "interactions": {
                "type": "array",
            },
            "content": {"type": "string", "maxLength": 200000},
            "find": {"type": "string", "maxLength": 50000, "description": "Exakter zu ersetzender Codeblock (patch_file)."},
            "replace": {"type": "string", "maxLength": 50000, "description": "Neuer Codeblock (patch_file)."},
            "edits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "find": {"type": "string", "maxLength": 50000},
                        "replace": {"type": "string", "maxLength": 50000},
                    },
                    "required": ["find", "replace"],
                },
            },
            "command": {"type": "string", "maxLength": 2000},
            "query": {"type": "string", "maxLength": 160},
            "node_id": {"type": "string", "maxLength": 64},
            "release_notes": {"type": "string", "maxLength": 500},
            "mode": {"type": "string", "enum": ["auto", "frontend", "backend", "fullstack_split"]},
            "domain": {"type": "string", "maxLength": 160},
            "enable_database": {"type": "boolean"},
            "backend_proxy_url": {"type": "string", "maxLength": 240},
            "api_path": {"type": "string", "maxLength": 120},
            "bind_ip": {"type": "string", "maxLength": 64},
            "merge_to_main": {"type": "boolean"},
            "sql": {"type": "string", "maxLength": 100000},
            "environment": {"type": "string", "enum": ["dev", "prod"]},
            "write": {"type": "boolean"},
            "table": {"type": "string", "maxLength": 120},
            "limit": {"type": "integer", "minimum": 1, "maximum": 1000},
            "repo_url": {"type": "string", "maxLength": 1024},
            "branch": {"type": "string", "maxLength": 120},
            "message": {"type": "string", "maxLength": 500},
            "push": {"type": "boolean"},
            "title": {"type": "string", "maxLength": 200, "description": "PR-Titel für git_open_pr."},
            "body": {"type": "string", "maxLength": 4000, "description": "PR-Beschreibung für git_open_pr."},
            "target_branch": {"type": "string", "maxLength": 120, "description": "Zielbranch (Standard: main)."},
        },
        ["action"],
    )
_CREATE = _function(
        "project_create",
        "Erstellt autonom ein neues KI-Projekt fuer Code, allgemeine Aufgaben oder ein Git-Repo und verknuepft die Unterhaltung.",
        {
            "name": {"type": "string", "maxLength": 160},
            "description": {"type": "string", "maxLength": 500},
            "git_repo_url": {"type": "string", "maxLength": 1024},
            "git_branch": {"type": "string", "maxLength": 120},
            "system_instructions": {
                "type": "string",
                "maxLength": 4000,
                "description": "Fundierte Systemanweisung nach etabliertem Prompt Engineering (Projektziel, KISS-Prinzip, zwingende Ordnerstruktur, Code-Qualität, wahrhaftige Kommentare, Doku). Wird bei Leerlassen automatisch erzeugt.",
            },
            "sandbox_mode": {"type": "string", "enum": ["server", "local", "none"]},
        },
        ["name"],
    )

DEFINITIONEN = [_WORKSPACE, _CREATE]


def projekt_werkzeug(
    db: Session,
    *,
    user: User,
    arguments: dict,
    lauf: dict | None = None,
    tool_name: str = "project_workspace",
) -> dict:
    kontext = (lauf or {}).get("kontext")
    from services import ai_project_service
    from services.ai_project_service import AiProjectError

    action = str(arguments.get("action") or "").strip()
    if tool_name == "project_create":
        action = "create_project"
    proj_id_raw = arguments.get("project_id")
    try:
        if action == "list_projects":
            rows = ai_project_service.list_projects(db, user)
            return {
                "projects": [
                    {
                        "id": r.id,
                        "name": r.name,
                        "description": r.description,
                        "sandbox_mode": r.sandbox_mode,
                        "git_repo_url": r.git_repo_url,
                        "git_branch": r.git_branch,
                    }
                    for r in rows
                ]
            }
        if action == "create_project":
            if not permission_service.has_global_permission(db, user, "ai.projects.manage"):
                raise AiActionValidationError("Projektverwaltung ist für diesen Benutzer nicht freigegeben (ai.projects.manage)")
            name = str(arguments.get("name") or "Neues Projekt").strip()
            description = str(arguments.get("description") or "").strip() or None
            repo_url = str(arguments.get("repo_url") or arguments.get("git_repo_url") or "").strip() or None
            branch = str(arguments.get("branch") or arguments.get("git_branch") or "main").strip() or "main"
            system_prompt = str(arguments.get("system_instructions") or arguments.get("system_prompt") or "").strip() or None
            sandbox_mode = str(arguments.get("sandbox_mode") or "server")
            project_kind = str(arguments.get("project_kind") or "coding").strip().lower()
            if project_kind not in ("coding", "docs", "general"):
                project_kind = "coding"
            local_path = str(arguments.get("local_path") or "").strip() or None

            p = ai_project_service.create_project(
                db,
                user,
                name=name,
                description=description,
                system_prompt=system_prompt,
                project_kind=project_kind,
                sandbox_mode=sandbox_mode,
                local_path=local_path,
                git_repo_url=repo_url,
                git_branch=branch,
            )
            if repo_url:
                try:
                    ai_project_service.git_clone_or_pull(db, user, p.id, repo_url=repo_url, branch=branch)
                except Exception:
                    pass

            conv_id = (
                getattr(kontext, "conversation_id", None)
                if kontext is not None
                else None
            ) or (
                kontext.get("conversation_id")
                if isinstance(kontext, dict)
                else None
            )
            if conv_id:
                from models.ai_conversation import AiConversation
                conv = db.get(AiConversation, str(conv_id))
                if conv is not None and not conv.project_id:
                    conv.project_id = p.id
                    db.commit()

            return {
                "project_id": p.id,
                "name": p.name,
                "description": p.description,
                "project_kind": p.project_kind,
                "workspace": p.sandbox_path,
                "git_repo_url": p.git_repo_url,
                "git_branch": p.git_branch,
                "status": "ready",
                "created": True,
            }
        if not proj_id_raw:
            conv_id_fallback = (
                getattr(kontext, "conversation_id", None)
                if kontext is not None
                else None
            ) or (
                kontext.get("conversation_id")
                if isinstance(kontext, dict)
                else None
            )
            if conv_id_fallback:
                from models.ai_conversation import AiConversation
                conv_row = db.get(AiConversation, str(conv_id_fallback))
                if conv_row is not None and conv_row.project_id:
                    proj_id_raw = conv_row.project_id
        if action == "search_components":
            query_str = str(arguments.get("query") or arguments.get("path") or "").strip()
            items = ai_project_service.search_cross_project_components(
                db,
                user,
                current_project_id=str(proj_id_raw) if proj_id_raw else None,
                query=query_str,
            )
            return {"components": items}
        if not proj_id_raw:
            raise AiActionValidationError("project_id ist für diese Aktion erforderlich")
        pid = str(proj_id_raw)
        if action == "list_files":
            files = ai_project_service.list_project_files(db, user, pid)
            return {"project_id": pid, "files": [{"path": f.path, "size_bytes": f.size_bytes} for f in files]}
        if action == "read_file":
            f = ai_project_service.read_project_file(db, user, pid, str(arguments.get("path") or ""))
            return {"project_id": pid, "path": f.path, "content": f.content, "size_bytes": f.size_bytes}
        if action == "write_file":
            if not permission_service.has_global_permission(db, user, "ai.coding.use"):
                raise AiActionValidationError("Programmierarbeiten und Code-Änderungen sind für diesen Benutzer nicht freigegeben (ai.coding.use)")
            f = ai_project_service.write_project_file(
                db,
                user,
                pid,
                str(arguments.get("path") or ""),
                str(arguments.get("content") or ""),
            )
            diff_info = getattr(f, "_last_diff", None)
            return {
                "project_id": pid,
                "path": f.path,
                "size_bytes": f.size_bytes,
                "saved": True,
                "diff": diff_info,
            }
        if action in ("patch_file", "edit_file"):
            if not permission_service.has_global_permission(db, user, "ai.coding.use"):
                raise AiActionValidationError("Programmierarbeiten und Code-Änderungen sind für diesen Benutzer nicht freigegeben (ai.coding.use)")

            path_arg = str(arguments.get("path") or "")
            raw_edits = arguments.get("edits")
            edits_list: list[dict[str, str]] = []

            if isinstance(raw_edits, list) and raw_edits:
                for item in raw_edits:
                    if isinstance(item, dict):
                        find_s = str(item.get("find") if item.get("find") is not None else item.get("target", ""))
                        replace_s = str(item.get("replace") if item.get("replace") is not None else item.get("replacement", ""))
                        edits_list.append({"find": find_s, "replace": replace_s})
            else:
                find_val = arguments.get("find") if arguments.get("find") is not None else arguments.get("target")
                replace_val = arguments.get("replace") if arguments.get("replace") is not None else arguments.get("replacement")
                if find_val is not None:
                    edits_list.append({
                        "find": str(find_val),
                        "replace": str(replace_val if replace_val is not None else ""),
                    })

            if not edits_list:
                raise AiActionValidationError("Keine Ersetzungen angegeben. Nutze 'find' und 'replace' oder eine Liste unter 'edits'.")

            f, count = ai_project_service.patch_project_file(
                db,
                user,
                pid,
                path_arg,
                edits_list,
            )
            diff_info = getattr(f, "_last_diff", None)
            return {
                "project_id": pid,
                "path": f.path,
                "size_bytes": f.size_bytes,
                "edits_applied": count,
                "saved": True,
                "diff": diff_info,
            }
        if action == "delete_file":
            if not (permission_service.has_global_permission(db, user, "ai.projects.manage") or permission_service.has_global_permission(db, user, "ai.coding.use")):
                raise AiActionValidationError("Dateien löschen ist für diesen Benutzer nicht freigegeben")
            ai_project_service.delete_project_file(db, user, pid, str(arguments.get("path") or ""))
            return {"project_id": pid, "deleted": True}
        if action == "run_command":
            if not permission_service.has_global_permission(db, user, "ai.coding.use"):
                raise AiActionValidationError("Programmierarbeiten und Befehlsausführung sind für diesen Benutzer nicht freigegeben (ai.coding.use)")
            return ai_project_service.run_project_command(
                db, user, pid, str(arguments.get("command") or "")
            )
        if action in ("test_project", "verify_project"):
            return ai_project_service.verify_project_sandbox(db, user, pid)
        if action == "configure_preview":
            return ai_project_service.configure_project_preview(
                db,
                user,
                pid,
                entry_file=str(arguments.get("entry_file") or arguments.get("path") or "").strip() or None,
                framework=str(arguments.get("framework") or "").strip() or None,
                port=int(arguments["port"]) if arguments.get("port") else None,
                healthcheck_path=str(arguments.get("healthcheck_path") or "").strip() or None,
            )
        if action == "preview_inspect":
            vps_raw = arguments.get("viewports")
            vps_list: list[str] | None = None
            if isinstance(vps_raw, list):
                vps_list = [str(x) for x in vps_raw]
            elif isinstance(vps_raw, str):
                vps_list = [x.strip() for x in vps_raw.split(",") if x.strip()]
            inter_raw = arguments.get("interactions")
            inter_list: list[dict] | None = None
            if isinstance(inter_raw, list):
                inter_list = [x for x in inter_raw if isinstance(x, dict)]
            return ai_project_service.inspect_project_preview(
                db, user, pid, viewports=vps_list, interactions=inter_list
            )
        if action == "get_environment":
            return ai_project_service.get_project_environment(db, user, pid)
        if action == "publish_production":
            if not permission_service.has_global_permission(db, user, "ai.projects.manage"):
                raise AiActionValidationError("Projekt-Veröffentlichung erfordert ai.projects.manage")
            node_id = str(arguments.get("node_id") or "").strip() or None
            notes = str(arguments.get("message") or arguments.get("release_notes") or "").strip() or None
            mode = str(arguments.get("mode") or "").strip() or None
            domain = str(arguments.get("domain") or "").strip() or None
            enable_db = arguments.get("enable_database")
            if enable_db is not None:
                enable_db = bool(enable_db)
            proxy_url = str(arguments.get("backend_proxy_url") or "").strip() or None
            api_p = str(arguments.get("api_path") or "").strip() or None
            bind_ip = str(arguments.get("bind_ip") or "").strip() or None
            merge_to_main = bool(arguments.get("merge_to_main", False))
            return ai_project_service.publish_project_to_production(
                db,
                user,
                pid,
                node_id=node_id,
                release_notes=notes,
                mode=mode,
                domain=domain,
                enable_database=enable_db,
                backend_proxy_url=proxy_url,
                api_path=api_p,
                bind_ip=bind_ip,
                merge_to_main=merge_to_main,
            )
        if action == "run_sql":
            sql_cmd = str(arguments.get("sql") or "").strip()
            if not sql_cmd:
                raise AiActionValidationError("Parameter 'sql' darf nicht leer sein")
            env = str(arguments.get("environment") or arguments.get("env") or "dev").strip()
            write = bool(arguments.get("write", False))
            from services import ai_db_migration_service
            return ai_db_migration_service.execute_project_sql(
                db, user, pid, sql_cmd, target_env=env, write=write
            )
        if action == "db_status":
            env = str(arguments.get("environment") or arguments.get("env") or "dev").strip()
            from services import ai_db_migration_service
            return ai_db_migration_service.get_project_db_status(db, user, pid, target_env=env)
        if action == "db_tables":
            env = str(arguments.get("environment") or arguments.get("env") or "dev").strip()
            from services import ai_db_migration_service
            return {"tables": ai_db_migration_service.list_project_tables(db, user, pid, target_env=env)}
        if action == "db_rows":
            table = str(arguments.get("table") or arguments.get("table_name") or "").strip()
            if not table:
                raise AiActionValidationError("Parameter 'table' darf nicht leer sein")
            limit = int(arguments.get("limit") or 50)
            env = str(arguments.get("environment") or arguments.get("env") or "dev").strip()
            from services import ai_db_migration_service
            return ai_db_migration_service.get_project_table_rows(
                db, user, pid, table, limit=limit, target_env=env
            )
        if action == "apply_migrations":
            env = str(arguments.get("environment") or arguments.get("env") or "dev").strip()
            from services import ai_db_migration_service
            return ai_db_migration_service.apply_project_migrations(db, user, pid, target_env=env)
        if action == "git_status":
            return ai_project_service.git_status(db, user, pid)
        if action == "git_sync":
            token = str(arguments.get("token") or arguments.get("git_token") or "").strip() or None
            return ai_project_service.git_clone_or_pull(
                db,
                user,
                pid,
                repo_url=str(arguments.get("repo_url") or "") or None,
                branch=str(arguments.get("branch") or "") or None,
                token=token,
            )
        if action == "git_commit":
            if not permission_service.has_global_permission(db, user, "ai.coding.use"):
                raise AiActionValidationError("Programmierarbeiten und Git-Commit sind für diesen Benutzer nicht freigegeben (ai.coding.use)")
            token = str(arguments.get("token") or arguments.get("git_token") or "").strip() or None
            return ai_project_service.git_commit_and_push(
                db,
                user,
                pid,
                message=str(arguments.get("message") or "Update"),
                push=bool(arguments.get("push", False)),
                token=token,
            )
        if action == "dev_start":
            from services.singra import dev_env
            return dev_env.start_dev_environment(db, user, pid, options=arguments)
        if action == "dev_stop":
            from services.singra import dev_env
            return dev_env.stop_dev_environment(db, user, pid)
        if action == "dev_status":
            from services.singra import dev_env
            return dev_env.get_dev_environment_status(db, user, pid)
        if action == "git_branch":
            branch_arg = str(arguments.get("branch") or arguments.get("name") or "").strip() or None
            return ai_project_service.git_branch(db, user, pid, branch_name=branch_arg)
        if action == "git_open_pr":
            title = str(arguments.get("title") or "").strip() or None
            body = str(arguments.get("body") or "").strip() or None
            target_branch = str(arguments.get("target_branch") or "main").strip()
            token = str(arguments.get("token") or arguments.get("git_token") or "").strip() or None
            return ai_project_service.git_open_pr(db, user, pid, title=title, body=body, target_branch=target_branch, token=token)
        if action == "merge_to_main":
            return ai_project_service.merge_to_main(db, user, pid)
        raise AiActionValidationError(f"Unbekannte project_workspace-Aktion: {action}")
    except AiProjectError as exc:
        raise AiActionValidationError(str(exc)) from exc


werkzeug(
    _WORKSPACE,
    art="global_read",
    gruppe="projects",
    angebot=("ai.projects.manage", "ai.coding.use"),
    hinweis="Arbeitet in KI-Projekten: Dateien, Coding, Vorschau, Git.",
    global_handler=projekt_werkzeug,
)
werkzeug(
    _CREATE,
    art="global_read",
    gruppe="projects",
    angebot=("ai.projects.manage",),
    hinweis="Legt autonom ein neues KI-Projekt an und verknuepft den Chat.",
    global_handler=projekt_werkzeug,
)
