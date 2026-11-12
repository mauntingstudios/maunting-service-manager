import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve(null) }))

vi.mock('../seite/start/walletEinstieg', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../seite/start/walletEinstieg')>()
  return { ...orig, walletOeffnenAnfragen: vi.fn() }
})

const { SuchEingabeLeiste } = await import('./SuchEingabeLeiste')
const { walletOeffnenAnfragen } = await import('../seite/start/walletEinstieg')
const { useSitzung } = await import('../services/sitzung')

const zeigen = (onSuchen = vi.fn()) => render(<SuchEingabeLeiste onSuchen={onSuchen} />)
// Mit Text erscheint auch ein Such-Knopf mit demselben Namen — das Feld ist die Textbox.
const feld = () => screen.getByRole('textbox', { name: 'Suchen' })
const tippen = (text: string) => {
  fireEvent.focus(feld())
  fireEvent.change(feld(), { target: { value: text } })
}

beforeEach(() => {
  vi.mocked(walletOeffnenAnfragen).mockReset()
  useSitzung.setState({ stand: 'aus' })
})

describe('Suchleiste mit Wallet-Eintrag', () => {
  it('bietet bei „wallet“ das Öffnen an, auch ohne Servervorschläge', () => {
    zeigen()
    tippen('wallet')
    expect(screen.getByRole('button', { name: /Smartcard-Wallet öffnen/ })).toBeInTheDocument()
  })

  it('fragt beim Antippen über den Wallet-Einstieg an und schließt', () => {
    zeigen()
    tippen('smartcard')
    fireEvent.mouseDown(screen.getByRole('button', { name: /Smartcard-Wallet öffnen/ }))
    expect(walletOeffnenAnfragen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Smartcard-Wallet öffnen/ })).not.toBeInTheDocument()
  })

  it('zeigt sonst keinen Wallet-Eintrag und sucht wie bisher', () => {
    const onSuchen = vi.fn()
    zeigen(onSuchen)
    tippen('wetter')
    expect(screen.queryByRole('button', { name: /Smartcard-Wallet öffnen/ })).not.toBeInTheDocument()
    fireEvent.keyDown(feld(), { key: 'Enter' })
    expect(onSuchen).toHaveBeenCalledWith('wetter')
  })

  it('sendet während laufender IME-Komposition bei Enter nicht ab (isComposing und keyCode 229)', () => {
    const onSuchen = vi.fn()
    zeigen(onSuchen)
    tippen('nihongo')

    fireEvent.keyDown(feld(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(feld(), { key: 'Enter', keyCode: 229, which: 229 })
    expect(onSuchen).not.toHaveBeenCalled()

    fireEvent.keyDown(feld(), { key: 'Enter' })
    expect(onSuchen).toHaveBeenCalledWith('nihongo')
  })
})
