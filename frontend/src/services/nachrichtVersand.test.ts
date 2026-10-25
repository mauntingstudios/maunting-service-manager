import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Versandauftrag } from '@/hooks/useKonversation'

/**
 * Die Schritte beim Senden, ohne die Seite drumherum.
 *
 * Upload und Relais sind Attrappen: ob ein Paket richtig verschlüsselt wird,
 * prüfen `medienKrypto.test.ts` und `circularVideoNotes.test.ts`. Hier geht es
 * darum, was mit dem Ergebnis passiert, und was, wenn es ausbleibt.
 */

vi.mock('@/api/social', () => ({
  ladeAnhangHoch: vi.fn(),
}))

vi.mock('@/services/messengerSocket', () => ({
  messengerSocket: { sendChatMessage: vi.fn() },
}))

vi.mock('@/lib/offlineSync', () => ({
  enqueueMessageMutation: vi.fn(),
}))

import { ladeAnhangHoch } from '@/api/social'
import { enqueueMessageMutation } from '@/lib/offlineSync'
import { messengerSocket } from '@/services/messengerSocket'
import { chatMediaBlobCache } from './klartextSpeicher'
import { baueNutzlast, ladeAnhaengeHoch, stelleZu, type Nutzlastangaben } from './nachrichtVersand'

const sendChatMessage = vi.mocked(messengerSocket.sendChatMessage)

const hochladen = vi.mocked(ladeAnhangHoch)
const einreihen = vi.mocked(enqueueMessageMutation)

const BINDUNG = { blindMailboxId: 'mb-gespraech', chatType: 'group' as const, chatId: 3, absenderId: 7 }

let naechsterZeiger = 1
function zeiger() {
  const n = naechsterZeiger++
  return { mediaId: `medium-${n}`, paketSchluessel: `paket-${n}`, fileId: `datei-${n}` }
}

beforeEach(() => {
  vi.clearAllMocks()
  chatMediaBlobCache.clear()
  naechsterZeiger = 1
  hochladen.mockImplementation(async () => zeiger())
})

