import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { aiApi } from '@/api/ai'
import { DocsChatPanel } from './DocsChatPanel'

const chatProps = vi.hoisted(() => ({ aktuell: null as Record<string, unknown> | null }))
const rechte = vi.hoisted(() => ({ aktiv: true }))

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => rechte.aktiv,
}))

vi.mock('@/api/ai', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/ai')>()
  return {
    ...echt,
    aiApi: {
      ...echt.aiApi,
      getVoiceConfig: vi.fn(async () => ({
        available: true,
        mode: 'legacy',
        model: null,
        voice: null,
        language: 'auto',
        dictation_available: false,
        sample_rate: 24_000,
        max_seconds: 900,
      })),
    },
  }
})

vi.mock('@/components/ai/AiChat', () => ({
  AiChat: (props: Record<string, unknown>) => {
    chatProps.aktuell = props
    return <div data-testid="chat" />
  },
}))

vi.mock('@/components/ai/voice/SprachAnsicht', () => ({
  SprachAnsicht: () => <div data-testid="sprache" />,
}))

const verfuegbareStimme = {
  available: true,
  mode: 'legacy' as const,
  model: null,
  voice: null,
  language: 'auto',
  dictation_available: false,
  sample_rate: 24_000,
  max_seconds: 900,
}

describe('DocsChatPanel', () => {
  beforeEach(() => {
    rechte.aktiv = true
    vi.mocked(aiApi.getVoiceConfig).mockResolvedValue(verfuegbareStimme)
  })

  it('nutzt den bestehenden Chat mit Dokument-Scope und ohne Aufgaben/Guardian', async () => {
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
    expect(chatProps.aktuell?.beispielSchluessel).toEqual([
      'zusammenfassen',
      'pruefen',
      'gliedern',
    ])
    await waitFor(() => expect(chatProps.aktuell?.hasVoice).toBe(true))
  })

  it('bietet keinen Sprachmodus an, wenn die Konfiguration nicht verfügbar ist', async () => {
    vi.mocked(aiApi.getVoiceConfig).mockResolvedValue({
      ...verfuegbareStimme,
      available: false,
    })
    render(
      <MemoryRouter>
        <DocsChatPanel uid="doc-1" />
      </MemoryRouter>,
    )

    await waitFor(() => expect(chatProps.aktuell?.hasVoice).toBe(false))
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
