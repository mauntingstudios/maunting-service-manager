/**
 * Die Einladungskarte fortschreiben und ihren Schlüssel teilen.
 *
 * **Das Problem.** Bis 27.10.2026 entstand bei jeder Kopie eines Einladungslinks
 * ein neuer Zufallsschlüssel, der nur im Fragment dieses einen Links lebte. Die
 * Karte in der Datenbank wurde bei der nächsten Kopie überschrieben, und wer
 * später den Gruppennamen ändert, hatte den Schlüssel der bereits versendeten
 * Karte nie. Die Vorschau blieb für immer auf dem Stand des Tages, an dem sie
 * geteilt wurde — alte Links zeigten nach einer zweiten Kopie sogar gar nichts
 * mehr.
 *
 * **Die Lösung.** Ein Schlüssel je Gruppe, im verschlüsselten Info-Block. Er
 * reist mit dem Block zu allen Mitgliedern, und wer die Allgemeinangaben
 * schreiben darf, kann die Karte damit neu versiegeln. Der Einladungscode
 * bleibt im AAD: wird er rotiert (Rauswurf), passt die alte Karte nicht mehr,
 * und der nächste Teilvorgang versiegelt unter dem neuen Code.
 */

import type { ChatGroupItem } from '@/api/social'
import { setzeEinladungsKarte } from '@/api/social'
import { deriveGroupBlindMailboxId } from '@/services/e2eeCrypto'
import {
  baueEinladungsKarte,
  erzeugeEinladungsschluessel,
  istEinladungsschluessel,
  type EinladungsInhalt,
} from './einladungsKarte'
import { aendereGruppenInfo, ladeGruppenInfo, type GruppenInfo } from './gruppenInfo'
import type { GruppenKontext } from './gruppenSchluessel'

/** Der Kontext, den die Info- und Kartenwege brauchen. */
export async function einladungsKontext(
  gruppe: Pick<ChatGroupItem, 'id'> & Partial<Pick<ChatGroupItem, 'members' | 'role'>>,
  eigeneId: number,
): Promise<GruppenKontext> {
  const mailbox = await deriveGroupBlindMailboxId(gruppe.id).catch(() => null)
  return {
    groupId: gruppe.id,
    blindMailboxId: mailbox ?? undefined,
    eigeneId,
    mitglieder: (gruppe.members ?? []).map((m) => m.user_id ?? 0).filter(Boolean),
    istEigentuemer: gruppe.role === 'owner',
  }
}

/**
 * Der Schlüssel für die nächste Kopie des Links.
 *
 * Steht einer im Info-Block, gilt er. Fehlt er, entsteht einer und wandert in
 * den Block — nur so können spätere Änderungen die Karte noch erreichen.
 * Gelingt das Schreiben nicht (kein `edit_group`, kein Netz), teilen wir
 * trotzdem mit dem neuen Schlüssel: diese eine Karte bleibt lesbar, sie lässt
 * sich nur nicht mehr fortschreiben. Ein Einladen, das an einer Vorschau
 * scheitert, wäre der schlechtere Tausch.
 *
 * `saat` füllt einen Block, den es noch gar nicht gibt. Ohne sie entstünde ein
 * Block mit lauter `null` — und das heißt für jeden Leser „bewusst geleert“:
 * die Gruppe verlöre ihren Namen.
 */
export async function holeEinladungsschluessel(
  kontext: GruppenKontext,
  saat?: EinladungsInhalt,
): Promise<string> {
  const lesung = await ladeGruppenInfo(kontext).catch(() => null)
  if (lesung?.art === 'info' && lesung.info.inviteKey) return lesung.info.inviteKey

  const neu = erzeugeEinladungsschluessel()
  await aendereGruppenInfo(kontext, () => true, (vorher) => {
    const leer =
      !vorher.name && !vorher.beschreibung && !vorher.logo && Boolean(saat)
    return {
      ...vorher,
      ...(leer ? { name: saat?.name ?? null, beschreibung: saat?.beschreibung ?? null, logo: saat?.logo ?? null } : {}),
      inviteKey: neu,
    }
  }).catch(() => undefined)
  return neu
}

/**
 * Versiegelt die Karte mit dem Inhalt des aktuellen Info-Blocks neu.
 *
 * Aufgerufen nach dem Speichern von Name, Beschreibung oder Logo. Ohne
 * Einladungscode (kein Recht), ohne Schlüssel (nie geteilt) oder ohne
 * schreibbaren Block passiert nichts — eine Karte, die es nicht gibt, wird
 * nicht erfunden.
 */
export async function versiegleEinladungNeu(
  gruppe: Pick<ChatGroupItem, 'id' | 'invite_code' | 'members' | 'role'>,
  eigeneId: number,
): Promise<boolean> {
  if (!gruppe.invite_code) return false
  try {
    const kontext = await einladungsKontext(gruppe, eigeneId)
    const lesung = await ladeGruppenInfo(kontext)
    if (lesung.art !== 'info') return false
    const schluessel = lesung.info.inviteKey
    if (!schluessel || !istEinladungsschluessel(schluessel)) return false
    const karte = await baueEinladungsKarte(schluessel, gruppe.invite_code, inhaltAus(lesung.info))
    await setzeEinladungsKarte(gruppe.id, karte)
    return true
  } catch {
    // Eine Vorschau, die nicht nachgezogen werden kann, hält das Speichern
    // der Allgemeinangaben nicht auf.
    return false
  }
}

/** Was die Karte aus dem Info-Block übernimmt. */
export function inhaltAus(info: GruppenInfo): {
  name: string | null
  beschreibung: string | null
  logo: string | null
} {
  return {
    name: info.name ?? null,
    beschreibung: info.beschreibung ?? null,
    logo: info.logo ?? null,
  }
}
