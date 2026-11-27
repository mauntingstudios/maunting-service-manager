import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { TresorUntereLeiste } from './TresorUntereLeiste'

describe('TresorUntereLeiste', () => {
  it('zeigt fünf Hauptziele: Übersicht, Passwörter, Dateien, Fotos und Mehr', () => {
    render(
      <TresorUntereLeiste
        ansicht="uebersicht"
        onAnsicht={vi.fn()}
        anzahlImPapierkorb={2}
      />,
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((el) => el.textContent?.trim())).toEqual([
      i18n.t('mss.vault.dashboard.uebersicht'),
      i18n.t('mss.vault.ansicht.tresor'),
      i18n.t('mss.vault.ansicht.dateien'),
      i18n.t('mss.vault.ansicht.fotos'),
      i18n.t('mss.vault.dashboard.mehr'),
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('öffnet Zahlungen, Notizen, Archiv und Papierkorb über das Mehr-Blatt', () => {
    const onAnsicht = vi.fn()
    const onNotizen = vi.fn()
    render(
      <TresorUntereLeiste
        ansicht="archiv"
        onAnsicht={onAnsicht}
        onNotizen={onNotizen}
        anzahlImPapierkorb={3}
      />,
    )

    const mehrTab = screen.getByRole('tab', { name: i18n.t('mss.vault.dashboard.mehr') })
    expect(mehrTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(mehrTab)

    const blatt = screen.getByRole('dialog', { name: i18n.t('mss.vault.dashboard.mehr') })
    fireEvent.click(within(blatt).getByRole('button', { name: i18n.t('mss.vault.dashboard.filterNotizen') }))
    expect(onNotizen).toHaveBeenCalledTimes(1)

    fireEvent.click(mehrTab)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('mss.vault.ansicht.zahlung') }))
    expect(onAnsicht).toHaveBeenCalledWith('zahlung')

    fireEvent.click(mehrTab)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: `${i18n.t('mss.vault.ansicht.papierkorb')} (3)` }))
    expect(onAnsicht).toHaveBeenCalledWith('papierkorb')
  })
})
