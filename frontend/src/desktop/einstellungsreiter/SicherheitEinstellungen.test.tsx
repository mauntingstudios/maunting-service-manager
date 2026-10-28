import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SicherheitEinstellungen } from './SicherheitEinstellungen'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

vi.mock('@/pages/profile/MessengerSicherheitTab', () => ({
  MessengerSicherheitTab: () => <div data-testid="mock-messenger-tab">Messenger-Karten</div>,
}))

vi.mock('../vault/TresorSicherheitTab', () => ({
  TresorSicherheitTab: ({ offline }: { offline?: boolean }) => (
    <div data-testid="mock-tresor-tab" data-offline={offline ? 'true' : 'false'}>
      Tresor-Karten
    </div>
  ),
}))

vi.mock('@/pages/profile/DevicesTab', () => ({
  DevicesTab: () => <div data-testid="mock-devices-tab">Geräte</div>,
}))

describe('SicherheitEinstellungen', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    usePublicSettingsStore.setState({ social_enabled: true, vault_enabled: true })
  })

  it('rendert alle Bereiche bei aktiven Modulen', () => {
    render(
      <MemoryRouter>
        <SicherheitEinstellungen />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('mock-messenger-tab')).toBeInTheDocument()
    expect(screen.getByTestId('mock-tresor-tab')).toBeInTheDocument()
    expect(screen.getByTestId('mock-devices-tab')).toBeInTheDocument()
    expect(screen.getByText('Messenger')).toBeInTheDocument()
    expect(screen.getByText('Tresor')).toBeInTheDocument()
    // Geräte gehören hierher und nicht nur ins Profil: in der App und im
    // Pondys Browser sucht man sie unter Sicherheit.
    expect(screen.getByRole('heading', { name: 'Geräte' })).toBeInTheDocument()
  })

  it('blendet Messenger aus, wenn social inaktiv ist', () => {
    render(
      <MemoryRouter>
        <SicherheitEinstellungen social={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('mock-messenger-tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-tresor-tab')).toBeInTheDocument()
    // Kopplung ist eine Kontofunktion und bleibt sichtbar; die
    // Messenger-Geräteliste entscheidet die Karte selbst.
    expect(screen.getByTestId('mock-devices-tab')).toBeInTheDocument()
  })

  it('blendet Tresor aus, wenn vault_enabled inaktiv ist', () => {
    render(
      <MemoryRouter>
        <SicherheitEinstellungen tresorAn={false} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('mock-messenger-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-tresor-tab')).not.toBeInTheDocument()
  })

  it('reicht offline an TresorSicherheitTab weiter und blendet Geraete aus', () => {
    render(
      <MemoryRouter>
        <SicherheitEinstellungen offline={true} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('mock-tresor-tab')).toHaveAttribute('data-offline', 'true')
    expect(screen.queryByTestId('mock-devices-tab')).not.toBeInTheDocument()
  })
})
