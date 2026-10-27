/**
 * Gruppeninfo und Gruppenhintergrund in Echtzeit.
 *
 * ## Warum es diese Wache braucht
 *
 * Der Server meldet seit jeher `chat_group_config_updated`,
 * `chat_group_member_updated` und `chat_group_permissions_updated`. Bis
 * 27.10.2026 hörte niemand darauf: die Gruppenliste fragte alle 15 Sekunden,
 * und Name, Beschreibung und Bild einer offenen Gruppe blieben stehen, bis
 * jemand den Chat neu öffnete. Die Einstellungsseite soll aber live sein.
 *
 * ## Was sie tut
 *
 * Sie hört auf die Ereignisse, entprellt je Gruppe und lädt **einen** Block
 * zur Zeit. Ein eigenes Echo erkennt sie an der Revision: was dieses Gerät
 * gerade geschrieben hat, meldet der Server mit derselben Revision zurück.
 * Die Wache schreibt nicht selbst in den Zustand des Messengers; sie ruft
 * `onInfo` und `onHintergrund`, und der Aufrufer entscheidet, was damit
 * geschieht. So bleibt die eine Stelle, die Gruppen benennt, die eine.
 */

import { useEffect, useRef } from 'react'

import type { ChatGroupItem } from '@/api/social'
import { deriveGroupBlindMailboxId } from '@/services/e2eeCrypto'
import {
  ladeGruppenHintergrund,
  ladeGruppenInfo,
  type GruppenHintergrund,
  type GruppenInfo,
} from '@/services/gruppenInfo'

interface GruppenMetaWacheProps {
  groups: ChatGroupItem[]
  eigeneId: number
  onInfo: (
    groupId: number,
    info: GruppenInfo,
    revision: number,
    quelle: 'info' | 'config',
  ) => void
  onHintergrund?: (
    groupId: number,
    hintergrund: GruppenHintergrund | null,
    revision: number,
  ) => void
  /** Mitglieder- oder Rechteänderung: die Gruppenliste neu holen. */
  onStruktur: () => void
}

const STRUKTUR_EREIGNISSE = new Set([
  'chat_group_member_updated',
  'chat_group_permissions_updated',
  'chat_group_joined',
  'chat_group_member_left',
  'chat_group_member_kicked',
])

const ENTPRELLUNG_MS = 150
const STRUKTUR_ENTPRELLUNG_MS = 400

type Art = 'info' | 'background'

function darfInfoSchreiben(gruppe: ChatGroupItem, konto: number): boolean {
  if (Number(gruppe.owner_user_id) === Number(konto)) return true
  const mitglied = (gruppe.members ?? []).find((m) => Number(m.user_id) === Number(konto))
  if (!mitglied) return false
  if (mitglied.role === 'owner' || mitglied.role === 'admin') return true
  if (mitglied.can_edit_group) return true
  return (mitglied.permissions || '')
    .split(',')
    .map((p) => p.trim())
    .includes('edit_group')
}

function darfHintergrundSetzen(gruppe: ChatGroupItem, konto: number): boolean {
  if (Number(gruppe.owner_user_id) === Number(konto)) return true
  const mitglied = (gruppe.members ?? []).find((m) => Number(m.user_id) === Number(konto))
  if (!mitglied) return false
  if (mitglied.role === 'owner' || mitglied.role === 'admin') return true
  if (mitglied.can_set_group_background) return true
  return (mitglied.permissions || '')
    .split(',')
    .map((p) => p.trim())
    .includes('set_group_background')
}