describe('baueNutzlast', () => {
  const grund: Nutzlastangaben = {
    clientUuid: 'u-1',
    absenderId: 7,
    absenderName: 'anna',
    text: 'hallo',
    zeitpunkt: '2026-09-24T10:00:00.000Z',
    erwaehnt: {},
  }

  it('setzt nur, was es gibt', () => {
    const nutzlast = baueNutzlast({
      ...grund,
      bezug: null,
      weitergeleitet: false,
      erwaehnt: { erwaehnungen: [] },
    })
    expect(nutzlast).toEqual({
      client_uuid: 'u-1',
      sender_id: 7,
      sender_name: 'anna',
      text: 'hallo',
      timestamp: '2026-09-24T10:00:00.000Z',
    })
    expect(Object.values(nutzlast)).not.toContain(undefined)
  })

  it('trägt Augenblick und Wiederherstellung unter eigenen Feldern', () => {
    const augenblick = { zeitpunkt: '2026-09-24T10:00:00.000Z' }
    const funkenRettung = { zeitpunkt: '2026-09-24T10:00:00.000Z', verloren: 12 }
    expect(baueNutzlast({ ...grund, augenblick }).augenblick).toEqual(augenblick)
    expect(baueNutzlast({ ...grund, funkenRettung }).funken_rettung).toEqual(funkenRettung)
    // Ohne Marke kein Feld: ein gewöhnliches Foto verrät nicht, dass es
    // Funken gibt.
    expect(Object.keys(baueNutzlast(grund))).not.toContain('augenblick')
  })

  it('nimmt den Zeitpunkt, der übergeben wurde, nicht die Uhr beim Bauen', () => {
    // Zwischen Abschicken und Bauen liegt der Upload; der kann dauern.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    try {
      expect(baueNutzlast(grund).timestamp).toBe('2026-09-24T10:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hält die Reihenfolge der Felder, in der sie immer standen', () => {
    const nutzlast = baueNutzlast({
      ...grund,
      bezug: { clientUuid: 'u-0', absenderId: 9, auszug: 'davor' },
      weitergeleitet: true,
      erwaehnt: { erwaehnungen: [9], erwaehntAlle: true },
      verfaelltAm: '2026-09-25T10:00:00.000Z',
      note: { title: 'n', content: 'c' },
      cal: { title: 't', start: 's', end: 'e' },
      sticker: { id: 's', label: 'l', svg: '<svg/>' },
      storyReply: { storyContent: 'story' },
      finalImg: { name: 'bild.png' },
      finalFile: { name: 'a.pdf', sizeBytes: 1, mimeType: 'application/pdf' },
      finalAudio: { ...zeiger(), durationSeconds: 2, mimeType: 'audio/webm' },
      finalVideoNote: { ...zeiger(), durationSeconds: 3, width: 1, height: 1, mimeType: 'video/webm' },
    })
    expect(Object.keys(nutzlast)).toEqual([
      'client_uuid',
      'sender_id',
      'sender_name',
      'text',
      'timestamp',
      'antwort_auf',
      'weitergeleitet',
      'erwaehnungen',
      'erwaehnt_alle',
      'verfaellt_am',
      'note_attachment',
      'calendar_attachment',
      'image_attachment',
      'audio_attachment',
      'file_attachment',
      'sticker_attachment',
      'story_reply',
      'video_note_attachment',
    ])
    expect(nutzlast.erwaehnungen).toEqual([9])
    expect(nutzlast.verfaellt_am).toBe('2026-09-25T10:00:00.000Z')
  })
})

describe('ladeAnhaengeHoch', () => {
  it('lädt nichts hoch, wenn es nichts gibt', async () => {
    expect(await ladeAnhaengeHoch({}, BINDUNG)).toEqual({
      finalImg: undefined,
      finalFile: undefined,
      finalAudio: undefined,
      finalVideoNote: undefined,
    })
    expect(hochladen).not.toHaveBeenCalled()
  })

  it('bindet jeden Upload an Gespräch, Absender und Gruppe', async () => {
    await ladeAnhaengeHoch({ img: { dataUrl: 'data:image/jpeg;base64,AAAA', name: 'foto.jpg' } }, BINDUNG)
    expect(hochladen).toHaveBeenCalledWith({
      klartext: 'data:image/jpeg;base64,AAAA',
      dateiname: 'foto.jpg',
      mimeType: 'image/jpeg',
      blindMailboxId: 'mb-gespraech',
      absenderId: 7,
      chatType: 'group',
      chatId: 3,
      expiresAt: null,
    })
  })

  it('schickt ein Bild nur als Zeiger weiter, nie mit seinem Inhalt', async () => {
    const { finalImg } = await ladeAnhaengeHoch(
      { img: { dataUrl: 'data:image/png;base64,AAAA', name: 'bild.png' } },
      BINDUNG,
    )
    expect(finalImg).toEqual({ mediaId: 'medium-1', paketSchluessel: 'paket-1', fileId: 'datei-1', name: 'bild.png' })
    expect(chatMediaBlobCache.get('medium-1')).toBe('data:image/png;base64,AAAA')
  })

  it('lädt ein schon hochgeladenes Bild nicht noch einmal hoch', async () => {
    const { finalImg } = await ladeAnhaengeHoch(
      {
        img: {
          mediaId: 'alt',
          paketSchluessel: 'paket-alt',
          fileId: 'datei-alt',
          name: 'weiter.png',
          dataUrl: 'data:image/png;base64,AAAA',
        },
      },
      BINDUNG,
    )
    expect(hochladen).not.toHaveBeenCalled()
    expect(finalImg).toEqual({ mediaId: 'alt', paketSchluessel: 'paket-alt', fileId: 'datei-alt', name: 'weiter.png' })
  })

  it('schickt Bild und Datei nur mit ihrem Namen, wenn der Upload scheitert', async () => {
    hochladen.mockRejectedValue(new Error('offline'))
    const { finalImg, finalFile } = await ladeAnhaengeHoch(
      {
        img: { dataUrl: 'data:image/png;base64,AAAA', name: 'bild.png' },
        file: { dataUrl: 'data:application/pdf;base64,AAAA', name: 'a.pdf', sizeBytes: 3, mimeType: 'application/pdf' },
      },
      BINDUNG,
    )
    expect(finalImg).toEqual({ name: 'bild.png' })
    expect(finalFile).toEqual({ name: 'a.pdf', sizeBytes: 3, mimeType: 'application/pdf' })
    expect(chatMediaBlobCache.size).toBe(0)
  })

  it('bricht bei einer Sprachnachricht ab, wenn der Upload scheitert', async () => {
    hochladen.mockRejectedValue(new Error('offline'))
    await expect(
      ladeAnhaengeHoch(
        { audio: { dataUrl: 'data:audio/webm;base64,AAAA', durationSeconds: 2, mimeType: 'audio/webm' } },
        BINDUNG,
      ),
    ).rejects.toThrow('offline')
  })

  it('bricht bei einer Videonotiz ab, wenn der Upload scheitert', async () => {
    hochladen.mockRejectedValue(new Error('offline'))
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' })
    await expect(
      ladeAnhaengeHoch(
        { videoNote: { blob, durationSeconds: 3, width: 240, height: 240, mimeType: 'video/webm' } },
        BINDUNG,
      ),
    ).rejects.toThrow('offline')
  })

  it('lädt die Videonotiz als Data-URL hoch und gibt ihre Masse mit', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' })
    const { finalVideoNote } = await ladeAnhaengeHoch(
      { videoNote: { blob, durationSeconds: 3, width: 240, height: 320, mimeType: 'video/webm' } },
      BINDUNG,
    )
    const aufruf = hochladen.mock.calls[0][0]
    expect(aufruf.klartext).toBe('data:video/webm;base64,AQID')
    expect(aufruf.dateiname).toBe('videonotiz.webm')
    expect(finalVideoNote).toEqual({
      mediaId: 'medium-1',
      paketSchluessel: 'paket-1',
      fileId: 'datei-1',
      durationSeconds: 3,
      width: 240,
      height: 320,
      mimeType: 'video/webm',
    })
    expect(chatMediaBlobCache.get('medium-1')).toBe('data:video/webm;base64,AQID')
  })
})

describe('stelleZu', () => {
  function auftrag(extra: Partial<Versandauftrag> = {}): Versandauftrag {
    return {
      blind_mailbox_id: 'direct:peer:5',
      ciphertext_envelope: 'chiffrat',
      client_uuid: 'u-1',
      chat_type: 'direct',
      chat_id: '5',
      key_version: 1,
      ...extra,
    }
  }

  beforeEach(() => {
    sendChatMessage.mockReset()
    sendChatMessage.mockResolvedValue({ id: 42 } as never)
  })

  it('schickt die Nachricht genau einmal und nennt die echte Serverkennung', async () => {
    const ergebnis = await stelleZu([auftrag()])
    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    expect(sendChatMessage).toHaveBeenCalledWith({
      chat_type: 'direct',
      chat_id: 5,
      client_uuid: 'u-1',
      key_version: 1,
      encrypted_payload: 'chiffrat',
    })
    expect(ergebnis).toEqual({ niedrigsteId: 42, verbindungsfehler: false, ueberInbox: false })
    expect(einreihen).not.toHaveBeenCalled()
  })

  it('sendet nie zwei Kopien derselben Nachricht', async () => {
    // Frueher gingen Aufbau und Nachricht als zwei Umschlaege hinaus; der
    // zweite Versand derselben Kennung war die Doppelmeldung.
    await stelleZu([auftrag(), auftrag({ client_uuid: 'u-2' })])
    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    expect(sendChatMessage.mock.calls[0][0].client_uuid).toBe('u-1')
  })

  it('schickt nichts ohne Chat, Version und Kennung', async () => {
    expect(await stelleZu([auftrag({ chat_id: undefined })])).toEqual({
      niedrigsteId: 0, verbindungsfehler: false, ueberInbox: false,
    })
    expect(sendChatMessage).not.toHaveBeenCalled()
  })

  it('reiht bei einem Netzwerkfehler mit allen Angaben in die Outbox ein', async () => {
    sendChatMessage.mockRejectedValue(new Error('offline'))
    const ergebnis = await stelleZu([auftrag()])
    expect(ergebnis).toEqual({ niedrigsteId: 0, verbindungsfehler: true, ueberInbox: false })
    expect(einreihen).toHaveBeenCalledWith({
      blind_mailbox_id: 'direct:peer:5',
      chat_type: 'direct',
      chat_id: '5',
      key_version: 1,
      encrypted_payload: 'chiffrat',
      client_uuid: 'u-1',
    })
  })

  it('reiht auch bei einem Serverfehler ein', async () => {
    sendChatMessage.mockRejectedValue(Object.assign(new Error('kaputt'), { status: 503 }))
    expect((await stelleZu([auftrag()])).verbindungsfehler).toBe(true)
    expect(einreihen).toHaveBeenCalledTimes(1)
  })

  it('wirft bei einer endgueltigen Ablehnung und reiht nicht ein', async () => {
    sendChatMessage.mockRejectedValue(Object.assign(new Error('abgelehnt'), { status: 400 }))
    await expect(stelleZu([auftrag()])).rejects.toThrow('abgelehnt')
    expect(einreihen).not.toHaveBeenCalled()
  })

  it('gibt einen fehlenden Chat-Schluessel (409) weiter, statt ihn zu verschlucken', async () => {
    sendChatMessage.mockRejectedValue(Object.assign(new Error('kein schluessel'), { status: 409 }))
    await expect(stelleZu([auftrag()])).rejects.toThrow('kein schluessel')
    expect(einreihen).not.toHaveBeenCalled()
  })
})
