import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminAudit } from './AdminAudit'
import * as client from '@/api/client'
import i18n from '@/i18n'
import { useToastStore } from '@/stores/toastStore'

vi.mock('@/api/client', () => ({ api: vi.fn() }))

const ZEILE = {
  id: 9,
  user_id: 1,
  username: 'Mai',
  action: 'server.lifecycle.completed',
  category: 'server',
  result: 'success',
  target_type: 'server',
  target_id: '134',
  target_label: 'DayZ – Namalsk',
  origin: 'direct',
  correlation_id: '0a613465-487d-44a0-af1c-5aa031a873c9',
  details: '{"task_id":42,"operation":"start"}',
  created_at: '2026-11-09T10:00:00.000Z',
}

const UEBERSICHT = {
  range_days: 7,
  start: '2026-11-02T10:00:00.000Z',
  end: '2026-11-09T10:00:00.000Z',
  current: { total: 1, users: 1, security: 0, failed: 0 },
  previous: { total: 0, users: 0, security: 0, failed: 0 },
  by_category: [{ category: 'server', count: 1 }],
  top_actions: [{ action: 'server.lifecycle.completed', category: 'server', count: 1 }],
}

function antworten() {
  vi.mocked(client.api).mockImplementation(async (pfad: string) => {
    if (pfad.startsWith('/admin/audit-logs/summary')) return UEBERSICHT
    return { items: [ZEILE], total: 1 }
  })
}

describe('AdminAudit', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useToastStore.setState({ toasts: [] })
    vi.mocked(client.api).mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('waehlt auf breiten Schirmen den ersten Eintrag fuer die Detailspalte', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    antworten()

    render(
      <MemoryRouter>
        <AdminAudit />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Task')).toBeInTheDocument()
    expect(screen.getAllByText('Server started').length).toBeGreaterThan(0)
  })

  it('zeigt Kennzahlen, Eintrag und Detail ohne Secrets', async () => {
    antworten()

    const { container } = render(
      <MemoryRouter>
        <AdminAudit />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Server started')).toBeInTheDocument()
    expect(client.api).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/audit-logs\?/))
    expect(client.api).toHaveBeenCalledWith('/admin/audit-logs/summary?days=7')
    expect(screen.getByText('Mai')).toBeInTheDocument()
    expect(screen.getByText(/DayZ – Namalsk/)).toBeInTheDocument()
    expect(screen.getByText('Successful')).toBeInTheDocument()

    const totalKarte = screen.getByText('Total entries').closest('.msm-card') as HTMLElement
    expect(within(totalKarte).getByText('1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('audit-zeile'))

    expect(await screen.findByText('0a613465-487d-44a0-af1c-5aa031a873c9')).toBeInTheDocument()
    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getAllByText('Operation').length).toBeGreaterThan(0)
    expect(screen.getByText('Start')).toBeInTheDocument()
    // Keine Secrets in der Anzeige und kein natives title.
    expect(screen.queryByText(/password\s*=/i)).not.toBeInTheDocument()
    expect(container.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('zeigt einen ausdruecklichen Fehler, wenn die Liste nicht laedt', async () => {
    vi.mocked(client.api).mockRejectedValue(new Error('Keine Berechtigung'))

    render(
      <MemoryRouter>
        <AdminAudit />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Could not load the audit log.')).toBeInTheDocument()
    })
    expect(screen.getByText('Keine Berechtigung')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
