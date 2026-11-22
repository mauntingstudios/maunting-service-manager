export interface AiProject {
  id: string
  owner_user_id: number
  team_id: number | null
  name: string
  description: string | null
  system_prompt: string | null
  icon: string
  color: string
  project_kind: 'general' | 'coding' | 'docs'
  sandbox_enabled: boolean
  sandbox_path: string | null
  local_directory: string | null
  git_provider: 'github' | 'gitlab' | 'custom' | null
  git_repo_url: string | null
  git_branch: string
  git_token_configured: boolean
  file_count: number
  created_at: string
  updated_at: string
}

export interface AiProjectWrite {
  name?: string
  description?: string | null
  system_prompt?: string | null
  icon?: string
  color?: string
  project_kind?: 'general' | 'coding' | 'docs'
  team_id?: number | null
  sandbox_enabled?: boolean
  local_directory?: string | null
  git_provider?: 'github' | 'gitlab' | 'custom' | null
  git_repo_url?: string | null
  git_branch?: string
  git_token?: string | null
  clear_git_token?: boolean
}

export interface AiProjectDiffInfo {
  path: string
  branch: string
  added_lines: number
  removed_lines: number
  is_new_file: boolean
  diff: string
  truncated?: boolean
}

export interface AiProjectFile {
  id: string
  project_id: string
  path: string
  content: string
  mime_type: string
  size_bytes: number
  created_at?: string
  updated_at: string
  diff?: AiProjectDiffInfo | null
}

export interface AiProjectEnvironmentState {
  active_environment: 'dev' | 'production'
  dev?: {
    status: string
    branch: string
    db_engine: string
    db_branch: string
    file_count: number
    pending_migrations: number
    unreleased_changes_count: number
    unreleased_files: string[]
    dev_server_id?: number | null
    dev_database_id?: number | null
    dev_database_name?: string | null
    dev_has_db?: boolean
  }
  dev_db?: {
    engine: string
    branch: string
    schema: string
    status: string
    migrations_applied: number
  }
  prod_db?: {
    engine: string
    branch: string
    schema: string
    status: string
    migrations_applied: number
    last_migrated_at: string | null
  }
  production: {
    published: boolean
    server_id: number | null
    node_id: string | null
    published_at: string | null
    release_count: number
    status: string
    release_notes?: string
    mode?: 'frontend' | 'backend' | 'fullstack_split'
    frontend_server_id?: number | null
    backend_server_id?: number | null
    web_url?: string | null
    api_path?: string | null
    backend_url?: string | null
    frontend_port?: number | null
    backend_port?: number | null
    bind_ip?: string | null
    db_configured?: boolean
  }
  preview?: {
    configured: boolean
    entry_file: string | null
    framework: string
    port: number
    healthcheck_path: string
  }
}

export interface AiProjectRentedTargetServer {
  id: number
  name: string
  game_type: string
  status: string
  role_hint: 'frontend' | 'backend' | 'bot' | string
}

export interface AiProjectQuotaSummary {
  max_projects: number
  max_storage_mb: number
  max_storage_bytes: number
  unlimited_projects: boolean
  unlimited_storage: boolean
  project_count: number
  used_bytes: number
  used_mb: number
}

export interface AiProjectPublishOptions {
  mode?: 'operator' | 'rented_server'
  nodes: Array<{
    id: number
    name: string
    is_local: boolean
    public_bind_ip?: string | null
  }>
  chosen_node_id: number | null
  chosen_node_name: string | null
  public_ips: Array<{
    ip: string
    interface: string
    is_loopback: boolean
    is_private: boolean
    is_link_local: boolean
  }>
  default_ip: string | null
  cloudflare_configured: boolean
  cloudflare_zones: Array<{
    id: string
    name: string
    status: string
  }>
  github_configured: boolean
  target_servers?: AiProjectRentedTargetServer[]
}

