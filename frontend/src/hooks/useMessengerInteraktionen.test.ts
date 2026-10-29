import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import { useMessengerInteraktionen } from './useMessengerInteraktionen'

function bindung(chatType: 'direct' | 'group' | null, chatId: number | null) {
  const { result } = renderHook(() =>
    useMessengerInteraktionen({
      t: (schluessel: string) => schluessel,
      currentUserId: 2,
      blindMailboxId: 'direct:peer:2',
      chatType,
      chatId,
      activeGroup: null,
      angeheftet: null,
      setAngeheftet: vi.fn(),
      darfAnheften: true,
      weiterzuleiten: null,
      setWeiterzuleiten: vi.fn(),
      setWlFortschritt: vi.fn(),
      beendeAuswahl: vi.fn(),
      setMessages: vi.fn(),
      sendeWirkung: vi.fn(),
      handleSendMessage: vi.fn(),
    } as unknown as Parameters<typeof useMessengerInteraktionen>[0]),
  )
  return result.current.medienBindung
}

const empfangen: ChatMessage = {
  id: 5,
  clientUuid: 'eingehend-1',
  senderId: 7,
  senderName: 'peer',
  text: 'Hallo',
  createdAt: '2026-10-24T10:00:00.000Z',
  isSelf: false,
}

describe('Medienbindung im Gespraech', () => {
  it('bindet Direktchat-Anhaenge an die Serverkennung, nicht an die eigene Mailbox', () => {
    expect(bindung('direct', 55)(empfangen)).toEqual({
      absenderId: 7,
      blindMailboxId: 'direct:55',
    })
  })

  it('bindet Gruppenanhaenge genauso an die Serverkennung', () => {
    expect(bindung('group', 9)(empfangen)).toEqual({
      absenderId: 7,
      blindMailboxId: 'group:9',
    })
  })
})
