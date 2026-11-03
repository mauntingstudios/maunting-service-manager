import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessengerKontakte } from './useMessengerKontakte'

vi.mock('@/hooks/useKontaktdaten', () => ({ useKontaktdaten: vi.fn() }))
vi.mock('@/hooks/useStoryAnsicht', () => ({ useStoryAnsicht: vi.fn(() => ({})) }))
vi.mock('@/services/gespraechsListe', () => ({
  fuelleNamenNach: vi.fn(async () => false),
  zeigeGespraech: vi.fn(async () => {}),
}))

import { useKontaktdaten } from '@/hooks/useKontaktdaten'

function kontaktdaten(mitglieder: unknown[]) {
  vi.mocked(useKontaktdaten).mockReturnValue({
    friends: [],
    groups: [],
    setGroups: vi.fn(),
    teamMembers: mitglieder,
    publicUsers: [],
    directChats: [],
    versteckte: [],
    stories: [],
    setStories: vi.fn(),
    laden: vi.fn(),
    geladen: true,
  } as never)
}

describe('useMessengerKontakte', () => {
  // Stabile Referenz wie im echten Messenger: ein Inline-Pfeil ließe den
  // Mailbox-Effekt bei jedem Render erneut laufen — Endlosschleife.
  const gruppenTitel = () => 'g'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function starte() {
    return renderHook(() =>
      useMessengerKontakte({ currentUserId: 1, messengerGesperrt: false, gruppenTitel }),
    )
  }

  it('zeigt Teammitglieder mit deren Status statt dauerhaft unsichtbar', () => {
    kontaktdaten([
      {
        member: {
          user_id: 2, username: 'kollege', avatar_url: null,
          presence: { status: 'online', device_type: 'web', client: 'web', activity_key: 'chat' },
        },
        teamName: 'Betrieb',
      },
    ])

    const { result } = starte()
    expect(result.current.contactsList).toHaveLength(1)
    expect(result.current.contactsList[0]).toMatchObject({
      userId: 2,
      username: 'kollege',
      status: 'online',
      teamName: 'Betrieb',
    })
  })

  it('fällt ohne Anwesenheit auf unsichtbar zurück', () => {
    kontaktdaten([
      { member: { user_id: 3, username: 'stille', avatar_url: null }, teamName: 'Betrieb' },
    ])

    const { result } = starte()
    expect(result.current.contactsList[0].status).toBe('invisible')
  })
})
