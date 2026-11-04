import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { FileText, Terminal } from 'lucide-react'

import { Topbar } from '@/components/layout/Topbar'
import { ServerDetailTabs } from './ServerDetailTabs'

const tabs = [
  { key: 'files', label: 'Dateimanager', icon: FileText },
  { key: 'console', label: 'Konsole', icon: Terminal },
]

describe('ServerDetailTabs', () => {
  it('rendert alle Reiter und markiert den aktiven', () => {
    render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={() => {}} ariaLabel="Server" />)

    expect(screen.getByRole('tablist', { name: 'Server' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Dateimanager' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Konsole' })).toHaveAttribute('aria-selected', 'false')
  })

  it('meldet die Wahl per onSelect', () => {
    const onSelect = vi.fn()
    render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Konsole' }))
    expect(onSelect).toHaveBeenCalledWith('console')
  })

  it('kompakt am Handy: nur der aktive Reiter zeigt seinen Namen, ohne Wischleiste', () => {
    render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={() => {}} />)

    const aktiv = screen.getByRole('tab', { name: 'Dateimanager' })
    const inaktiv = screen.getByRole('tab', { name: 'Konsole' })
    // Unter md nur das Symbol, der Name bleibt für Screenreader.
    expect(aktiv.querySelector('[class~="max-md:sr-only"]')).toBeNull()
    expect(inaktiv.querySelector('[class~="max-md:sr-only"]')).toHaveTextContent('Konsole')
    expect(inaktiv.className).toMatch(/(^|\s)max-md:px-2(\s|$)/)
    expect(aktiv.className).not.toMatch(/max-md:px-2/)

    // Kein seitliches Wischen am Handy: die Leiste bricht um, erst ab md
    // stehen volle Namen in der Wischleiste wie bisher.
    const leiste = screen.getByRole('tablist')
    expect(leiste.className).not.toMatch(/(^|\s)overflow-x-auto(\s|$)/)
    expect(leiste.className).toMatch(/(^|\s)md:overflow-x-auto(\s|$)/)
    const reihe = leiste.firstElementChild
    expect(reihe?.className).toMatch(/(^|\s)flex-wrap(\s|$)/)
    expect(reihe?.className).toMatch(/(^|\s)md:flex-nowrap(\s|$)/)
    expect(reihe?.className).toMatch(/(^|\s)md:min-w-max(\s|$)/)
  })

  it('nennt den Namen inaktiver Reiter per Kurzinfo, nur am Handy', () => {
    const { container } = render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={() => {}} />)

    const aktiveBlase = container.querySelector('[data-kurzinfo="Dateimanager"]')
    const inaktiveBlase = container.querySelector('[data-kurzinfo="Konsole"]')
    expect(aktiveBlase?.getAttribute('class')).toMatch(/(^|\s)!hidden(\s|$)/)
    expect(aktiveBlase?.getAttribute('class')).not.toMatch(/md:!hidden/)
    expect(inaktiveBlase?.getAttribute('class')).toMatch(/(^|\s)md:!hidden(\s|$)/)
  })

  it('klebt direkt unter der mobilen Topbar und steht ab md statisch', () => {
    // Wie Sprungleiste: die Topbar ist 48 px hoch (h-12) und ab lg
    // ausgeblendet. Ändert sich die Topbar, muss dieser Versatz mitgehen.
    render(
      <MemoryRouter>
        <Topbar />
        <ServerDetailTabs tabs={tabs} activeTab="files" onSelect={() => {}} />
      </MemoryRouter>,
    )

    const topbar = screen.getByRole('banner')
    expect(topbar.className).toMatch(/(^|\s)h-12(\s|$)/)
    expect(topbar.className).toMatch(/(^|\s)lg:hidden(\s|$)/)

    const leiste = screen.getByRole('tablist')
    expect(leiste.className).toMatch(/(^|\s)sticky(\s|$)/)
    expect(leiste.className).toMatch(/(^|\s)top-12(\s|$)/)
    expect(leiste.className).toMatch(/(^|\s)md:static(\s|$)/)
  })

  it('behält beim Reiterwechsel denselben Knopf, damit der Fokus bleibt', () => {
    const { rerender } = render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={() => {}} />)

    const konsole = screen.getByRole('tab', { name: 'Konsole' })
    konsole.focus()
    rerender(<ServerDetailTabs tabs={tabs} activeTab="console" onSelect={() => {}} />)

    expect(screen.getByRole('tab', { name: 'Konsole' })).toBe(konsole)
    expect(document.activeElement).toBe(konsole)
  })
})
