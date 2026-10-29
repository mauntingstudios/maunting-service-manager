/**
 * Die Bausteine des offenen Chats.
 *
 * Am wichtigsten ist das Menü: wer welchen Eintrag sieht. Der Server prüft
 * Löschen, Rollen und Logo ohnehin; das Menü soll aber nicht anbieten, was
 * ohne Recht sicher scheitert, und dem Eigentümer nie „Verlassen" statt
 * „Löschen" zeigen.
 */

import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { ChatMessage } from '@/components/social/ChatMessageBubble'
import { ChatActionsMenu, type MenueGruppe } from './ChatActionsMenu'
import { ChatPinnedBar } from './ChatPinnedBar'
import { ChatTimeline } from './ChatTimeline'

beforeAll(async () => {
  await i18n.changeLanguage('de')
})

function menue(teil: Partial<Parameters<typeof ChatActionsMenu>[0]> = {}) {
  const aktionen = {
    schliessen: vi.fn(),
    onStumm: vi.fn(),
    onProfil: vi.fn(),
    onSicherheitsnummer: vi.fn(),
    onVerfall: vi.fn(),
    onVideoanruf: vi.fn(),
    onHintergrund: vi.fn(),
    onEinladung: vi.fn(),
    onEinstellungen: vi.fn(),
    onLoeschen: vi.fn(),
    onVerlassen: vi.fn(),
    onBlockieren: vi.fn(),
    onChatEntfernen: vi.fn(),
  }
  render(
    <ChatActionsMenu
      stumm={false}
      kontakt={null}
      gruppe={null}
      verfallStufe="Aus"
      verfallErlaubt
      {...aktionen}
      {...teil}
    />,
  )
  return aktionen
}

const gruppe = (teil: Partial<MenueGruppe>): MenueGruppe => ({
  hatEinladung: false,
  istEigentuemer: false,
  istAdmin: false,
  ...teil,
})

const zeigt = (schluessel: string) => screen.queryByText(i18n.t(schluessel)) !== null

