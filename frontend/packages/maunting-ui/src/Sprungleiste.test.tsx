import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Topbar } from '@/components/layout/Topbar'
import { Sprungleiste } from './Sprungleiste'

describe('Sprungleiste', () => {
  it('klebt direkt unter der Topbar', () => {
    // Bis 27.09.2026 klebte die Leiste bei top-16. Die Topbar ist aber nur
    // 48 px hoch (h-12) und ab lg ausgeblendet: in der Lücke darüber lief der
    // Inhalt durch. Ändert sich die Topbar, muss dieser Versatz mitgehen.
    // Seit dem Wegfall der Seitenleiste ist die Topbar auf allen Breiten
    // 56 px hoch (h-14) und immer sichtbar.
    render(
      <MemoryRouter>
        <Topbar />
        <Sprungleiste label="Abschnitte" ziele={[{ id: 'a', label: 'A' }]} />
      </MemoryRouter>,
    )

    const topbar = screen.getByRole('banner')
    expect(topbar.className).toMatch(/(^|\s)h-14(\s|$)/)
    expect(topbar.className).not.toMatch(/(^|\s)lg:hidden(\s|$)/)

    const leiste = screen.getByRole('navigation', { name: 'Abschnitte' })
    expect(leiste.className).toMatch(/(^|\s)sticky(\s|$)/)
    expect(leiste.className).toMatch(/(^|\s)top-14(\s|$)/)
    expect(leiste.className).not.toMatch(/(^|\s)lg:top-0(\s|$)/)
    expect(screen.getByRole('link', { name: 'A' })).toHaveAttribute('href', '#a')
  })
})
