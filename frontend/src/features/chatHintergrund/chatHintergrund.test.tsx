import 'fake-indexeddb/auto'

import { IDBFactory } from 'fake-indexeddb'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { Blatteintrag, Blattknopf } from '@/Singra/UI'
import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'
import { schliesseLokaleAblageFuerTest } from '@/services/messengerLocalStore'

vi.mock('@/stores/confirmStore', () => ({ confirm: vi.fn(async () => true) }))

import { ChatHintergrund } from './ChatHintergrund'
import { ChatHintergrundDialog } from './ChatHintergrundDialog'
import {
  hatDirekteHintergruende,
  hintergrundSchluessel,
  ladeChatHintergrund,
  ladeHintergrundFuerScope,
  speichereChatHintergrund,
  speichereHintergrundFuerScope,
  STANDARD_HINTERGRUND,
  wendeAufAlleDirektchatsAn,
} from './speicher'
import { HINTERGRUND_VORLAGEN } from './vorlagen'

beforeAll(async () => {
  await i18n.changeLanguage('de')
})

beforeEach(() => {
  ;(globalThis as any).indexedDB = new IDBFactory()
  localStorage.clear()
  setzeAngemeldetesKonto(1)
  schliesseLokaleAblageFuerTest()
})

/** Ein Fenster mit Knopf, wie es eine Fläche einbaut. */
function Probeflaeche({ bereich, peerId }: { bereich: 'messenger' | 'ki'; peerId?: number }) {
  const [offen, setzeOffen] = useState(false)
  return (
    <div className="relative">
      <ChatHintergrund bereich={bereich} peerId={peerId} />
      <button type="button" onClick={() => setzeOffen(true)}>
        einstellen
      </button>
      <ChatHintergrundDialog
        bereich={bereich}
        peerId={peerId}
        offen={offen}
        onOffenChange={setzeOffen}
      />
    </div>
  )
}

describe('Speicher', () => {
  it('hält die Bereiche auseinander', async () => {
    await speichereChatHintergrund('messenger', { preset: 'midnight', dimLevel: 40 })

    expect((await ladeChatHintergrund('messenger')).preset).toBe('midnight')
    expect(await ladeChatHintergrund('ki')).toEqual(STANDARD_HINTERGRUND)
  })

  it('übernimmt den alten Messenger-Schlüssel einmalig', async () => {
    // Genau die Form, die vor dem Umbau im Browser lag.
    localStorage.setItem(
      'msm_chat_wallpaper_config',
      JSON.stringify({ preset: 'petrol', dimLevel: 10 }),
    )

    expect(await ladeChatHintergrund('messenger')).toEqual({
      preset: 'petrol',
      customDataUrl: undefined,
      dimLevel: 10,
    })
    expect(localStorage.getItem('msm_chat_wallpaper_config')).toBeNull()
    expect((await ladeChatHintergrund('messenger')).preset).toBe('petrol')
  })

  it('überlebt die Klartext-Putzkolonne des Messengers', async () => {
    const { scrubPlaintextStorage } = await import('@/services/e2eeCrypto')

    await speichereChatHintergrund('messenger', { preset: 'midnight', dimLevel: 30 })
    await speichereChatHintergrund('ki', { preset: 'petrol', dimLevel: 5 })

    scrubPlaintextStorage()

    expect((await ladeChatHintergrund('messenger')).preset).toBe('midnight')
    expect((await ladeChatHintergrund('ki')).preset).toBe('petrol')
  })

  it('hält sich aus dem Namensraum der Putzkolonne heraus', () => {
    for (const bereich of ['messenger', 'ki'] as const) {
      expect(hintergrundSchluessel(bereich).startsWith('msm_chat_')).toBe(false)
    }
  })

  it('fällt auf den Standard zurück, wo nichts Brauchbares steht', async () => {
    localStorage.setItem(hintergrundSchluessel('ki'), '{kein json')
    expect(await ladeChatHintergrund('ki')).toEqual(STANDARD_HINTERGRUND)

    localStorage.setItem(hintergrundSchluessel('ki'), JSON.stringify({ preset: 'neon' }))
    expect((await ladeChatHintergrund('ki')).preset).toBe(STANDARD_HINTERGRUND.preset)

    // Ein „eigenes Bild" ohne Bild ist kein Hintergrund, sondern ein Loch.
    localStorage.setItem(
      hintergrundSchluessel('ki'),
      JSON.stringify({ preset: 'custom', dimLevel: 25 }),
    )
    expect((await ladeChatHintergrund('ki')).preset).toBe(STANDARD_HINTERGRUND.preset)
  })

  it('lässt einen Direktchat auf die globale Vorgabe zurückfallen', async () => {
    await speichereChatHintergrund('messenger', { preset: 'midnight', dimLevel: 20 })
    await speichereHintergrundFuerScope(
      { art: 'direkt', peerId: 7 },
      { preset: 'petrol', dimLevel: 30 },
    )

    expect((await ladeHintergrundFuerScope({ art: 'direkt', peerId: 7 })).preset).toBe('petrol')
    expect((await ladeHintergrundFuerScope({ art: 'direkt', peerId: 8 })).preset).toBe('midnight')
  })

  it('„für alle" schreibt die Vorgabe und entfernt direkte Ausnahmen', async () => {
    await speichereHintergrundFuerScope(
      { art: 'direkt', peerId: 7 },
      { preset: 'petrol', dimLevel: 30 },
    )
    expect(await hatDirekteHintergruende()).toBe(true)

    await speichereChatHintergrund('ki', { preset: 'petrol', dimLevel: 5 })
    await wendeAufAlleDirektchatsAn({ preset: 'minimal', dimLevel: 10 })

    expect(await hatDirekteHintergruende()).toBe(false)
    expect((await ladeChatHintergrund('ki')).preset).toBe('petrol')
    expect((await ladeHintergrundFuerScope({ art: 'direkt', peerId: 7 })).preset).toBe('minimal')
    expect((await ladeChatHintergrund('messenger')).preset).toBe('minimal')
  })

  it('gehört dem angemeldeten Konto, nicht dem Browser', async () => {
    await speichereChatHintergrund('ki', { preset: 'midnight', dimLevel: 10 })

    setzeAngemeldetesKonto(2)
    schliesseLokaleAblageFuerTest()
    expect(await ladeChatHintergrund('ki')).toEqual(STANDARD_HINTERGRUND)

    setzeAngemeldetesKonto(1)
    schliesseLokaleAblageFuerTest()
    expect((await ladeChatHintergrund('ki')).preset).toBe('midnight')
  })
})

