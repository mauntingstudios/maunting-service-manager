import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthRahmen } from './AuthRahmen'

vi.mock('@/hooks/useVersion', () => ({ useVersion: () => 'v9.9.9' }))
vi.mock('@/hooks/usePublicLegalSettings', () => ({
  usePublicLegalSettings: () => ({ imprint_enabled: false, imprint_url: '' }),
}))

describe('AuthRahmen', () => {
  it('legt die Tageszeit-Szene hinter Karte und Inhalt', () => {
    const { container } = render(
      <MemoryRouter>
        <AuthRahmen>
          <p>Anmeldeformular</p>
        </AuthRahmen>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'MSM' })).toBeInTheDocument()
    expect(screen.queryByText('Mounting Service Manager')).toBeNull()
    expect(screen.getByText('Anmeldeformular')).toBeInTheDocument()

    const szene = container.querySelector('[aria-hidden="true"] [style*="background-image"]')
    expect(szene).not.toBeNull()
    expect((szene as HTMLElement).style.backgroundImage).toMatch(/singra|teams/)
  })

  it('zeigt auf der Anmeldung kein Herkunftszeichen', () => {
    render(
      <MemoryRouter>
        <AuthRahmen>
          <p>Anmeldeformular</p>
        </AuthRahmen>
      </MemoryRouter>,
    )

    expect(screen.queryByLabelText(/Defensive Integration Shield/)).toBeNull()
  })
})
