import { beforeEach, describe, expect, it, vi } from 'vitest'

const speicher = vi.hoisted(() => ({
  legeSteuerAuftragAn: vi.fn(async () => true),
  schreibeSteuerAuftrag: vi.fn(async () => {}),
  loescheSteuerAuftrag: vi.fn(async () => {}),
  loadLocalMessages: vi.fn(async () => []),
  updateMessageInLocalStore: vi.fn(async () => {}),
}))
vi.mock('./messengerLocalStore', () => speicher)
vi.mock('./nachrichtAnheftung', () => ({
  anheftung: vi.fn(() => ({ clientUuid: '', stand: '' })),
  setzeAnheftung: vi.fn(),
}))
vi.mock('./nachrichtVerfall', () => ({
  verfallStand: vi.fn(() => ({ sekunden: 0, stand: '' })),
  setzeVerfallsfrist: vi.fn(),
}))

import { sendeWirkungMitOutbox, type Wirkungsziel } from './steuerOutbox'
import { SteuerAbgewiesenError, SteuerOutboxVollError } from './wirkungTypen'

const ZIEL: Wirkungsziel = {
  mailbox: 'direct:peer:2',
  chatType: 'direct',
  chatId: 2,
  peerId: 2,
  mitglieder: [1, 2],
}

const EINTRAG = {
  typ: 'reaction',
  felder: { emoji: '👍', target_id: 7 },
  ziel: 'u-1',
  zielId: 7,
}

beforeEach(() => {
  vi.clearAllMocks()
  speicher.legeSteuerAuftragAn.mockResolvedValue(true)
})

describe('Wirkungs-Outbox', () => {
  it('sendet sofort und reiht bei Erfolg nichts ein', async () => {
    const senden = vi.fn(async () => {})
    await expect(sendeWirkungMitOutbox(ZIEL, EINTRAG, senden)).resolves.toBe('gesendet')
    expect(speicher.legeSteuerAuftragAn).not.toHaveBeenCalled()
  })

  it('reiht einen Netzfehler mit Ziel und Rohfeldern ein', async () => {
    const senden = vi.fn(async () => {
      throw new Error('offline')
    })

    await expect(sendeWirkungMitOutbox(ZIEL, EINTRAG, senden)).resolves.toBe('eingereiht')
    expect(speicher.legeSteuerAuftragAn).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox: 'direct:peer:2',
        art: 'direkt',
        chatType: 'direct',
        chatId: 2,
        typ: 'reaction',
        ziel: 'u-1',
        zielId: 7,
        felder: EINTRAG.felder,
      }),
    )
  })

  it('wirft eine endgültige Ablehnung, statt sie einzureihen', async () => {
    const senden = vi.fn(async () => {
      throw Object.assign(new Error('kein Zugriff'), { status: 403 })
    })

    await expect(sendeWirkungMitOutbox(ZIEL, EINTRAG, senden)).rejects.toBeInstanceOf(
      SteuerAbgewiesenError,
    )
    expect(speicher.legeSteuerAuftragAn).not.toHaveBeenCalled()
  })

  it('meldet eine volle Outbox, statt still zu verdrängen', async () => {
    speicher.legeSteuerAuftragAn.mockResolvedValueOnce(false)
    const senden = vi.fn(async () => {
      throw new Error('offline')
    })

    await expect(sendeWirkungMitOutbox(ZIEL, EINTRAG, senden)).rejects.toBeInstanceOf(
      SteuerOutboxVollError,
    )
  })
})
