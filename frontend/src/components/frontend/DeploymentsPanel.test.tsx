import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeploymentsPanel } from './DeploymentsPanel'
import { frontendApi } from '@/api/frontend'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.defaultValue ? String(opts.defaultValue) : key,
    i18n: { language: 'de' },
  }),
}))

vi.mock('@/api/frontend', () => ({
  frontendApi: {
    getOverview: vi.fn(),
    listDeployments: vi.fn(),
    triggerBuild: vi.fn(),
    cancelDeployment: vi.fn(),
    clearCache: vi.fn(),
    promoteDeployment: vi.fn(),
    rollbackDeployment: vi.fn(),
    deletePreview: vi.fn(),
    getDeploymentLog: vi.fn(),
  },
}))

describe('DeploymentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders production URL and active previews', async () => {
    vi.mocked(frontendApi.getOverview).mockResolvedValue({
      server_id: 7,
      production_branch: 'main',
      auto_deploy: true,
      previews_enabled: true,
      online: true,
      production_url: 'https://shop.example.de',
      production_deployment: {
        id: 11,
        server_id: 7,
        kind: 'production',
        branch: 'main',
        branch_slug: 'main',
        commit_sha: 'abcdef123456',
        commit_message: 'feat: initial',
        commit_author: 'Maik',
        source: 'push',
        status: 'ready',
        is_live: true,
        port: 28080,
        url: 'https://shop.example.de',
        error_summary: null,
        created_at: null,
        started_at: null,
        finished_at: null,
      },
      previews: [
        {
          id: 12,
          server_id: 7,
          kind: 'preview',
          branch: 'feature/cart',
          branch_slug: 'feature-cart',
          commit_sha: '9998887',
          commit_message: 'wip cart',
          commit_author: 'Maik',
          source: 'push',
          status: 'ready',
          is_live: true,
          port: 28101,
          url: 'https://feature-cart--shop.panel.de',
          error_summary: null,
          created_at: null,
          started_at: null,
          finished_at: null,
        },
      ],
      domain: 'shop.example.de',
      domain_verified: true,
      domain_verify_txt_host: null,
      domain_verify_txt_value: null,
      webhook_registered: true,
      env_production: {},
      env_preview: {},
    })
    vi.mocked(frontendApi.listDeployments).mockResolvedValue([])

    render(<DeploymentsPanel serverId={7} />)

    await waitFor(() => {
      expect(screen.getByText('https://shop.example.de')).toBeInTheDocument()
    })
    expect(screen.getByText('feature/cart')).toBeInTheDocument()
    expect(screen.getByText('https://feature-cart--shop.panel.de')).toBeInTheDocument()
  })

  it('shows active build banner with live log action and failed build alert', async () => {
    vi.mocked(frontendApi.getOverview).mockResolvedValue({
      server_id: 7,
      production_branch: 'main',
      auto_deploy: true,
      previews_enabled: false,
      online: true,
      production_url: 'https://shop.example.de',
      production_deployment: null,
      previews: [],
      domain: null,
      domain_verified: false,
      domain_verify_txt_host: null,
      domain_verify_txt_value: null,
      webhook_registered: false,
      env_production: {},
      env_preview: {},
    })
    vi.mocked(frontendApi.listDeployments).mockResolvedValue([
      {
        id: 21,
        server_id: 7,
        kind: 'production',
        branch: 'main',
        branch_slug: 'main',
        commit_sha: '1112223',
        commit_message: null,
        commit_author: null,
        source: 'manual',
        status: 'failed',
        is_live: false,
        port: 28080,
        url: null,
        error_summary: 'npm run build exited with code 1',
        created_at: null,
        started_at: null,
        finished_at: null,
      },
      {
        id: 22,
        server_id: 7,
        kind: 'production',
        branch: 'main',
        branch_slug: 'main',
        commit_sha: '4445556',
        commit_message: null,
        commit_author: null,
        source: 'manual',
        status: 'building',
        is_live: false,
        port: 28080,
        url: null,
        error_summary: null,
        created_at: null,
        started_at: null,
        finished_at: null,
      },
    ])

    vi.mocked(frontendApi.getDeploymentLog).mockResolvedValue({
      id: 21,
      status: 'failed',
      log: 'npm ci completed\nERR_BUILD_FAILED',
    })

    render(<DeploymentsPanel serverId={7} />)

    await waitFor(() => {
      expect(screen.getByText('Build läuft gerade')).toBeInTheDocument()
    })
    expect(screen.getByText('Live-Log öffnen')).toBeInTheDocument()
    expect(screen.getByText('Letzter Build #21 (main) fehlgeschlagen')).toBeInTheDocument()

    fireEvent.click(screen.getByText('#21'))
    await waitFor(() => {
      expect(screen.getByText(/ERR_BUILD_FAILED/)).toBeInTheDocument()
    })
  })
})
