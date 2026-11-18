import type { AiGeoCameraCommand, AiRegionalAnalysis } from './ai/providerTypes'
import { providersApi } from './ai/providersApi'
import { chatApi, attachAiRun, streamAiMessage } from './ai/chatApi'
import { memoryApi } from './ai/memoryApi'
import { projectsApi } from './ai/projectsApi'

export * from './ai/providerTypes'
export * from './ai/chatTypes'
export * from './ai/memoryTypes'
export * from './ai/projectTypes'
export { attachAiRun, streamAiMessage }

/**
 * Ein von der KI ausgefuehrtes Lesewerkzeug, sichtbar im Verlauf.
 * Verbleibt direkt in `api/ai.ts` fuer den Backend-Vertragstest (`failed?: boolean`).
 */
export interface AiToolUse {
  tool_name: string
  server_id: number | null
  skill_key?: string | null
  skill_name?: string | null
  skill_status?: string | null
  skill_learned?: boolean
  failed?: boolean
  error_message?: string | null
  error_code?: string | null
  uebergeben?: boolean
  gruppe?: string | null
  geo_analysis?: AiRegionalAnalysis | null
  geo_camera?: AiGeoCameraCommand | null
  web_results?: Array<{ title?: string; url?: string; snippet?: string; description?: string }> | null
  ergebnis?: unknown
  project_created?: {
    project_id: string
    name: string
    created: boolean
    status: string
    repo_url?: string | null
    sandbox_path?: string | null
  } | null
  file_diff?: {
    path: string
    branch?: string
    added_lines: number
    removed_lines: number
    is_new_file?: boolean
    diff: string
    project_id?: string | null
  } | null
  project_published?: {
    published: boolean
    project_id: string
    server_id: number
    server_name: string
    node_id: number
    node_name: string
    production_url: string
    release_count: number
    files_copied: number
  } | null
  workspace_action?: string | null
  workspace_path?: string | null
}

/**
 * Die Schreibwerkzeuge — vollstaendig, in der Reihenfolge von
 * `ai_tool_registry.WERKZEUGE`.
 * Verbleibt direkt in `api/ai.ts` fuer `test_ai_tool_drift.py`.
 */
export const SCHREIBWERKZEUGE = [
  'propose_server_lifecycle',
  'propose_backup',
  'propose_backup_restore',
  'propose_config_update',
  'propose_config_patch',
  'propose_config_set',
  'propose_mod_install',
  'propose_mod_batch_install',
  'propose_mod_toggle',
  'propose_mod_delete',
  'propose_bind_ip_update',
  'propose_server_create',
  'propose_server_delete',
  'propose_blueprint_change',
  'propose_blueprint_delete',
  'propose_server_blueprint_switch',
  'propose_frontend_action',
  'propose_frontend_settings',
  'propose_hoster_integration',
  'propose_hoster_product',
  'propose_ai_tarif_role',
  'propose_task_set',
  'propose_task_delete',
  'propose_server_repair',
  'propose_guardian_tuning',
  'propose_restart_schedule_set',
  'propose_backup_schedule_set',
  'propose_file_delete',
  'propose_database_change',
  'propose_email_send',
  'propose_calendar_event_create',
  'propose_calendar_event_update',
  'propose_calendar_event_delete',
  'propose_note_create',
  'propose_note_update',
  'propose_note_delete',
  'propose_popup_set',
  'propose_cloudflare_dns_record',
  'propose_cloudflare_dns_delete',
  'propose_modpack_install',
  'propose_user_server_permission',
  'propose_role_set',
  'propose_user_roles',
  'propose_role_delete',
  'propose_team_create',
  'propose_team_role_set',
  'propose_team_role_delete',
  'propose_team_member_roles',
  'propose_team_member_invite',
  'propose_team_member_remove',
  'propose_team_server_grants',
] as const

export type AiWriteTool = (typeof SCHREIBWERKZEUGE)[number]

export const aiApi = {
  ...providersApi,
  ...chatApi,
  ...memoryApi,
  ...projectsApi,
}
