import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { eigener } = vi.hoisted(() => ({ eigener: vi.fn(() => false) }))
vi.mock('@/services/passkeyService', () => ({
  istEigenerBestaetigungsClient: eigener,
}))

import i18n from '@/i18n'
import { PasskeyFernBestaetigung } from './PasskeyFernBestaetigung'
import { useBrowserBestaetigung } from '@/stores/browserBestaetigung'

function melde(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent('msm:sync-event', { detail }))
  })
}

describe('PasskeyFernBestaetigung', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    eigener.mockReturnValue(false)
    useBrowserBestaetigung.setState({ offen: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('zeigt einen Hinweis für ein anderes Fenster und öffnet die Bestätigungsseite', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    render(<PasskeyFernBestaetigung />)

    melde({
      type: 'passkey_bestaetigung',
      client: 'anderes-fenster',
      vorgang: 'v'.repeat(32),
      url: `https://panel.example/bestaetigen#${'v'.repeat(32)}`,
    })

    expect(screen.getByRole('status')).toHaveTextContent('Bestätigung angefordert')
    fireEvent.click(screen.getByRole('button', { name: 'Im Browser bestätigen' }))
    expect(open).toHaveBeenCalledWith(
      `https://panel.example/bestaetigen#${'v'.repeat(32)}`,
      '_blank',
      'noopener,noreferrer',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('ignoriert das eigene Ereignis und lässt sich später ausblenden', () => {
    eigener.mockReturnValue(true)
    render(<PasskeyFernBestaetigung />)

    melde({ type: 'passkey_bestaetigung', client: 'eigenes', vorgang: 'v'.repeat(32), url: 'https://panel.example/bestaetigen#x' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    eigener.mockReturnValue(false)
    melde({ type: 'passkey_bestaetigung', client: 'anderes', vorgang: 'w'.repeat(32), url: 'https://panel.example/bestaetigen#y' })
    fireEvent.click(screen.getByRole('button', { name: 'Später' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
