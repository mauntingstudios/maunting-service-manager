import { api } from './client'

export type ServerVariableType =
  | 'select'
  | 'string'
  | 'number'
  | 'boolean'
  | 'secret'
  | 'git_url'

export interface ServerVariableOption {
  value: string
  label: string
  badge?: string | null
}

export interface ServerVariableItem {
  key: string
  label: string
  description?: string | null
  group: string
  type: ServerVariableType
  default: string
  value: string
  is_set: boolean
  has_override: boolean
  options: ServerVariableOption[]
  allow_custom: boolean
  placeholder?: string | null
  required: boolean
  customer_editable: boolean
  min?: number | null
  max?: number | null
  pattern?: string | null
  requires_restart: boolean
}

export interface ServerVariablesResponse {
  server_id: number
  game_type: string
  blueprint_name: string
  has_variables: boolean
  is_running: boolean
  source_type?: string | null
  upload_hint?: string | null
  variables: ServerVariableItem[]
}

export interface ServerVariablesUpdateResponse {
  variables: ServerVariablesResponse
  changed_keys: string[]
  restart_recommended: boolean
}

export const serverVariablesApi = {
  get: (serverId: number | string) =>
    api<ServerVariablesResponse>(`/servers/${serverId}/variables`),
  update: (serverId: number | string, values: Record<string, string | null>) =>
    api<ServerVariablesUpdateResponse>(`/servers/${serverId}/variables`, {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }),
}