describe('Schicht', () => {
  it('zeigt die gespeicherte Vorlage samt Abdunkelung', async () => {
    await speichereChatHintergrund('ki', { preset: 'petrol', dimLevel: 40 })
    const { container } = render(<ChatHintergrund bereich="ki" />)

    await waitFor(() =>
      expect(container.querySelector('[data-chat-hintergrund="petrol"]')).not.toBeNull(),
    )
    expect(container.querySelector('[data-chat-hintergrund-abdunkeln="40"]')).not.toBeNull()
  })

  it('folgt einer Änderung, ohne neu aufgebaut zu werden', async () => {
    const { container } = render(
      <>
        <ChatHintergrund bereich="ki" />
        <ChatHintergrund bereich="ki" />
      </>,
    )
    await waitFor(() =>
      expect(container.querySelectorAll('[data-chat-hintergrund="cyber"]')).toHaveLength(2),
    )

    await act(async () => {
      await speichereChatHintergrund('ki', { preset: 'midnight', dimLevel: 0 })
    })

    await waitFor(() =>
      expect(container.querySelectorAll('[data-chat-hintergrund="midnight"]')).toHaveLength(2),
    )
    expect(container.querySelector('[data-chat-hintergrund-abdunkeln]')).toBeNull()
  })

  it('lässt einen fremden Bereich in Ruhe', async () => {
    const { container } = render(<ChatHintergrund bereich="messenger" />)
    await waitFor(() =>
      expect(container.querySelector('[data-chat-hintergrund="cyber"]')).not.toBeNull(),
    )

    await act(async () => {
      await speichereChatHintergrund('ki', { preset: 'midnight', dimLevel: 0 })
    })

    expect(container.querySelector('[data-chat-hintergrund="cyber"]')).not.toBeNull()
  })
})

