import { api } from '../client'
import type {
  AiCrossProjectComponent,
  AiMcpPruefung,
  AiMcpServer,
  AiMcpServerWrite,
  AiMcpWerkzeugMeldung,
  AiPreviewInspectionResult,
  AiProject,
  AiProjectDevStatus,
  AiProjectEnvironmentState,
  AiProjectExecResult,
  AiProjectFile,
  AiProjectGitStatus,
  AiProjectPublishOptions,
  AiProjectPublishResult,
  AiProjectQuotaSummary,
  AiProjectWikiDocSession,
  AiProjectWikiOverview,
  AiProjectWikiPageDetail,
  AiProjectWikiSearchHit,
  AiProjectWrite,
  SingraDeploymentItem,
  SingraTestRunItem,
} from './projectTypes'

export const projectsApi = {
  listProjects: () => api<AiProject[]>('/ai/projects'),
  createProject: (payload: AiProjectWrite & { name: string }) =>
    api<AiProject>('/ai/projects', { method: 'POST', body: JSON.stringify(payload) }),
  getProject: (projectId: string) =>
    api<AiProject>(`/ai/projects/${encodeURIComponent(projectId)}`),
  updateProject: (projectId: string, payload: AiProjectWrite) =>
    api<AiProject>(`/ai/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteProject: (projectId: string) =>
    api<{ deleted: boolean }>(`/ai/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    }),
  listProjectFiles: (projectId: string) =>
    api<AiProjectFile[]>(`/ai/projects/${encodeURIComponent(projectId)}/files`),
  saveProjectFile: (
    projectId: string,
    payload: { path: string; content: string; mime_type?: string },
  ) =>
    api<AiProjectFile>(`/ai/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteProjectFile: (projectId: string, path: string) =>
    api<{ deleted: boolean }>(
      `/ai/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    ),
  execProjectCommand: (
    projectId: string,
    payload: { command: string; timeout_seconds?: number },
  ) =>
    api<AiProjectExecResult>(`/ai/projects/${encodeURIComponent(projectId)}/exec`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getProjectAgentsRules: (projectId: string) =>
    api<{
      found: boolean
      filename: string | null
      content: string | null
      lines_count: number
      size_bytes: number
    }>(`/ai/projects/${encodeURIComponent(projectId)}/agents-rules`),
  getProjectGitStatus: (projectId: string) =>
    api<AiProjectGitStatus>(
      `/ai/projects/${encodeURIComponent(projectId)}/git/status`,
    ),
  syncProjectGit: (
    projectId: string,
    payload?: {
      repo_url?: string | null
      branch?: string | null
      provider?: string | null
      token?: string | null
    },
  ) =>
    api<AiProjectGitStatus>(
      `/ai/projects/${encodeURIComponent(projectId)}/git/sync`,
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      },
    ),
  commitProjectGit: (
    projectId: string,
    payload: { message: string; push?: boolean },
  ) =>
    api<AiProjectGitStatus>(
      `/ai/projects/${encodeURIComponent(projectId)}/git/commit`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  createProjectGitRepo: (
    projectId: string,
    payload: {
      repo_name?: string | null
      private?: boolean
      description?: string | null
      provider?: 'github' | 'gitlab'
      token?: string | null
    },
  ) =>
    api<AiProjectGitStatus & { repo_url?: string; html_url?: string; created?: boolean }>(
      `/ai/projects/${encodeURIComponent(projectId)}/git/create-repo`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  getProjectEnvironment: (projectId: string) =>
    api<AiProjectEnvironmentState>(
      `/ai/projects/${encodeURIComponent(projectId)}/environment`,
    ),
  switchProjectEnvironment: (projectId: string, environment: 'dev' | 'production') =>
    api<AiProjectEnvironmentState>(
      `/ai/projects/${encodeURIComponent(projectId)}/environment/switch`,
      { method: 'POST', body: JSON.stringify({ environment }) },
    ),
  publishProjectToProduction: (
    projectId: string,
    payload: {
      node_id?: string | null
      release_notes?: string | null
      mode?: 'frontend' | 'backend' | 'fullstack_split' | 'auto'
      domain?: string | null
      enable_database?: boolean
      backend_proxy_url?: string | null
      api_path?: string | null
      bind_ip?: string | null
      merge_to_main?: boolean
      target_server_id?: number | null
      frontend_server_id?: number | null
      backend_server_id?: number | null
    },
  ) =>
    api<AiProjectPublishResult>(
      `/ai/projects/${encodeURIComponent(projectId)}/publish`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  getProjectQuota: () => api<AiProjectQuotaSummary>('/ai/projects/quota'),
  getPublishOptions: (projectId: string, nodeId?: string | null) =>
    api<AiProjectPublishOptions>(
      `/ai/projects/${encodeURIComponent(projectId)}/publish-options${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ''}`,
    ),
  ensureDevDatabase: (projectId: string) =>
    api<{
      ok: boolean
      dev_server_id?: number
      dev_database_id?: number
      dev_database_name?: string
      migrations?: any
      connection_string?: string
      message?: string
    }>(
      `/ai/projects/${encodeURIComponent(projectId)}/dev-database`,
      { method: 'POST' },
    ),
  listProjectProductionFiles: (projectId: string) =>
    api<Array<{ path: string; content: string; size_bytes: number }>>(
      `/ai/projects/${encodeURIComponent(projectId)}/production-files`,
    ),
  searchCrossProjectComponents: (projectId: string, query = '') =>
    api<AiCrossProjectComponent[]>(
      `/ai/projects/${encodeURIComponent(projectId)}/cross-project-components?query=${encodeURIComponent(query)}`,
    ),
  inspectProjectPreview: (
    projectId: string,
    payload?: { viewports?: string[]; interactions?: Array<Record<string, unknown>> },
  ) =>
    api<AiPreviewInspectionResult>(
      `/ai/projects/${encodeURIComponent(projectId)}/preview/inspect`,
      { method: 'POST', body: JSON.stringify(payload ?? {}) },
    ),
  startDevEnvironment: (
    projectId: string,
    payload?: { mode?: string; node_id?: number | string; backend_port?: number; frontend_port?: number },
  ) =>
    api<{ ok: boolean; status: string; dev_web_url?: string; dev_api_url?: string }>(
      `/ai/projects/${encodeURIComponent(projectId)}/dev/start`,
      { method: 'POST', body: JSON.stringify(payload ?? {}) },
    ),
  stopDevEnvironment: (projectId: string) =>
    api<{ ok: boolean; status: string; project_id: string }>(
      `/ai/projects/${encodeURIComponent(projectId)}/dev/stop`,
      { method: 'POST' },
    ),
  getDevEnvironmentStatus: (projectId: string) =>
    api<AiProjectDevStatus>(
      `/ai/projects/${encodeURIComponent(projectId)}/dev/status`,
    ),
  runProjectTests: (projectId: string) =>
    api<{ ok: boolean; passed: boolean; release_checksum?: string; summary?: any; errors?: string[] }>(
      `/ai/projects/${encodeURIComponent(projectId)}/test`,
      { method: 'POST' },
    ),
  getProjectTestRuns: (projectId: string) =>
    api<SingraTestRunItem[]>(
      `/ai/projects/${encodeURIComponent(projectId)}/test-runs`,
    ),
  gitBranch: (projectId: string, branch: string) =>
    api<{ ok: boolean; branch: string; initialized?: boolean }>(
      `/ai/projects/${encodeURIComponent(projectId)}/git/branch`,
      { method: 'POST', body: JSON.stringify({ branch }) },
    ),
  gitOpenPr: (
    projectId: string,
    payload: { title: string; body?: string; target_branch?: string; token?: string },
  ) =>
    api<{ ok: boolean; pr_url?: string; pr_number?: number; html_url?: string }>(
      `/ai/projects/${encodeURIComponent(projectId)}/git/open-pr`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  mergeToMain: (projectId: string) =>
    api<{ ok: boolean; branch: string; message?: string }>(
      `/ai/projects/${encodeURIComponent(projectId)}/git/merge-to-main`,
      { method: 'POST' },
    ),
  listProjectDeployments: (projectId: string, limit = 20) =>
    api<SingraDeploymentItem[]>(
      `/ai/projects/${encodeURIComponent(projectId)}/deployments?limit=${limit}`,
    ),
  getProjectDeployment: (projectId: string, deploymentId: string) =>
    api<SingraDeploymentItem>(
      `/ai/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}`,
    ),
  listMcpServers: () => api<AiMcpServer[]>('/ai/mcp'),
  pruefeMcpServer: (serverId: string) =>
    api<AiMcpPruefung>(`/ai/mcp/${encodeURIComponent(serverId)}/pruefen`, {
      method: 'POST',
    }),
  meldeMcpWerkzeuge: (serverId: string, tools: AiMcpWerkzeugMeldung[]) =>
    api<AiMcpPruefung>(`/ai/mcp/${encodeURIComponent(serverId)}/werkzeuge`, {
      method: 'POST',
      body: JSON.stringify({ tools }),
    }),
  createMcpServer: (payload: AiMcpServerWrite & { name: string }) =>
    api<AiMcpServer>('/ai/mcp', { method: 'POST', body: JSON.stringify(payload) }),
  updateMcpServer: (serverId: string, payload: AiMcpServerWrite) =>
    api<AiMcpServer>(`/ai/mcp/${encodeURIComponent(serverId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteMcpServer: (serverId: string) =>
    api<{ deleted: boolean }>(`/ai/mcp/${encodeURIComponent(serverId)}`, {
      method: 'DELETE',
    }),
  getProjectWiki: (projectId: string) =>
    api<AiProjectWikiOverview>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki`,
    ),
  updateProjectWikiSettings: (
    projectId: string,
    payload: { wiki_enabled?: boolean; wiki_auto_update?: boolean; wiki_path?: string },
  ) =>
    api<AiProjectWikiOverview>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/settings`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    ),
  searchProjectWiki: (projectId: string, query: string, limit = 5) =>
    api<AiProjectWikiSearchHit[]>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  getProjectWikiPage: (projectId: string, slug: string) =>
    api<AiProjectWikiPageDetail>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/pages/${encodeURIComponent(slug)}`,
    ),
  saveProjectWikiPage: (
    projectId: string,
    slug: string,
    payload: {
      title: string
      category: string
      summary: string
      content_markdown: string
      source_files: string[]
    },
  ) =>
    api<AiProjectWikiPageDetail>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/pages/${encodeURIComponent(slug)}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    ),
  deleteProjectWikiPage: (projectId: string, slug: string) =>
    api<{ deleted: boolean; slug: string }>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/pages/${encodeURIComponent(slug)}`,
      { method: 'DELETE' },
    ),
  openProjectWikiDoc: (projectId: string, slug: string) =>
    api<AiProjectWikiDocSession>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/pages/${encodeURIComponent(slug)}/doc`,
      { method: 'POST' },
    ),
  syncProjectWikiDoc: (projectId: string, slug: string) =>
    api<AiProjectWikiPageDetail>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/pages/${encodeURIComponent(slug)}/doc/sync`,
      { method: 'POST' },
    ),
  syncProjectWikiWorkspace: (projectId: string) =>
    api<{ synced_files: number; updated: number; removed: number }>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/sync`,
      { method: 'POST' },
    ),
  generateProjectWiki: (
    projectId: string,
    payload?: { mode?: 'generate' | 'update'; changed_files?: string[] },
  ) =>
    api<{ started: boolean; wiki_status?: string; worker_id?: string }>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/generate`,
      { method: 'POST', body: JSON.stringify(payload ?? { mode: 'generate' }) },
    ),
  commitProjectWiki: (
    projectId: string,
    payload?: { message?: string; push?: boolean },
  ) =>
    api<AiProjectGitStatus>(
      `/ai/projects/${encodeURIComponent(projectId)}/wiki/commit`,
      { method: 'POST', body: JSON.stringify(payload ?? {}) },
    ),
}
