import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/i18n'
import { AdminNodes } from './AdminNodes'
import { useNodeStore } from '@/stores/nodeStore'
import { useNodePreferencesStore } from '@/stores/nodePreferencesStore'
import type { Node } from '@/types'

const mockApi = vi.fn()

vi.mock('@/api/client', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}))

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
  useIsOwner: () => true,
}))

const sampleNode: Node = {
  id: 1,
  name: 'Node-Berlin-01',
  host: 'https://10.0.0.42:9000',
  is_local: true,
  status: 'online',
  last_heartbeat: '2026-11-15T18:00:00Z',
  cpu_total: 16,
  cpu_model: 'AMD EPYC 7763',
  ram_total: 65536,
  ram_used: 16384,
  disk_total: 512000,
  disk_used: 102400,
  server_count: 3,
  ram_allocated_mb: 24576,
  ram_allocatable_mb: 32768,
  disk_allocated_gb: 120,
  disk_allocatable_gb: 280,
  disk_panel_used_mb: 61440,
  created_at: '2026-01-01T00:00:00Z',
  metrics: {
    cpu_percent: 28.4,
    cpu_count: 16,
    cpu_model: 'AMD EPYC 7763',
    ram_total_bytes: 65536 * 1024 * 1024,
    ram_used_bytes: 16384 * 1024 * 1024,
    ram_percent: 25,
    disk_total_bytes: 512000 * 1024 * 1024,
    disk_used_bytes: 102400 * 1024 * 1024,
    disk_percent: 20,
  },
}

describe('AdminNodes', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    mockApi.mockReset()
    useNodePreferencesStore.getState().resetForTests()
    useNodeStore.setState({
      nodes: [],
      total: 0,
      page: 1,
      limit: 50,
      loading: false,
      error: null,
    })

    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/system/update/status')) {
        return Promise.resolve({ update_available: false })
      }
      if (path.startsWith('/nodes')) {
        return Promise.resolve({
          items: [sampleNode],
          total: 1,
          page: 1,
          limit: 25,
        })
      }
      return Promise.resolve({})
    })
  })

  it('shows CPU, RAM, and Disk ProgressRings and moves host/booking details into the Ankerfenster popover', async () => {
    render(
      <MemoryRouter>
        <AdminNodes />
      </MemoryRouter>,
    )

    const card = await screen.findByTestId('node-card-1')
    expect(card).toBeInTheDocument()

    expect(screen.getByTestId('node-cpu-1')).toBeInTheDocument()
    expect(screen.getByTestId('node-ram-1')).toBeInTheDocument()
    expect(screen.getByTestId('node-disk-1')).toBeInTheDocument()
    const nodeBlock = screen.getByTestId('admin-node-block-1')
    expect(nodeBlock).toHaveAttribute('data-status', 'online')
    expect(nodeBlock).toHaveAttribute('data-status-tone', 'running')
    expect(nodeBlock.querySelector('svg')).toBeTruthy()

    // Keine nativen <details>-Wände und keine dauerhaft sichtbare Host-URL in der Standardkarte
    expect(document.querySelectorAll('details')).toHaveLength(0)
    expect(screen.queryByText('https://10.0.0.42:9000')).not.toBeInTheDocument()
    expect(screen.queryByTestId('node-ram-booked-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('node-disk-breakdown-1')).not.toBeInTheDocument()

    // Ankerfenster auf 1 Klick öffnen
    fireEvent.click(screen.getByTestId('node-details-trigger-1'))

    expect(await screen.findByText('https://10.0.0.42:9000')).toBeInTheDocument()
    expect(screen.getByTestId('node-ram-booked-1')).toBeInTheDocument()
    expect(screen.getByTestId('node-disk-breakdown-1')).toBeInTheDocument()

    // Keine nativen Browser-Tooltips ([title]) im gerenderten DOM
    expect(document.body.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('favorisiert Nodes einheitlich mit goldener Box-, Stern- und Symbol-Umrandung und sortiert sie nach oben', async () => {
    const secondNode: Node = {
      ...sampleNode,
      id: 2,
      name: 'Node-Frankfurt-02',
      is_local: false,
      status: 'offline',
    }

    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/system/update/status')) {
        return Promise.resolve({ update_available: false })
      }
      if (path.startsWith('/nodes')) {
        return Promise.resolve({
          items: [sampleNode, secondNode],
          total: 2,
          page: 1,
          limit: 25,
        })
      }
      return Promise.resolve({})
    })

    render(
      <MemoryRouter>
        <AdminNodes />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('node-card-2')).toBeInTheDocument()
    const nodeNamesOrder = () =>
      screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)
    expect(nodeNamesOrder()).toEqual(['Node-Berlin-01', 'Node-Frankfurt-02'])

    fireEvent.click(screen.getByTestId('node-favorite-2'))
    expect(nodeNamesOrder()).toEqual(['Node-Frankfurt-02', 'Node-Berlin-01'])

    const favButton = screen.getByTestId('node-favorite-2')
    const favCard = screen.getByTestId('node-card-2')
    const favCardIcon = screen.getByTestId('node-card-icon-2')
    const favStripBlock = screen.getByTestId('admin-node-block-2')
    const favStripIcon = favStripBlock.firstElementChild as HTMLElement

    expect(favButton).toHaveAttribute('aria-pressed', 'true')
    expect(favButton.className).toContain('text-status-warning')
    expect(favButton.querySelector('svg')?.getAttribute('class') ?? '').toContain('fill-status-warning')
    expect(favCard).toHaveAttribute('data-favorite', 'true')
    expect(favCard.className).toContain('border-status-warning/80')
    expect(favCardIcon).toHaveAttribute('data-favorite', 'true')
    expect(favCardIcon.className).toContain('border-status-warning/90')
    expect(favStripBlock).toHaveAttribute('data-favorite', 'true')
    expect(favStripIcon.className).toContain('border-status-warning/90')

    const regularCard = screen.getByTestId('node-card-1')
    expect(regularCard).toHaveAttribute('data-favorite', 'false')
    expect(regularCard.className).not.toContain('border-status-warning/80')

    fireEvent.click(favButton)
    expect(nodeNamesOrder()).toEqual(['Node-Berlin-01', 'Node-Frankfurt-02'])
    expect(screen.getByTestId('node-card-2')).toHaveAttribute('data-favorite', 'false')
    expect(screen.getByTestId('admin-node-block-2')).toHaveAttribute('data-favorite', 'false')
    expect(document.body.querySelectorAll('[title]')).toHaveLength(0)
  })
})
