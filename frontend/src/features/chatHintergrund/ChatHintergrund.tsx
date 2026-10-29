import { useEffect, useMemo, useRef, useState } from 'react'

import type { GruppenKontext } from '@/services/gruppenSchluessel'
import { ladeGruppenHintergrund } from '@/services/gruppenInfo'
import {
  beobachteChatHintergrund,
  ladeHintergrundFuerScope,
  STANDARD_HINTERGRUND,
  type ChatHintergrundBereich,
  type ChatHintergrundKonfiguration,
  type ChatHintergrundScope,
} from './speicher'
import { vorlageMitId, STANDARD_VORLAGE, type HintergrundId } from './vorlagen'

function alsKonfiguration(roh: {
  preset?: string | null
  bild?: string | null
  dim: number
}): ChatHintergrundKonfiguration | null {
  const bild =
    typeof roh.bild === 'string' &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(roh.bild)
      ? roh.bild
      : undefined
  const presetRoh = typeof roh.preset === 'string' ? roh.preset : null
  if (!presetRoh && !bild) return null
  const preset: HintergrundId =
    presetRoh === 'custom' || (bild && !presetRoh)
      ? 'custom'
      : presetRoh && vorlageMitId(presetRoh as HintergrundId)
        ? (presetRoh as HintergrundId)
        : STANDARD_VORLAGE
  if (preset === 'custom' && !bild) return null
  return {
    preset,
    customDataUrl: preset === 'custom' ? bild : undefined,
    dimLevel: Math.min(75, Math.max(0, Math.round(roh.dim))),
  }
}

/**
 * Der persönliche Hintergrund eines Platzes, lebend.
 *
 * Lebend heisst: wer im Chat die Vorlage wechselt, ändert damit auch den
 * zweiten Tab und — bei „für alle" — die übrigen Direktchats, ohne Neuladen.
 */
export function useChatHintergrund(
  bereich: ChatHintergrundBereich,
  peerId?: number | null,
): ChatHintergrundKonfiguration {
  const scope = useMemo<ChatHintergrundScope>(
    () =>
      bereich === 'messenger' && Number.isInteger(peerId) && (peerId ?? 0) > 0
        ? { art: 'direkt', peerId: Number(peerId) }
        : { art: 'global', bereich },
    [bereich, peerId],
  )
  const [konfiguration, setzeKonfiguration] = useState<ChatHintergrundKonfiguration>(
    STANDARD_HINTERGRUND,
  )

  useEffect(() => {
    let abgebrochen = false
    const laden = async () => {
      const frisch = await ladeHintergrundFuerScope(scope)
      if (!abgebrochen) setzeKonfiguration(frisch)
    }
    void laden()
    const abbestellen = beobachteChatHintergrund(() => {
      void laden()
    })
    return () => {
      abgebrochen = true
      abbestellen()
    }
  }, [scope])

  return konfiguration
}

/**
 * Der geteilte Hintergrund einer Gruppe.
 *
 * Er liegt verschlüsselt beim Server und gehört der Gruppe, nicht dem Gerät.
 * Fehlt er, ist das Ergebnis `null`; der Aufrufer fällt dann auf die globale
 * Messenger-Vorgabe zurück. Ein `chat_group_background_updated` lädt neu, ohne
 * dass jemand den Chat schließen muss.
 */
