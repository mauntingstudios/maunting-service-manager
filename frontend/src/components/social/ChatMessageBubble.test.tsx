import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import i18n from '@/i18n'

const einladungsApi = vi.hoisted(() => ({ getGroupInviteInfo: vi.fn() }))
vi.mock('@/api/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/social')>()),
  getGroupInviteInfo: einladungsApi.getGroupInviteInfo,
}))
import {
  ChatMessageBubble,
  MessageErrorBoundary,
  safeFormatDate,
  safeFormatTime,
  type ChatMessage,
} from './ChatMessageBubble'

describe('ChatMessageBubble Resilienz & Fehlerbehandlung', () => {
  describe('safeFormatDate & safeFormatTime', () => {
    it('formatiert gueltige Datumsangaben', () => {
      const validIso = '2026-09-25T14:30:00.000Z'
      expect(safeFormatDate(validIso)).not.toBe('')
      expect(safeFormatTime(validIso)).not.toBe('')
    })

    it('faengt ungueltige Datumsangaben ab ohne RangeError zu werfen', () => {
      expect(safeFormatDate('invalid-date')).toBe('')
      expect(safeFormatDate(null)).toBe('')
      expect(safeFormatDate(undefined, {}, 'Fallback')).toBe('Fallback')

      expect(safeFormatTime('invalid-date')).toBe('')
      expect(safeFormatTime(null)).toBe('')
      expect(safeFormatTime(undefined, {}, 'Fallback')).toBe('Fallback')
    })
  })

  describe('MessageErrorBoundary', () => {
    it('faengt Rendering-Fehler ab und rendert die Fallback-Anzeige', () => {
      const ProblemKind = () => {
        throw new Error('Explosion beim Rendern')
      }

      // Suppress React error boundary console output in test
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      render(
        <MessageErrorBoundary>
          <ProblemKind />
        </MessageErrorBoundary>
      )

      expect(screen.getByText('Nachricht konnte nicht dargestellt werden')).toBeDefined()
      spy.mockRestore()
    })
  })

  describe('ChatMessageBubble Rendering mit korrupten Daten', () => {
    const defaultKontext = {
      activeGroup: null,
      activeContact: { username: 'Bob' },
      eigeneId: 1,
      eigenerName: 'Alice',
      readReceiptsEnabled: true,
      importedAttachmentIds: new Set<string>(),
    }

    const defaultAktionen = {
      onReagieren: vi.fn(),
      onAntworten: vi.fn(),
      onWeiterleiten: vi.fn(),
      onKopieren: vi.fn(),
      onBearbeiten: vi.fn(),
      onLoeschen: vi.fn(),
      onMarkieren: vi.fn(),
      onAnheften: vi.fn(),
      onAuswaehlen: vi.fn(),
      onMenue: vi.fn(),
      onSpringeZu: vi.fn(),
      onViewImage: vi.fn(),
      onImportNote: vi.fn(),
      onImportCalendar: vi.fn(),
      onJoinByInviteCode: vi.fn(),
    }

    const defaultTon = {
      playingAudioId: null,
      audioCurrentTime: 0,
      audioPlaybackRate: 1,
      onTogglePlay: vi.fn(),
      onCycleRate: vi.fn(),
      onSeek: vi.fn(),
    }

    const defaultAuswahl = {
      aktiv: false,
      gewaehlt: false,
      onUmschalten: vi.fn(),
    }

    it('zeigt in Gruppen keine Quittungshaken, im Direktchat schon', () => {
      // Gruppen verschicken seit 26.09.2026 keine Quittungen mehr. Ein
      // einzelner Haken hiesse dort „noch nicht zugestellt“.
      const eigene: ChatMessage = {
        id: 5,
        senderId: 1,
        text: 'Von mir',
        createdAt: '2026-09-25T14:30:00.000Z',
        isSelf: true,
        isRead: true,
        isDelivered: true,
      }
      const zeige = (kontext: typeof defaultKontext, msg: ChatMessage = eigene) =>
        render(
          <ChatMessageBubble
            msg={msg}
            kontext={kontext}
            ton={defaultTon}
            aktionen={defaultAktionen}
            auswahl={defaultAuswahl}
            medienBindung={() => ({} as any)}
          />
        )
      const gruppe = { ...defaultKontext, activeGroup: { id: 77, name: 'Gruppe', members: [] } as any }

      const imDirektchat = zeige(defaultKontext)
      expect(screen.getByRole('img', { name: i18n.t('messenger.stateRead') })).toBeDefined()
      imDirektchat.unmount()

      const inDerGruppe = zeige(gruppe)
      expect(screen.queryByRole('img', { name: i18n.t('messenger.stateRead') })).toBeNull()
      expect(screen.queryByRole('img', { name: i18n.t('messenger.stateUndelivered') })).toBeNull()
      inDerGruppe.unmount()

      // Die Uhr für „wartet noch“ bleibt auch in der Gruppe.
      zeige(gruppe, { ...eigene, isRead: false, status: 'queued' })
      expect(screen.getByRole('img', { name: i18n.t('messenger.stateQueued') })).toBeDefined()
    })

    it('antwortet nicht, wenn der Wisch am Rand beginnt', () => {
      // Dort gehört die waagerechte Bewegung dem Zurückgehen. Bis 27.10.2026
      // antwortete die Blase mit und der Chat schloss gleichzeitig.
      const onAntworten = vi.fn()
      const msg: ChatMessage = {
        id: 81,
        senderId: 1,
        text: 'Hallo',
        createdAt: '2026-09-25T14:30:00.000Z',
        isSelf: false,
      }
      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={{ ...defaultAktionen, onAntworten }}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )

      const text = screen.getByText('Hallo')
      fireEvent.pointerDown(text, { pointerType: 'touch', clientX: 4, clientY: 300 })
      fireEvent.pointerUp(text, { pointerType: 'touch', clientX: 160, clientY: 302 })
      expect(onAntworten).not.toHaveBeenCalled()

      // In der Mitte antwortet sie weiterhin.
      fireEvent.pointerDown(text, { pointerType: 'touch', clientX: 400, clientY: 300 })
      fireEvent.pointerUp(text, { pointerType: 'touch', clientX: 560, clientY: 302 })
      expect(onAntworten).toHaveBeenCalledTimes(1)
    })

    it('zeigt eine Einladung als Karte und blendet den rohen Link optional ein', async () => {
      einladungsApi.getGroupInviteInfo.mockResolvedValue({
        group_id: 7,
        name: 'Serverteam',
        description: null,
        avatar_url: null,
        member_count: 4,
        live_call: false,
        live_participants: 0,
      })
      const link = `${window.location.origin}/chat/join/AbCd1234efGH#k=${'a'.repeat(64)}`
      const msg: ChatMessage = {
        id: 80,
        senderId: 2,
        text: link,
        createdAt: '2026-09-25T14:30:00.000Z',
        isSelf: false,
      }

      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )

      expect(await screen.findByText('Serverteam')).toBeInTheDocument()
      expect(screen.queryByText(link)).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: i18n.t('messenger.showInviteLink') }))
      expect(screen.getByText(link)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: i18n.t('messenger.hideInviteLink') }))
      expect(screen.queryByText(link)).toBeNull()
    })

    it('macht aus einer gescheiterten Nachricht einen Knopf zum erneuten Senden', () => {
      const onErneutSenden = vi.fn()
      const msg: ChatMessage = {
        id: 77,
        senderId: 1,
        text: 'Kam nie an',
        createdAt: '2026-09-25T14:30:00.000Z',
        isSelf: true,
        status: 'failed',
      }

      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={{ ...defaultAktionen, onErneutSenden }}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )

      // Der Text bleibt stehen — das ist der Unterschied zwischen „nicht
      // angekommen" und „verloren".
      expect(screen.getByText('Kam nie an')).toBeInTheDocument()
      fireEvent.click(
        screen.getByRole('button', { name: i18n.t('messenger.stateFailedRetry') }),
      )
      expect(onErneutSenden).toHaveBeenCalledWith(msg)
    })

    it('setzt kein natives title, die Hinweise stehen als Kurzinfo da', () => {
      // Das Betriebssystem zeichnete title-Tooltips verspätet, im eigenen Stil
      // und am Finger nie (AGENTS.md Punkt 4).
      const msg = {
        id: 9,
        senderId: 1,
        text: 'Alles drin',
        createdAt: '2026-09-25T14:30:00.000Z',
        isSelf: true,
        isDelivered: true,
        antwortAuf: { clientUuid: 'ref-9', absenderId: 2, auszug: 'Vorher' },
        noteAttachment: { title: 'Notiz', content: 'Inhalt' },
        calendarAttachment: { title: 'Termin', start: '2026-09-26T10:00:00Z', end: '2026-09-26T11:00:00Z' },
        stickerAttachment: { svg: '<svg></svg>', label: 'Herz' },
        audioAttachment: { durationSeconds: 4 },
      } as unknown as ChatMessage
      const { container } = render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(container.querySelectorAll('[title]')).toHaveLength(0)
      expect(screen.getByRole('button', { name: i18n.t('messenger.messageActions') })).toBeDefined()
      expect(screen.getByRole('img', { name: i18n.t('messenger.stateDelivered') })).toBeDefined()
      expect(container.querySelector(`[aria-description="${i18n.t('messenger.takeNote')}"]`)).not.toBeNull()
    })

    it('zeigt bei einem Mixer-Sticker kein Label, aber einen Namen', () => {
      // Die Emoji-Folge steht bei Mixes nur im aria-label; unter dem Bild wäre
      // sie doppelt und würde den Sticker kleiner wirken lassen.
      const msg = {
        id: 10,
        senderId: 1,
        text: '',
        createdAt: '2026-11-10T10:00:00.000Z',
        isSelf: true,
        stickerAttachment: {
          id: 'mix-abc',
          label: '🔥🐱',
          svg: '<svg viewBox="0 0 128 128"><rect width="128" height="128"/></svg>',
          mix: true,
        },
      } as unknown as ChatMessage
      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(screen.getByRole('img', { name: '🔥🐱' })).toBeInTheDocument()
      expect(screen.queryByText('🔥🐱')).toBeNull()
    })

    it('zeigt einen System-Sticker aus dem festen Katalog', () => {
      // Die Nutzlast trägt nur die Kennung; das Bild kommt aus dem Programm,
      // damit keine fremde Adresse aus einer Nachricht geladen wird.
      const msg = {
        id: 12,
        senderId: 1,
        text: '',
        createdAt: '2026-11-10T10:00:00.000Z',
        isSelf: true,
        stickerAttachment: { id: 'sys-emotes-hello-wave', label: 'Winkende Hand' },
      } as unknown as ChatMessage
      const { container } = render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(container.querySelector('img[src="/stickers/emotes/01_hello_wave.png"]')).not.toBeNull()
      expect(screen.getByRole('img', { name: 'Winkende Hand' })).toBeInTheDocument()
      expect(screen.queryByText('Winkende Hand')).toBeNull()
    })

    it('zeigt einen Foto-Sticker aus eingebetteten Bilddaten', () => {
      const msg = {
        id: 13,
        senderId: 1,
        text: '',
        createdAt: '2026-11-10T10:00:00.000Z',
        isSelf: true,
        stickerAttachment: {
          id: 'bild-1',
          label: 'Hallo',
          bild: 'data:image/webp;base64,AAAA',
          mix: true,
        },
      } as unknown as ChatMessage
      const { container } = render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(container.querySelector('img[src="data:image/webp;base64,AAAA"]')).not.toBeNull()
      expect(screen.queryByText('Hallo')).toBeNull()
    })

    it('lädt kein Sticker-Bild aus einer fremden Adresse', () => {
      // Ein Bildpfad in der Nutzlast ist eine Angabe des Absenders. Nur
      // eingebettete Daten und der feste Systemkatalog werden angezeigt.
      const msg = {
        id: 14,
        senderId: 1,
        text: '',
        createdAt: '2026-11-10T10:00:00.000Z',
        isSelf: true,
        stickerAttachment: {
          id: 'bild-2',
          label: 'Fremd',
          bild: 'https://example.com/x.png',
          mix: true,
        },
      } as unknown as ChatMessage
      const { container } = render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(container.querySelector('img')).toBeNull()
    })

    it('zeigt kein SVG und kein übermäßig großes Sticker-Bild', () => {
      const baue = (bild: string) =>
        ({
          id: 15,
          senderId: 1,
          text: '',
          createdAt: '2026-11-10T10:00:00.000Z',
          isSelf: true,
          stickerAttachment: { id: 'bild-3', label: 'Fremd', bild, mix: true },
        }) as unknown as ChatMessage
      const { container, unmount } = render(
        <ChatMessageBubble
          msg={baue('data:image/svg+xml;base64,PHN2Zy8+')}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(container.querySelector('img')).toBeNull()
      unmount()

      const zuGross = `data:image/png;base64,${'A'.repeat(400_001)}`
      const zweite = render(
        <ChatMessageBubble
          msg={baue(zuGross)}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(zweite.container.querySelector('img')).toBeNull()
    })

    it('zeigt bei einem handgezeichneten Sticker weiter sein Label', () => {
      const msg = {
        id: 11,
        senderId: 1,
        text: '',
        createdAt: '2026-11-10T10:00:00.000Z',
        isSelf: true,
        stickerAttachment: {
          id: 'herz',
          label: 'Herz',
          svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
        },
      } as unknown as ChatMessage
      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )
      expect(screen.getByText('Herz')).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'Herz' })).toBeInTheDocument()
    })

    it('rendert ohne Absturz bei ungueltigem createdAt Zeitstempel', () => {
      const msg: ChatMessage = {
        id: 1,
        senderId: 2,
        text: 'Hallo Welt',
        createdAt: 'ungueltiges-datum',
        isSelf: false,
      }

      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )

      expect(screen.getByText('Hallo Welt')).toBeDefined()
    })

    it('rendert ohne Absturz bei ungueltigem calendarAttachment.start', () => {
      const msg: ChatMessage = {
        id: 2,
        senderId: 2,
        text: 'Termin',
        createdAt: '2026-09-25T12:00:00Z',
        isSelf: false,
        calendarAttachment: {
          title: 'Kaputter Termin',
          start: 'invalid-iso-date',
          end: 'invalid-iso-date',
          description: 'Test Beschreibung',
        },
      }

      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )

      expect(screen.getByText('Kaputter Termin')).toBeDefined()
    })

    it('rendert ohne Absturz wenn antwortAuf.auszug ein Objekt statt String ist', () => {
      const msg: ChatMessage = {
        id: 3,
        senderId: 2,
        text: 'Antwort auf Objekt',
        createdAt: '2026-09-25T12:00:00Z',
        isSelf: false,
        antwortAuf: {
          clientUuid: 'ref-1',
          absenderId: 1,
          auszug: { text: 'Injected Object Payload' } as any,
        },
      }

      render(
        <ChatMessageBubble
          msg={msg}
          kontext={defaultKontext}
          ton={defaultTon}
          aktionen={defaultAktionen}
          auswahl={defaultAuswahl}
          medienBindung={() => ({} as any)}
        />
      )

      expect(screen.getByText('Antwort auf Objekt')).toBeDefined()
      expect(screen.getByText('{"text":"Injected Object Payload"}')).toBeDefined()
    })
  })
})
