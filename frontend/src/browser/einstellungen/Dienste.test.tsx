import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Dienste } from './Dienste'
import { useSitzung } from '../services/sitzung'

vi.mock('@/pages/profile/DevicesTab', () => ({
  DevicesTab: () => <div data-testid="mock-devices-tab">Geraeteliste</div>,
}))

vi.mock('@/api/client', () => ({
  api: vi.fn().mockResolvedValue({ sidecar_laeuft: true, bereit: true }),
}))

describe('Dienste Einstellungen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSitzung.setState({ stand: 'aus', adresse: '' })
  })

  it('zeigt keine Geraeteliste wenn nicht gekoppelt', async () => {
    render(
      <MemoryRouter>
        <Dienste />
      </MemoryRouter>,
    )

    await screen.findByText('Bereit')
    expect(screen.queryByTestId('mock-devices-tab')).not.toBeInTheDocument()
  })

  it('zeigt die Geraeteliste wenn mit MSM gekoppelt', async () => {
    useSitzung.setState({ stand: 'an', adresse: 'https://msm.example.com' })

    render(
      <MemoryRouter>
        <Dienste />
      </MemoryRouter>,
    )

    await screen.findByText('Bereit')
    expect(screen.getByTestId('mock-devices-tab')).toBeInTheDocument()
  })
})
