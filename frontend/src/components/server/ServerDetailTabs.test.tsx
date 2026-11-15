import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileText, Terminal } from 'lucide-react'

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

  it('meldet die Wahl per onSelect auf Desktop', () => {
    const onSelect = vi.fn()
    render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Konsole' }))
    expect(onSelect).toHaveBeenCalledWith('console')
  })

  it('bietet am Handy einen Design-DNA Dropdown zur bequemen Direktwahl ohne Quetschen', () => {
    const onSelect = vi.fn()
    render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={onSelect} />)

    // Mobile Dropdown-Container ist vorhanden
    const mobileContainer = screen.getByTestId('mobile-tab-dropdown')
    expect(mobileContainer).toBeInTheDocument()
    expect(mobileContainer.className).toMatch(/md:hidden/)

    // Der Trigger zeigt den aktiven Tab an
    const trigger = mobileContainer.querySelector('button')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('Dateimanager')

    // Dropdown oeffnen und Konsole auswaehlen
    if (trigger) {
      fireEvent.click(trigger)
      const konsoleOption = screen.getByRole('option', { name: /Konsole/ })
      expect(konsoleOption).toBeInTheDocument()
      fireEvent.click(konsoleOption)
      expect(onSelect).toHaveBeenCalledWith('console')
    }
  })

  it('stellt auf Desktop die semantische Reiterleiste bereit', () => {
    render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={() => {}} ariaLabel="TestServer" />)

    const leiste = screen.getByRole('tablist', { name: 'TestServer' })
    expect(leiste).toHaveClass('hidden')
    expect(leiste).toHaveClass('md:block')
  })

  it('behält beim Reiterwechsel denselben Knopf, damit der Fokus bleibt', () => {
    const { rerender } = render(<ServerDetailTabs tabs={tabs} activeTab="files" onSelect={() => {}} />)

    const konsole = screen.getByRole('tab', { name: 'Konsole' })
    konsole.focus()
    rerender(<ServerDetailTabs tabs={tabs} activeTab="console" onSelect={() => {}} />)

    expect(screen.getByRole('tab', { name: 'Konsole' })).toBe(konsole)
    expect(document.activeElement).toBe(konsole)
  })

  it('bündelt sekundäre Reiter im Weitere-Menü und blendet den aktiven sekundären Reiter in der Leiste ein', () => {
    const onSelect = vi.fn()
    const mixedTabs = [
      { key: 'files', label: 'Dateimanager', icon: FileText },
      { key: 'console', label: 'Konsole', icon: Terminal },
      { key: 'webhooks', label: 'Webhooks', icon: FileText, secondary: true },
    ]

    const { rerender } = render(
      <ServerDetailTabs tabs={mixedTabs} activeTab="files" onSelect={onSelect} moreLabel="Weitere" />,
    )

    expect(screen.queryByRole('tab', { name: 'Webhooks' })).not.toBeInTheDocument()
    const moreBtn = screen.getByRole('button', { name: 'Weitere' })
    fireEvent.click(moreBtn)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Webhooks' }))
    expect(onSelect).toHaveBeenCalledWith('webhooks')

    rerender(
      <ServerDetailTabs tabs={mixedTabs} activeTab="webhooks" onSelect={onSelect} moreLabel="Weitere" />,
    )
    expect(screen.getByRole('tab', { name: 'Webhooks' })).toHaveAttribute('aria-selected', 'true')
  })
})
