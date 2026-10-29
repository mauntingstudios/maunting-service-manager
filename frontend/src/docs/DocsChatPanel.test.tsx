import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { DocsChatPanel } from './DocsChatPanel'

const chatProps = vi.hoisted(() => ({ aktuell: null as Record<string, unknown> | null }))
const rechte = vi.hoisted(() => ({ aktiv: true }))

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => rechte.aktiv,
}))

vi.mock('@/components/ai/AiChat', () => ({
  AiChat: (props: Record<string, unknown>) => {
    chatProps.aktuell = props
    return <div data-testid="chat" />
  },
}))

vi.mock('@/components/ai/voice/SprachAnsicht', () => ({
  SprachAnsicht: () => <div data-testid="sprache" />,
}))

describe('DocsChatPanel', () => {
  it('nutzt den bestehenden Chat mit Dokument-Scope und ohne Aufgaben/Guardian', () => {
    rechte.aktiv = true
    render(
      <MemoryRouter>
        <DocsChatPanel uid="doc-1" selection={{ quote: 'Stelle' }} />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('chat')).toBeInTheDocument()
    expect(chatProps.aktuell?.scope).toEqual({
      kind: 'docs',
      documentUid: 'doc-1',
      selection: { quote: 'Stelle', hash: undefined },
    })
    expect(chatProps.aktuell?.showTasks).toBe(false)
    expect(chatProps.aktuell?.showGuardian).toBe(false)
    expect(chatProps.aktuell?.showWorkers).toBe(false)
    expect(chatProps.aktuell?.eingebettet).toBe(true)
  })

  it('zeigt ohne ai.docs.use den Rechtehinweis statt des Chats', () => {
    rechte.aktiv = false
    render(
      <MemoryRouter>
        <DocsChatPanel uid="doc-1" />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('docs.singra.notAllowedTitle'))).toBeInTheDocument()
  })
})