describe('ChatActionsMenu', () => {
  it('bietet dem Eigentümer die Einstellungen und Löschen, aber kein Verlassen', () => {
    menue({ gruppe: gruppe({ istEigentuemer: true }) })
    expect(zeigt('messenger.groupSettings')).toBe(true)
    expect(zeigt('messenger.deleteGroup')).toBe(true)
    expect(zeigt('messenger.leaveGroup')).toBe(false)
  })

  it('bietet einem Admin die Einstellungen, aber Verlassen statt Löschen', () => {
    menue({ gruppe: gruppe({ istAdmin: true }) })
    expect(zeigt('messenger.groupSettings')).toBe(true)
    expect(zeigt('messenger.deleteGroup')).toBe(false)
    expect(zeigt('messenger.leaveGroup')).toBe(true)
  })

  it('öffnet die Einstellungen auch einem einfachen Mitglied', () => {
    // Was es nicht darf, ist im Dialog deaktiviert. Mitglieder, Rollen und der
    // geteilte Hintergrund sind auch für sie lesbar.
    menue({ gruppe: gruppe({}) })
    expect(zeigt('messenger.groupSettings')).toBe(true)
    expect(zeigt('messenger.copyInvite')).toBe(false)
    expect(zeigt('messenger.leaveGroup')).toBe(true)
  })

  it('bietet Videoanruf nur unter Freunden, Sicherheitsnummer und Blockieren jedem Kontakt', () => {
    menue({ kontakt: { istFreund: false, blockiert: false } })
    expect(zeigt('messenger.videoCall')).toBe(false)
    expect(zeigt('messenger.verifySafetyNumber')).toBe(true)
    expect(zeigt('messenger.blockContact')).toBe(true)
  })

  it('öffnet im Direktchat das Profil, in der Gruppe gibt es keins', () => {
    const aktionen = menue({ kontakt: { istFreund: false, blockiert: false } })
    fireEvent.click(screen.getByText(i18n.t('social.profile.show')))
    expect(aktionen.onProfil).toHaveBeenCalledTimes(1)
    cleanup()
    menue({ gruppe: gruppe({}) })
    expect(zeigt('social.profile.show')).toBe(false)
  })

  it('bietet im Direktchat das Entfernen aus der Liste, in der Gruppe nicht', () => {
    const aktionen = menue({ kontakt: { istFreund: true, blockiert: false } })
    fireEvent.click(screen.getByText(i18n.t('messenger.removeChatFromList')))
    expect(aktionen.onChatEntfernen).toHaveBeenCalledTimes(1)
    cleanup()
    menue({ gruppe: gruppe({}) })
    expect(zeigt('messenger.removeChatFromList')).toBe(false)
  })

  it('zeigt bei einem Blockierten „Blockierung aufheben"', () => {
    menue({ kontakt: { istFreund: true, blockiert: true } })
    expect(zeigt('messenger.unblockContact')).toBe(true)
    expect(zeigt('messenger.videoCall')).toBe(true)
  })

  it('bietet ohne Postfach kein Stummschalten an', () => {
    menue({ stumm: null })
    expect(zeigt('messenger.mute')).toBe(false)
    expect(zeigt('messenger.unmute')).toBe(false)
  })

  it('sperrt die Frist ohne Recht und nennt den Grund', () => {
    menue({ verfallErlaubt: false, verfallStufe: '1 Tag' })
    const eintrag = screen.getByText(i18n.t('messenger.disappearingMessages')).closest('button')!
    expect(eintrag).toBeDisabled()
    expect(eintrag).toHaveTextContent(`1 Tag · ${i18n.t('messenger.retentionNoRight')}`)
  })

  it('schliesst das Blatt vor der Aktion', () => {
    const reihenfolge: string[] = []
    menue({
      gruppe: gruppe({ istEigentuemer: true }),
      schliessen: () => reihenfolge.push('schliessen'),
      onLoeschen: () => reihenfolge.push('loeschen'),
    })
    fireEvent.click(screen.getByText(i18n.t('messenger.deleteGroup')))
    expect(reihenfolge).toEqual(['schliessen', 'loeschen'])
  })

  it('hält Sprach- und Videoanruf sowie den Augenblick erreichbar', () => {
    // Sie standen bis 27.10.2026 als eigene Knöpfe im Kopf und nahmen dort dem
    // Namen den Platz. Erreichbar bleiben sie im Menü.
    menue({
      kontakt: { istFreund: true, blockiert: false },
      onSprachanruf: vi.fn(),
      onAugenblick: vi.fn(),
    })
    expect(zeigt('messenger.videoCall')).toBe(true)
    expect(zeigt('messenger.startVoiceCall')).toBe(true)
    expect(zeigt('messenger.moment.take')).toBe(true)
  })

  it('sperrt den Gruppenanruf ohne Recht und nennt den Grund', () => {
    menue({ gruppe: gruppe({}), onGruppenanruf: { erlaubt: false, onStarten: vi.fn() } })
    const eintrag = screen.getByText(i18n.t('messenger.startGroupCall')).closest('button')!
    expect(eintrag).toBeDisabled()
    expect(eintrag).toHaveTextContent(i18n.t('messenger.noStartCallRight'))
  })
})

describe('ChatPinnedBar', () => {
  it('hat ohne Recht keinen Lösen-Knopf', () => {
    render(<ChatPinnedBar text="Regeln" onOeffnen={() => {}} />)
    expect(screen.queryByLabelText(i18n.t('messenger.unpin'))).not.toBeInTheDocument()
  })

  it('löst, ohne zur Nachricht zu springen', () => {
    const onOeffnen = vi.fn()
    const onLoesen = vi.fn()
    render(<ChatPinnedBar text="Regeln" onOeffnen={onOeffnen} onLoesen={onLoesen} />)
    fireEvent.click(screen.getByLabelText(i18n.t('messenger.unpin')))
    expect(onLoesen).toHaveBeenCalledTimes(1)
    expect(onOeffnen).not.toHaveBeenCalled()
  })
})