export function useGruppenHintergrund(
  kontext: GruppenKontext | null | undefined,
  darfSetzen?: (konto: number) => boolean,
): ChatHintergrundKonfiguration | null {
  const [konfiguration, setzeKonfiguration] = useState<ChatHintergrundKonfiguration | null>(null)
  const darfRef = useRef(darfSetzen)
  darfRef.current = darfSetzen
  const gruppeId = kontext?.groupId ?? 0
  const mailbox = kontext?.blindMailboxId ?? ''
  const eigeneId = kontext?.eigeneId ?? 0

  useEffect(() => {
    if (!kontext || !gruppeId) {
      setzeKonfiguration(null)
      return
    }
    let abgebrochen = false
    const laden = async () => {
      const lesung = await ladeGruppenHintergrund(kontext, (konto) =>
        darfRef.current ? darfRef.current(konto) : true,
      )
      if (abgebrochen) return
      setzeKonfiguration(
        lesung.art === 'hintergrund' ? alsKonfiguration(lesung.hintergrund) : null,
      )
    }
    void laden()

    const beiSync = (ereignis: Event) => {
      const detail = (ereignis as CustomEvent<Record<string, unknown>>).detail
      if (detail?.type !== 'chat_group_background_updated') return
      if (Number(detail.group_id) !== gruppeId) return
      void laden()
    }
    window.addEventListener('msm:sync-event', beiSync)
    return () => {
      abgebrochen = true
      window.removeEventListener('msm:sync-event', beiSync)
    }
    // Der Kontext wird bei jedem Rendern neu gebaut; die drei Werte, aus denen
    // er wirklich besteht, wechseln dagegen selten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `darfSetzen` wird nur beim Lesen geprüft; die Funktion wechselt mit der
    // Mitgliederliste und soll keinen zweiten Ladevorgang auslösen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gruppeId, mailbox, eigeneId])

  return konfiguration
}

/**
 * Die Fläche einer einzelnen Vorlage — dieselbe im Chat wie auf der
 * Auswahlkachel. Positioniert sich selbst über dem nächsten `relative`-Kasten.
 */
export function HintergrundFlaeche({
  vorlage,
  eigenesBild,
}: {
  vorlage: HintergrundId
  eigenesBild?: string
}) {
  if (vorlage === 'custom') {
    if (!eigenesBild) return null
    return (
      <img
        src={eigenesBild}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
    )
  }

  const gefunden = vorlageMitId(vorlage)
  if (!gefunden) return null
  return <div className={`absolute inset-0 ${gefunden.klassen}`} style={gefunden.stil} />
}

/**
 * Die Hintergrundschicht eines Chatbereichs.
 *
 * **Einbau.** Der Kasten darüber braucht `relative`, die Schicht ist sein
 * erstes Kind. Sie liegt absolut und mit `z-0` darin — und damit über allem,
 * was im Fluss und ohne eigene Positionierung darunter steht. Jedes Element,
 * das *über* dem Hintergrund stehen soll (Verlauf, Kopfzeile, Eingabe), braucht
 * deshalb selbst `relative` oder eine Position. Das ist die Bauart, die der
 * Messenger seit jeher benutzt; sie kommt ohne `isolate` aus und sperrt damit
 * keine Überlagerung in einen Stapelkontext ein.
 *
 * Die Schicht nimmt keine Klicks (`pointer-events-none`) und keinen
 * Vorlesefokus (`aria-hidden`): sie ist Dekoration, kein Inhalt.
 */
export function ChatHintergrund({
  bereich,
  peerId,
  gruppe,
  gruppeDarfSetzen,
  className = '',
}: {
  bereich: ChatHintergrundBereich
  /** Der Direktchat-Partner. Ohne ihn gilt die globale Messenger-Vorgabe. */
  peerId?: number | null
  /** Die offene Gruppe. Ihr geteilter Hintergrund hat Vorrang. */
  gruppe?: GruppenKontext | null
  /** Wer den geteilten Hintergrund schreiben durfte (Signaturprüfung). */
  gruppeDarfSetzen?: (konto: number) => boolean
  className?: string
}) {
  const persoenlich = useChatHintergrund(bereich, peerId)
  const geteilt = useGruppenHintergrund(gruppe, gruppeDarfSetzen)
  const konfiguration = geteilt ?? persoenlich

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}
      aria-hidden="true"
      data-chat-hintergrund={konfiguration.preset}
    >
      <HintergrundFlaeche
        vorlage={konfiguration.preset}
        eigenesBild={konfiguration.customDataUrl}
      />

      {/* Abdunkeln, damit der Text auch auf einem hellen Foto lesbar bleibt. */}
      {konfiguration.dimLevel > 0 && (
        <div
          className="absolute inset-0 bg-black"
          style={{ opacity: konfiguration.dimLevel / 100 }}
          data-chat-hintergrund-abdunkeln={konfiguration.dimLevel}
        />
      )}
    </div>
  )
}
