import { api } from '@/api/client'

export interface FrontendDeployment {
  id: number
  server_id: number
  kind: 'production' | 'preview'
  branch: string
  branch_slug: string
  commit_sha: string | null
  commit_message: string | null
  commit_author: string | null
  source: string
  status: 'queued' | 'building' | 'ready' | 'failed' | 'canceled' | 'superseded'
  is_live: boolean
  port: number | null
  url: string | null
  error_summary: string | null
  created_at: string | null
  started_at: string | null
  finished_at: string | null
}

export interface FrontendOverview {
  server_id: number
  production_branch: string
  auto_deploy: boolean
  previews_enabled: boolean
  online: boolean
  production_url: string | null
  production_deployment: FrontendDeployment | null
  previews: FrontendDeployment[]
  domain: string | null
  domain_verified: boolean
  domain_verify_txt_host: string | null
  domain_verify_txt_value: string | null
  webhook_registered: boolean
  env_production: Record<string, string>
  env_preview: Record<string, string>
}

export interface FrontendSettingsPatch {
  production_branch?: string
  auto_deploy?: boolean
  previews_enabled?: boolean
  domain?: string | null
  env_production?: Record<string, string>
  env_preview?: Record<string, string>
}

export interface VerifyDomainResponse {
  verified: boolean
  txt_ok: boolean
  a_ok: boolean
  actual_ips?: string[]
  expected_ip?: string | null
  expected_txt_host?: string
  expected_txt_value?: string
  caddy_applied?: boolean
  caddy_error?: string | null
}

export const frontendApi = {
  getOverview: (serverId: number) =>
    api<FrontendOverview>(`/servers/${serverId}/frontend`),

  updateSettings: (serverId: number, payload: FrontendSettingsPatch) =>
    api<FrontendOverview>(`/servers/${serverId}/frontend`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  verifyDomain: (serverId: number) =>
    api<VerifyDomainResponse>(
      `/servers/${serverId}/frontend/domain/verify`,
      { method: 'POST' },
    ),

  toggleOnline: (serverId: number, online: boolean) =>
    api<{ online: boolean }>(`/servers/${serverId}/frontend/online`, {
      method: 'POST',
      body: JSON.stringify({ online }),
    }),

  listDeployments: (
    serverId: number,
    branch?: string,
    opts?: { limit?: number; offset?: number },
  ) => {
    const params = new URLSearchParams()
    if (branch) params.set('branch', branch)
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit))
    if (opts?.offset !== undefined) params.set('offset', String(opts.offset))
    const qs = params.toString()
    return api<FrontendDeployment[]>(
      `/servers/${serverId}/frontend/deployments${qs ? `?${qs}` : ''}`,
    )
  },

  getDeploymentLog: (serverId: number, depId: number) =>
    api<{ id: number; status: string; log: string }>(
      `/servers/${serverId}/frontend/deployments/${depId}/log`,
    ),

  triggerBuild: (serverId: number, branch?: string) =>
    api<FrontendDeployment>(`/servers/${serverId}/frontend/deployments`, {
      method: 'POST',
      body: JSON.stringify(branch ? { branch } : {}),
    }),

  cancelDeployment: (serverId: number, depId: number) =>
    api<FrontendDeployment>(`/servers/${serverId}/frontend/deployments/${depId}/cancel`, {
      method: 'POST',
    }),

  clearCache: (serverId: number) =>
    api<{ cleared: boolean }>(`/servers/${serverId}/frontend/cache/clear`, {
      method: 'POST',
    }),

  promoteDeployment: (serverId: number, depId: number) =>
    api<FrontendDeployment>(`/servers/${serverId}/frontend/deployments/${depId}/promote`, {
      method: 'POST',
    }),

  rollbackDeployment: (serverId: number, depId: number) =>
    api<FrontendDeployment>(`/servers/${serverId}/frontend/deployments/${depId}/rollback`, {
      method: 'POST',
    }),

  deletePreview: (serverId: number, branchSlug: string) =>
    api<{ deleted: number }>(
      `/servers/${serverId}/frontend/previews/${encodeURIComponent(branchSlug)}`,
      { method: 'DELETE' },
    ),
}
