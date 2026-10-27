import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { ChatHeader } from './ChatHeader'

describe('ChatHeader', () => {
  it('nutzt für den Gruppenanruf dasselbe Telefon-Symbol wie den Direktanruf', () => {
    render(
      <ChatHeader
        verborgen={false}
        titel="Team"
        stumm={false}
        blockiert={false}
        onZurueck={vi.fn()}
        gruppenanruf={{ erlaubt: true, onStarten: vi.fn() }}
        onSuche={vi.fn()}
        menue={() => null}
      />,
    )

    const knopf = screen.getByRole('button', { name: i18n.t('messenger.startGroupCall') })
    expect(knopf.querySelector('.lucide-phone')).not.toBeNull()
    expect(knopf.querySelector('.lucide-users-round')).toBeNull()
  })

  it('lässt den Namen am Telefon weg und behält ihn am Rechner', () => {
    // Neben dem Zurück-Pfeil wiederholte der Name nur, was die Liste eben
    // zeigte, und nahm der Nachricht den Platz. jsdom wertet keine
    // Breitenvarianten aus; geprüft wird der Klassenvertrag.
    render(
      <ChatHeader
        verborgen={false}
        titel="Team"
        stumm={false}
        blockiert={false}
        onZurueck={vi.fn()}
        onSuche={vi.fn()}
        menue={() => null}
      />,
    )

    const name = screen.getByText('Team')
    expect(name.closest('.hidden')).not.toBeNull()
    expect(name.closest('.hidden')?.className).toContain('md:block')
  })

  it('zeigt das Stummzeichen auch am Telefon', () => {
    render(
      <ChatHeader
        verborgen={false}
        titel="Team"
        stumm
        blockiert={false}
        onZurueck={vi.fn()}
        onSuche={vi.fn()}
        menue={() => null}
      />,
    )

    const zeichen = screen.getByLabelText(i18n.t('messenger.chatMuted'))
    const pille = zeichen.closest('.rounded-full')
    expect(pille?.className).toContain('flex')
    expect(pille?.className).not.toContain('hidden')
  })
})
