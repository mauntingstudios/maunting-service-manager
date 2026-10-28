import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { ChatHeader } from './ChatHeader'

const BILD = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='

function zeige(teil: Partial<ComponentProps<typeof ChatHeader>> = {}) {
  return render(
    <ChatHeader
      titel="Team"
      stumm={false}
      blockiert={false}
      onZurueck={vi.fn()}
      onSuche={vi.fn()}
      menue={() => null}
      {...teil}
    />,
  )
}

describe('ChatHeader', () => {
  it('zeigt Bild und Namen in Direktchat und Gruppe', () => {
    // Bis 27.10.2026 trug nur die Gruppe ein Bild (20 px) und am Telefon fiel
    // der Name ganz weg. Der Kopf ist jetzt eine Leiste für beide.
    zeige({ bild: BILD, onProfil: vi.fn() })
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', BILD)
  })

  it('zeigt ohne Bild die Initialen des Namens', () => {
    zeige()
    expect(screen.getByText('TE')).toBeInTheDocument()
  })

  it('hält den Zurück-Pfeil am Telefon und blendet ihn am Rechner aus', () => {
    zeige()
    const zurueck = screen.getByRole('button', { name: i18n.t('messenger.backToContacts') })
    expect(zurueck.closest('[class*="md:hidden"]')).not.toBeNull()
  })

  it('bietet die Freundschaftsanfrage nur solange sie gebraucht wird', () => {
    const anfrage = vi.fn()
    const { rerender } = zeige({ onFreundschaftsanfrage: anfrage })
    expect(screen.getByRole('button', { name: i18n.t('messenger.sendFriendRequest') })).toBeInTheDocument()

    rerender(
      <ChatHeader
        titel="Team"
        stumm={false}
        blockiert={false}
        onZurueck={vi.fn()}
        onSuche={vi.fn()}
        menue={() => null}
        onFreundschaftsanfrage={anfrage}
        anfrageGesendet
      />,
    )
    expect(
      screen.queryByRole('button', { name: i18n.t('messenger.sendFriendRequest') }),
    ).not.toBeInTheDocument()
  })

  it('zeigt in einer Gruppe keine Freundschaftsanfrage', () => {
    zeige({ bild: BILD })
    expect(
      screen.queryByRole('button', { name: i18n.t('messenger.sendFriendRequest') }),
    ).not.toBeInTheDocument()
  })

  it('behält Suche und Menü in der Kopfleiste', () => {
    zeige()
    expect(screen.getByRole('button', { name: i18n.t('messenger.searchInChat') })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: i18n.t('messenger.moreChatSettings') }),
    ).toBeInTheDocument()
  })

  it('zeigt die Info unter dem Namen', () => {
    zeige({ bild: BILD, info: 'Im Feierabend' })
    expect(screen.getByText('Im Feierabend')).toBeInTheDocument()
  })

  it('zeigt ohne Info keine zweite Zeile', () => {
    zeige({ bild: BILD })
    // Der Name bleibt die einzige Zeile im Kopf.
    expect(screen.getByText('Team')).toBeInTheDocument()
  })
})
