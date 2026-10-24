/**
 * Steuerpakete eines Gesprächs bauen und senden — ohne React.
 *
 * Quittungen, Bearbeitungen, Löschungen, Reaktionen und Verfallsfristen reisen
 * als versiegelte Hybridumschläge je Zielgerät, dazu eine Kopie für die
 * eigenen übrigen Geräte über die Geräte-Mailbox. Bis 23.10.2026 stand das
 * ausschließlich in `useKonversation`; der Hintergrundlauf des Gerätepostfachs
 * konnte damit keine Zustellquittung schicken, und eine Nachricht, die bei
 * geschlossener App ankam, blieb beim Absender auf „gesendet", bis jemand den
 * Chat öffnete.
 *
 * Ein Weg für beide: der Hook reicht hinein, der Postfachlauf ebenso.
 */

import { messengerSocket } from '@/services/messengerSocket'
import {
  deriveUserDeviceMailboxId,
  encryptE2eeHybrid,
} from '@/services/e2eeCrypto'
import { eigenesGeraet, verlangeGeraeteVon } from '@/services/e2eeGeraet'
import type { E2eeIdentity } from '@/services/e2eeIdentity'
import {
  dmZiele,
  verschluesseleFuerGruppe,
  type GruppenKontext,
} from '@/services/gruppenSchluessel'
import { frischeMitglieder } from '@/services/gruppen/gruppenVerteilung'
import type { DrKontext } from '@/services/ratchetSitzung'
import { signiereNutzlast } from '@/services/nutzlastSignatur'
import type { Versandauftrag } from '@/hooks/useKonversation'

export interface SteuerKontext {
  eigeneId: number
  /** Die Mailbox des Gesprächs (die abgeleitete Kennung). */
  mailbox: string
  drKontext: DrKontext | null
  gruppenKontext: GruppenKontext | null
  /** Wechselt mit dem Entsperren; ohne sie keine Kopie an eigene Geräte. */
  identitaet: E2eeIdentity | null
}

/**
 * Die Aufträge eines Steuerpakets.
 *
 * Die Gruppe bekommt einen Umschlag über ihren Schlüssel (ein Schlüssel
 * verbraucht sich nicht), der Direktchat je Gerät einen eigenen. In beiden
 * Fällen geht zusätzlich eine Kopie an die eigenen übrigen Geräte.
 */