describe('Einstellungsfenster', () => {
  it('bietet jede Vorlage des Katalogs an', async () => {
    render(<Probeflaeche bereich="ki" />)
    fireEvent.click(screen.getByText('einstellen'))

    for (const vorlage of HINTERGRUND_VORLAGEN) {
      expect(await screen.findByText(i18n.t(vorlage.nameKey))).toBeInTheDocument()
    }
  })

  it('schreibt nur in seinen eigenen Bereich', async () => {
    await speichereChatHintergrund('messenger', { preset: 'petrol', dimLevel: 15 })

    render(<Probeflaeche bereich="ki" />)
    fireEvent.click(screen.getByText('einstellen'))
    fireEvent.click(await screen.findByText(i18n.t('social.wallpaper.midnight')))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.apply') }))

    await waitFor(async () =>
      expect((await ladeChatHintergrund('ki')).preset).toBe('midnight'),
    )
    expect((await ladeChatHintergrund('messenger')).preset).toBe('petrol')
  })

  it('zeigt die neue Wahl sofort auf der Fläche', async () => {
    const { container } = render(<Probeflaeche bereich="messenger" />)
    fireEvent.click(screen.getByText('einstellen'))
    fireEvent.click(await screen.findByText(i18n.t('social.wallpaper.minimal')))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.apply') }))

    await waitFor(() =>
      expect(container.querySelector('[data-chat-hintergrund="minimal"]')).not.toBeNull(),
    )
    expect(screen.queryByText(i18n.t('social.wallpaper.presets'))).not.toBeInTheDocument()
  })

  it('beginnt jedes Mal bei dem, was gespeichert ist', async () => {
    render(<Probeflaeche bereich="ki" />)

    fireEvent.click(screen.getByText('einstellen'))
    fireEvent.click(await screen.findByText(i18n.t('social.wallpaper.petrol')))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    fireEvent.click(screen.getByText('einstellen'))

    const kacheln = await screen.findAllByRole('button', { pressed: true })
    expect(kacheln).toHaveLength(1)
    expect(kacheln[0]).toHaveTextContent(i18n.t('social.wallpaper.cyber'))
  })

  it('setzt auf den Standard zurück', async () => {
    await speichereChatHintergrund('ki', { preset: 'midnight', dimLevel: 70 })

    render(<Probeflaeche bereich="ki" />)
    fireEvent.click(screen.getByText('einstellen'))
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('common.reset') }))

    await waitFor(async () =>
      expect(await ladeChatHintergrund('ki')).toEqual(STANDARD_HINTERGRUND),
    )
  })

  it('bietet „Für alle Chats" nur im Direktchat an', async () => {
    const { unmount } = render(<Probeflaeche bereich="messenger" />)
    fireEvent.click(screen.getByText('einstellen'))
    await screen.findByText(i18n.t('social.wallpaper.description'))
    expect(screen.queryByText(i18n.t('social.wallpaper.applyAll'))).toBeNull()
    unmount()

    render(<Probeflaeche bereich="messenger" peerId={7} />)
    fireEvent.click(screen.getByText('einstellen'))
    expect(await screen.findByText(i18n.t('social.wallpaper.applyAll'))).toBeInTheDocument()
  })

  it('wendet auf alle Chats an, wenn das Häkchen gesetzt ist', async () => {
    await speichereHintergrundFuerScope(
      { art: 'direkt', peerId: 7 },
      { preset: 'petrol', dimLevel: 10 },
    )
    render(<Probeflaeche bereich="messenger" peerId={7} />)
    fireEvent.click(screen.getByText('einstellen'))
    await screen.findByText(i18n.t('social.wallpaper.applyAll'))

    fireEvent.click(screen.getByText(i18n.t('social.wallpaper.applyAll')))
    fireEvent.click(screen.getByText(i18n.t('social.wallpaper.minimal')))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.apply') }))

    await waitFor(async () => expect(await hatDirekteHintergruende()).toBe(false))
    expect((await ladeChatHintergrund('messenger')).preset).toBe('minimal')
  })

  it('weist eine Datei ab, die kein Bild ist', async () => {
    render(<Probeflaeche bereich="ki" />)
    fireEvent.click(screen.getByText('einstellen'))
    await screen.findByText(i18n.t('social.wallpaper.own'))

    const feld = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(feld, {
      target: { files: [new File(['x'], 'notiz.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByText(i18n.t('social.wallpaper.badType'))).toBeInTheDocument()
    expect((await ladeChatHintergrund('ki')).preset).toBe(STANDARD_HINTERGRUND.preset)
  })
})

describe('Einstieg über das Blattmenü', () => {
  function Probemenue({ bereich }: { bereich: 'messenger' | 'ki' }) {
    const [offen, setzeOffen] = useState(false)
    return (
      <>
        <Blattknopf label="Weitere Einstellungen" titel="Chat">
          {(schliessen) => (
            <Blatteintrag
              label={i18n.t('social.wallpaper.title')}
              onClick={() => {
                schliessen()
                setzeOffen(true)
              }}
            />
          )}
        </Blattknopf>
        <ChatHintergrundDialog bereich={bereich} offen={offen} onOffenChange={setzeOffen} />
      </>
    )
  }

  it('öffnet das Fenster neben dem Menü, nicht darin', async () => {
    render(<Probemenue bereich="ki" />)
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Einstellungen' }))
    fireEvent.click(screen.getByText(i18n.t('social.wallpaper.title')))

    expect(await screen.findByText(i18n.t('social.wallpaper.presets'))).toBeInTheDocument()
    expect(screen.getAllByText(i18n.t('social.wallpaper.title'))).toHaveLength(1)
  })
})
