import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeploymentsPanel } from './DeploymentsPanel'
import { frontendApi, type FrontendDeployment } from '@/api/frontend'
import { SanitizedApiError } from '@/api/client'

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

  it('opens Live-Vorschau inside inspector modal instead of inline, supports lazy load pagination, and refreshes on cancel error', async () => {
    const makeDep = (id: number, status: FrontendDeployment['status'] = 'ready'): FrontendDeployment => ({
      id,
      server_id: 7,
      kind: 'production',
      branch: 'main',
      branch_slug: 'main',
      commit_sha: `sha${id}0000`,
      commit_message: `build ${id}`,
      commit_author: 'Maik',
      source: 'push',
      status,
      is_live: id === 100,
      port: 28080,
      url: 'https://shop.example.de',
      error_summary: null,
      created_at: null,
      started_at: null,
      finished_at: null,
    })

    const manyDeps: FrontendDeployment[] = [
      makeDep(101, 'building'),
      ...Array.from({ length: 10 }, (_, idx) => makeDep(100 - idx, 'ready')),
    ]

    vi.mocked(frontendApi.getOverview).mockResolvedValue({
      server_id: 7,
      production_branch: 'main',
      auto_deploy: true,
      previews_enabled: false,
      online: true,
      production_url: 'https://shop.example.de',
      production_deployment: makeDep(100, 'ready'),
      previews: [],
      domain: null,
      domain_verified: false,
      domain_verify_txt_host: null,
      domain_verify_txt_value: null,
      webhook_registered: false,
      env_production: {},
      env_preview: {},
    })
    vi.mocked(frontendApi.listDeployments).mockImplementation(async (_sid, _branch, opts) => {
      const limit = opts?.limit ?? 50
      return manyDeps.slice(0, limit)
    })
    vi.mocked(frontendApi.getDeploymentLog).mockResolvedValue({
      id: 100,
      status: 'ready',
      log: 'build ok',
    })
    vi.mocked(frontendApi.cancelDeployment).mockRejectedValue(
      new SanitizedApiError('Der Build ist bereits abgeschlossen.', 409),
    )

    render(<DeploymentsPanel serverId={7} />)

    await waitFor(() => {
      expect(screen.getByText('Mehr laden')).toBeInTheDocument()
    })
    expect(screen.queryByTitle('Produktions-Vorschau')).not.toBeInTheDocument()

    // Live-Vorschau Button oeffnet direkt das Inspector-Modal im Vorschau-Tab
    fireEvent.click(screen.getByRole('button', { name: /Live-Vorschau/i }))
    await waitFor(() => {
      expect(screen.getByTitle('main Vorschau')).toBeInTheDocument()
    })

    // Lazy-Load erweitert die Liste und blendet „Weniger anzeigen“ ein
    fireEvent.click(screen.getByText('Mehr laden'))
    await waitFor(() => {
      expect(screen.getByText('Weniger anzeigen')).toBeInTheDocument()
    })

    // Fehlgeschlagener Abbruch triggert Refresh ueber getOverview
    const overviewCallsBefore = vi.mocked(frontendApi.getOverview).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Abbrechen/i }))
    await waitFor(() => {
      expect(vi.mocked(frontendApi.getOverview).mock.calls.length).toBeGreaterThan(
        overviewCallsBefore,
      )
    })
  })
})