export async function baueSteuerVersand(
  kontext: SteuerKontext,
  payload: string,
  clientUuid: string,
  typ: string,
): Promise<Versandauftrag[]> {
  const { eigeneId, mailbox, drKontext, gruppenKontext } = kontext
  if (!mailbox || !eigeneId) return []

  /**
   * Dieselbe Wirkung für die **eigenen übrigen Geräte**.
   *
   * Sie geht nicht in die Chat-Mailbox: das Relais weist einen Umschlag an das
   * eigene Konto dort mit 400 ab. Ihr Weg ist die Geräte-Mailbox, versiegelt
   * gegen jedes einzelne Gerät. Das sendende Gerät überspringt sich selbst —
   * es hat die Wirkung bereits lokal angewandt.
   */
  const eigeneAuftraege = async (): Promise<Versandauftrag[]> => {
    const sendPair = kontext.identitaet?.sendPair
    if (!sendPair) return []
    const [geraete, meins, geraeteMailbox] = await Promise.all([
      verlangeGeraeteVon(eigeneId).catch(() => []),
      eigenesGeraet().catch(() => null),
      deriveUserDeviceMailboxId(eigeneId),
    ])
    const auftraege = await Promise.all(
      geraete
        .filter((geraet) => geraet.device_id !== meins?.kennung)
        .map(async (geraet, i) => ({
          blind_mailbox_id: geraeteMailbox,
          ciphertext_envelope: await encryptE2eeHybrid(
            payload,
            geraet.public_key,
            sendPair.publicKeyJwk,
          ),
          // Eigene Kennung je Gerät; `#own` hält die Kopie aus dem
          // Nachrichtenfenster des Empfängers heraus.
          client_uuid: `${clientUuid}#own${i}`,
          is_control: true,
          control_type: typ,
          chat_type: 'direct' as const,
          chat_id: String(drKontext?.peerId),
          target_device_id: geraet.device_id,
          target_device_db_id: geraet.id,
        })),
    )
    return auftraege
  }

  if (gruppenKontext) {
    const umschlag = await verschluesseleFuerGruppe(gruppenKontext, payload)
    const mitglieder = await frischeMitglieder(gruppenKontext)
    const meins = await eigenesGeraet()
    const listen = await Promise.all(mitglieder.map(async (konto) => ({
      konto,
      geraete: await verlangeGeraeteVon(konto, { frisch: true }),
    })))
    return listen.flatMap(({ konto, geraete }) => geraete
      .filter((geraet) => konto !== eigeneId || geraet.device_id !== meins.kennung)
      .map((geraet) => ({
        blind_mailbox_id: mailbox,
        ciphertext_envelope: umschlag,
        client_uuid: clientUuid,
        is_control: true,
        control_type: typ,
        chat_type: 'group' as const,
        chat_id: String(gruppenKontext.groupId),
        target_device_id: geraet.device_id,
        target_device_db_id: geraet.id,
      })))
  }

  if (!drKontext) return []
  const sendPair = kontext.identitaet?.sendPair
  if (!sendPair) return []

  /*
   * Quittungen bleiben auf dem Hybridumschlag und laufen bewusst **nicht**
   * durch den Ratchet. Sie sind häufig, sie sind klein, und sie dürfen den
   * Nachrichtenfaden unter keinen Umständen stören: eine verlorene Quittung
   * kostet ein Häkchen, eine verbrauchte Kettenposition kostet eine Nachricht.
   */
  const geraete = await verlangeGeraeteVon(drKontext.peerId)
  const ziel = await dmZiele(eigeneId, drKontext.peerId, mailbox)
  const auftraege = await Promise.all(
    geraete.map(async (geraet, i) => ({
      blind_mailbox_id: ziel.senden,
      ciphertext_envelope: await encryptE2eeHybrid(payload, geraet.public_key, sendPair.publicKeyJwk),
      // Je Gerät eine eigene Kennung, sonst gibt das Relais beim zweiten
      // Aufruf still den ersten Umschlag zurück und nur ein Gerät erfährt
      // von der Quittung.
      client_uuid: `${clientUuid}#${i}`,
      is_control: true,
      control_type: typ,
      chat_type: 'direct' as const,
      chat_id: String(drKontext.peerId),
      target_device_id: geraet.device_id,
      target_device_db_id: geraet.id,
    })),
  )
  return [...auftraege, ...(await eigeneAuftraege())]
}

/**
 * Ein Steuerpaket signieren, bauen und abschicken.
 *
 * Gibt die Kennung zurück, oder `null`, wenn es für dieses Gespräch keinen Weg
 * gibt (keine Geräte, gesperrter Messenger). Der Aufrufer entscheidet, ob das
 * ein Fehler ist — eine Quittung ist keiner.
 */
export async function sendeSteuerpaket(
  kontext: SteuerKontext,
  payloadObj: Record<string, unknown>,
  clientUuid: string,
): Promise<string | null> {
  if (!kontext.mailbox || !kontext.eigeneId) return null
  const payload = JSON.stringify(
    await signiereNutzlast(kontext.mailbox, kontext.eigeneId, {
      actor_id: kontext.eigeneId,
      ...payloadObj,
      mailbox: kontext.mailbox,
      client_uuid: clientUuid,
    }),
  )
  const auftraege = await baueSteuerVersand(
    kontext,
    payload,
    clientUuid,
    String(payloadObj.type || 'control'),
  )
  if (auftraege.length === 0) return null
  const meins = await eigenesGeraet()
  const payloadData = {
    client_uuid: clientUuid,
    chat_type: kontext.gruppenKontext ? ('group' as const) : ('direct' as const),
    chat_id: String(kontext.gruppenKontext?.groupId ?? kontext.drKontext?.peerId),
    device_id: meins.kennung,
    envelopes: auftraege.map((auftrag) => ({
      target_device_id: auftrag.target_device_db_id,
      device_id: auftrag.target_device_id,
      encrypted_payload: auftrag.ciphertext_envelope,
      client_uuid: `ctrl:${auftrag.client_uuid}`,
    })),
  }
  await messengerSocket.sendMessage(payloadData)
  return clientUuid
}
