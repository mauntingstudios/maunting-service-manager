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
})