export function GruppenMetaWache({
  groups,
  eigeneId,
  onInfo,
  onHintergrund,
  onStruktur,
}: GruppenMetaWacheProps) {
  const gruppenRef = useRef(groups)
  gruppenRef.current = groups
  const eigeneRef = useRef(eigeneId)
  eigeneRef.current = eigeneId
  const onInfoRef = useRef(onInfo)
  onInfoRef.current = onInfo
  const onHintergrundRef = useRef(onHintergrund)
  onHintergrundRef.current = onHintergrund
  const onStrukturRef = useRef(onStruktur)
  onStrukturRef.current = onStruktur
  const planeRef = useRef<((groupId: number, art: Art) => void) | null>(null)
  const vorgemerkt = useRef(new Set<number>())

  useEffect(() => {
    let lebt = true
    const timer = new Map<string, number>()
    const laeuft = new Set<string>()
    const nochEinmal = new Set<string>()
    const gesehen = new Map<number, { info?: number; background?: number }>()
    let strukturTimer: number | null = null

    const kontextFuer = async (gruppe: ChatGroupItem) => {
      const mailbox = await deriveGroupBlindMailboxId(gruppe.id).catch(() => null)
      return {
        groupId: gruppe.id,
        blindMailboxId: mailbox ?? undefined,
        eigeneId: eigeneRef.current,
        mitglieder: (gruppe.members ?? []).map((m) => m.user_id),
        istEigentuemer: gruppe.role === 'owner',
      }
    }

    const lade = async (groupId: number, art: Art) => {
      const schluessel = `${art}:${groupId}`
      if (laeuft.has(schluessel)) {
        nochEinmal.add(schluessel)
        return
      }
      laeuft.add(schluessel)
      try {
        const gruppe = gruppenRef.current.find((g) => g.id === groupId)
        if (!gruppe || !eigeneRef.current) return
        const kontext = await kontextFuer(gruppe)
        if (!lebt) return

        if (art === 'background') {
          const lesung = await ladeGruppenHintergrund(kontext, (konto) =>
            darfHintergrundSetzen(gruppe, konto),
          )
          if (!lebt) return
          if (lesung.art === 'hintergrund') {
            onHintergrundRef.current?.(groupId, lesung.hintergrund, lesung.revision)
          } else if (lesung.art === 'leer') {
            onHintergrundRef.current?.(groupId, null, 0)
          }
          return
        }

        const lesung = await ladeGruppenInfo(kontext, (konto) =>
          darfInfoSchreiben(gruppe, konto),
        )
        if (!lebt) return
        if (lesung.art === 'info') {
          onInfoRef.current(groupId, lesung.info, lesung.revision, lesung.quelle)
        }
      } catch {
        // Kein Schlüssel, kein Netz: der nächste Anlass versucht es erneut.
      } finally {
        laeuft.delete(schluessel)
        if (nochEinmal.delete(schluessel)) {
          void lade(groupId, art)
        }
      }
    }

    const plane = (groupId: number, art: Art) => {
      const schluessel = `${art}:${groupId}`
      const vorhanden = timer.get(schluessel)
      if (vorhanden) window.clearTimeout(vorhanden)
      timer.set(
        schluessel,
        window.setTimeout(() => {
          timer.delete(schluessel)
          void lade(groupId, art)
        }, ENTPRELLUNG_MS),
      )
    }

    planeRef.current = plane

    const planeStruktur = () => {
      if (strukturTimer) window.clearTimeout(strukturTimer)
      strukturTimer = window.setTimeout(() => {
        strukturTimer = null
        if (lebt) onStrukturRef.current()
      }, STRUKTUR_ENTPRELLUNG_MS)
    }

    const schonGesehen = (groupId: number, art: Art, revision: number) => {
      if (!revision) return false
      const bisher = gesehen.get(groupId)?.[art]
      return typeof bisher === 'number' && revision <= bisher
    }

    const merkeGesehen = (groupId: number, art: Art, revision: number) => {
      if (!revision) return
      const bisher = gesehen.get(groupId) ?? {}
      gesehen.set(groupId, {
        ...bisher,
        [art]: Math.max(bisher[art] ?? 0, revision),
      })
    }

    const handleSync = (ereignis: Event) => {
      const detail = (ereignis as CustomEvent<Record<string, unknown>>).detail
      if (!detail) return
      const typ = String(detail.type ?? '')
      const groupId = Number(detail.group_id)
      if (!Number.isInteger(groupId) || groupId <= 0) return

      if (typ === 'chat_group_info_updated' || typ === 'chat_group_config_updated') {
        const revision = Number(detail.revision) || 0
        if (schonGesehen(groupId, 'info', revision)) return
        merkeGesehen(groupId, 'info', revision)
        plane(groupId, 'info')
        return
      }
      if (typ === 'chat_group_background_updated') {
        // Ohne Empfänger lädt die Chatfläche den Hintergrund selbst.
        if (!onHintergrundRef.current) return
        const revision = Number(detail.revision) || 0
        if (schonGesehen(groupId, 'background', revision)) return
        merkeGesehen(groupId, 'background', revision)
        plane(groupId, 'background')
        return
      }
      if (STRUKTUR_EREIGNISSE.has(typ)) planeStruktur()
    }

    /**
     * Das eigene Schreiben. Der Server meldet es mit derselben Revision
     * zurück; ohne diese Marke lüde die Wache nach jedem Speichern noch
     * einmal denselben Block.
     */
    const handleEigeneSchreibung = (ereignis: Event) => {
      const detail = (ereignis as CustomEvent<Record<string, unknown>>).detail
      if (!detail) return
      const groupId = Number(detail.groupId)
      const revision = Number(detail.revision) || 0
      if (!Number.isInteger(groupId) || groupId <= 0) return
      if (detail.art === 'background') merkeGesehen(groupId, 'background', revision)
      else merkeGesehen(groupId, 'info', revision)
    }

    window.addEventListener('msm:sync-event', handleSync)
    window.addEventListener('msm:gruppenblock-geschrieben', handleEigeneSchreibung)

    return () => {
      lebt = false
      window.removeEventListener('msm:sync-event', handleSync)
      window.removeEventListener('msm:gruppenblock-geschrieben', handleEigeneSchreibung)
      planeRef.current = null
      vorgemerkt.current.clear()
      for (const aus of timer.values()) window.clearTimeout(aus)
      timer.clear()
      if (strukturTimer) window.clearTimeout(strukturTimer)
    }
  }, [])

  /*
   * Beim ersten Anzeigen der Liste sind die Namen oft noch versiegelt: der
   * Server liefert sie nicht mehr, und ohne Ereignis hätte die Wache keinen
   * Anlass zu lesen. Deshalb wird je Gruppe **einmal** gelesen; neue Gruppen
   * kommen beim nächsten Listenabruf dazu.
   */
  useEffect(() => {
    if (!eigeneId) return
    for (const gruppe of groups) {
      if ((gruppe.members?.length ?? 0) === 0) continue
      if (vorgemerkt.current.has(gruppe.id)) continue
      vorgemerkt.current.add(gruppe.id)
      planeRef.current?.(gruppe.id, 'info')
    }
  }, [groups, eigeneId])

  return null
}