describe('ChatTimeline', () => {
  /** Ein fester Vormittag: DST-fest, egal wann der Test läuft. */
  const mittag = (tageZurueck: number): Date => {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - tageZurueck)
    return d
  }
  const heute = mittag(0)
  const gestern = mittag(1)
  const nachricht = (id: number, datum: Date, teil: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    senderId: 2,
    text: `Nachricht ${id}`,
    createdAt: datum.toISOString(),
    isSelf: false,
    ...teil,
  })

  function zeichne(nachrichten: ChatMessage[], trennerId: number | null = null) {
    const zeichneNachricht = vi.fn((msg: ChatMessage) => <p>{msg.text}</p>)
    render(
      <ChatTimeline
        scrollRef={createRef()}
        endeRef={createRef()}
        nachrichten={nachrichten}
        laedt={false}
        trennerId={trennerId}
        aktivitaet={null}
        istGruppe={false}
        zeichneNachricht={zeichneNachricht}
      />,
    )
    return zeichneNachricht
  }

  it('setzt je Tag einen Datumstrenner und den Neu-Trenner vor die gemeinte Nachricht', () => {
    zeichne([nachricht(1, gestern), nachricht(2, gestern), nachricht(3, heute)], 3)
    expect(screen.getAllByText(i18n.t('messenger.yesterday'))).toHaveLength(1)
    expect(screen.getAllByText(i18n.t('messenger.today'))).toHaveLength(1)
    const neu = screen.getByText(i18n.t('messenger.newMessages'))
    // Der Trenner steht vor Nachricht 3, nicht vor 2.
    expect(neu.compareDocumentPosition(screen.getByText('Nachricht 3')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(neu.compareDocumentPosition(screen.getByText('Nachricht 2')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('zeigt den Tag auch dann, wenn er mit einer Systemzeile beginnt', () => {
    // Bis 27.10.2026 verbrauchte die Systemzeile den Tagesvergleich, ohne
    // selbst ein Datum zu tragen: der ganze Tag stand ohne Trenner da.
    zeichne([
      nachricht(1, gestern),
      nachricht(2, heute, { isSystem: true, text: 'Schlüssel geändert' }),
      nachricht(3, heute),
    ])
    expect(screen.getAllByText(i18n.t('messenger.today'))).toHaveLength(1)
    expect(screen.getAllByText(i18n.t('messenger.yesterday'))).toHaveLength(1)
  })

  it('lässt eine Zeile ohne brauchbares Datum ohne Trenner', () => {
    zeichne([nachricht(1, heute, { createdAt: 'kein-datum' }), nachricht(2, heute)])
    // Die zweite Zeile bekommt den Trenner, weil der Tag davor unbekannt war.
    expect(screen.getAllByText(i18n.t('messenger.today'))).toHaveLength(1)
  })

  it('zeichnet eine Systemzeile nie als Sprechblase', () => {
    const zeichneNachricht = zeichne([nachricht(1, heute, { isSystem: true, text: 'Schlüssel geändert' })])
    expect(screen.getByText('Schlüssel geändert')).toBeInTheDocument()
    expect(zeichneNachricht).not.toHaveBeenCalled()
  })

  it('zeigt ohne Nachrichten den Leerhinweis', () => {
    zeichne([])
    expect(screen.getByText(i18n.t('messenger.noMessagesYet'))).toBeInTheDocument()
  })

  it('zeigt beim ersten Laden ein Skelett statt einer leeren Fläche', () => {
    const { container } = render(
      <ChatTimeline
        scrollRef={createRef()}
        endeRef={createRef()}
        nachrichten={[]}
        laedt
        trennerId={null}
        aktivitaet={null}
        istGruppe={false}
        zeichneNachricht={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('common.loading'))
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
    expect(screen.queryByText(i18n.t('messenger.noMessagesYet'))).toBeNull()
  })
})