export interface AiProjectPublishResult {
  ok: boolean
  status?: string
  project_id: string
  deployment_id?: string | null
  task_id?: string | null
  phase?: string
  server_id?: number | null
  frontend_server_id?: number | null
  backend_server_id?: number | null
  node_id?: string | null
  node_name?: string | null
  mode?: string
  published_files?: number
  deployed_servers?: Array<{
    server_id: number
    server_name: string
    game_type: string
    role: string
    files_written: number
    task_id?: string | null
  }>
  migrations_applied?: number
  release_count?: number
  version?: number
  web_url?: string
  frontend_port?: number | null
  backend_port?: number | null
  api_path?: string
  database_provisioned?: boolean
  published_at?: string
  environment?: AiProjectEnvironmentState
}

export interface AiCrossProjectComponent {
  project_id: string
  project_name: string
  path: string
  component_name: string
  size_bytes: number
  score: number
  preview: string
}

export interface AiProjectExecResult {
  exit_code: number
  stdout: string
  stderr: string
  cwd: string
  duration_ms: number
}

export interface AiProjectGitStatus {
  initialized: boolean
  branch: string | null
  remote_url: string | null
  clean: boolean
  changed_files: string[]
  ahead: number
  behind: number
  last_commit: string | null
}

export interface AiPreviewInspectionViewport {
  width: number
  height: number
  label: string
  overflow: boolean
  scroll_width: number
  root_empty: boolean
  errors: string[]
  issues: string[]
  screenshot_base64: string | null
}

export interface AiPreviewInspectionResult {
  ok: boolean
  browser_available: boolean
  browser_name?: string
  error?: string
  viewports: Record<string, AiPreviewInspectionViewport>
  issues: string[]
  summary: string
  project_id?: string
  project_name?: string
}

export interface AiProjectDevStatus {
  project_id: string
  status: string
  is_paused: boolean
  dev_web_url: string | null
  dev_api_url: string | null
  dev_frontend_port: number | null
  dev_backend_port: number | null
  dev_backend_server_id: number | null
  dev_frontend_server_id: number | null
  dev_database_id: number | null
  last_active_at: string | null
  idle_minutes: number
}

export interface SingraTestRunItem {
  id: string
  project_id: string
  environment: string
  release_checksum: string | null
  kind: string
  status: 'passed' | 'failed' | 'running' | string
  summary: {
    scenarios?: Array<{ name: string; status: string; detail?: string }>
    errors?: string[]
    negative_tests?: {
      empty_submit_blocked?: boolean
      invalid_email_blocked?: boolean
    }
    viewports?: Record<string, { overflow: boolean; console_errors_count: number; screenshot?: string }>
    third_party_requests_blocked?: number
    console_errors?: string[]
    [key: string]: any
  } | null
  artifacts_path: string | null
  started_at: string | null
  finished_at: string | null
}

export interface SingraDeploymentItem {
  id: string
  project_id: string
  environment: string
  version: number
  task_id: string | null
  status: 'pending' | 'running' | 'succeeded' | 'failed' | string
  phase: string
  error_code: string | null
  error_detail: string | null
  diagnostics: Array<{ phase: string; step: string; message: string; timestamp?: string }> | any
  release_path: string | null
  created_at: string
  finished_at: string | null
}

export interface AiMcpServer {
  id: string
  owner_user_id: number | null
  team_id: number | null
  is_global: boolean
  name: string
  description: string | null
  transport: 'http' | 'sse' | 'stdio'
  endpoint_url: string | null
  command: string | null
  args: string[]
  auth_header_configured: boolean
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface AiMcpPruefung {
  tools: Array<{ name: string; beschreibung?: string; nur_lesen?: boolean }>
  status: string
}

/** Ein Werkzeug, das die Desktop-App für ein lokales Programm gemeldet hat. */
export interface AiMcpWerkzeugMeldung {
  name: string
  beschreibung?: string
  nur_lesen?: boolean
  schema?: Record<string, unknown>
}

export interface AiMcpServerWrite {
  name?: string
  description?: string | null
  transport?: 'http' | 'sse' | 'stdio'
  endpoint_url?: string | null
  command?: string | null
  args?: string[]
  auth_header?: string | null
  clear_auth_header?: boolean
  team_id?: number | null
  is_global?: boolean
  enabled?: boolean
}
