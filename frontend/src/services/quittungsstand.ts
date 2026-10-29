/**
 * Bis wohin für einen Chat schon quittiert wurde.
 *
 * Die Quittungen sind kumulativ: sie nennen eine Obergrenze, keine einzelne
 * Nachricht. Ein verlorener Eintrag kostet deshalb nichts, sobald eine neue
 * Nachricht eintrifft. Der Stand wird großzügig gemerkt, auch wenn der Versand
 * hinterher scheitert; andersherum würde ein gescheiterter Versuch bei jedem
 * Takt erneut senden und die Mailbox fluten.
 *
 * Die Schlüssel tragen bewusst einen Doppelpunkt: `msm_chat_` mit Unterstrich
 * räumt `scrubPlaintextStorage` beim Öffnen weg. Sie gehören stattdessen in die
 * kontogebundene Ablage (`MESSENGER_KEYS`) und fallen beim Abmelden mit ihr.
 */

import { getStorageItem, setStorageItem } from '@/lib/offlineAblage'

const SCHLUESSEL = 'msm:chat_quittungsstand'
const SCHLUESSEL_PARTNER = 'msm:chat_partnerstand'

/** Bis zu welcher fremden Kennung schon quittiert wurde. */
export interface Quittungsstand {
  /** Höchste Kennung, für die eine Zustellquittung raus ist. */
  zugestellt: number
  /** Höchste Kennung, für die eine Lesequittung raus ist. */
  gelesen: number
}

const LEER: Quittungsstand = { zugestellt: 0, gelesen: 0 }

function lies(schluessel: string = SCHLUESSEL): Record<string, Quittungsstand> {
  try {
    const roh = getStorageItem(schluessel)
    const gelesen = roh ? JSON.parse(roh) : {}
    return gelesen && typeof gelesen === 'object' ? gelesen : {}
  } catch {
    return {}
  }
}

function eintragAus(schluessel: string, blindMailboxId: string): Quittungsstand | null {
  if (!blindMailboxId) return null
  const eintrag = lies(schluessel)[blindMailboxId]
  return eintrag && typeof eintrag === 'object' ? eintrag : null
}

function standAus(schluessel: string, blindMailboxId: string): Quittungsstand {
  const eintrag = eintragAus(schluessel, blindMailboxId)
  if (!eintrag) return { ...LEER }
  return { zugestellt: zahl(eintrag.zugestellt), gelesen: zahl(eintrag.gelesen) }
}

/**
 * Eine Kennung oder null.
 *
 * `Number.isFinite` reicht hier nicht: `1e308` ist endlich, und ein einziger
 * solcher Wert in der Ablage riegelt die Mailbox dauerhaft ab. Eine Kennung
 * kommt aus einer Datenbankspalte, ist also eine ganze Zahl in sicherer
 * Reichweite; alles andere zählt als „nichts gemerkt".
 */
function zahl(wert: unknown): number {
  const n = Number(wert)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

function merke(
  schluessel: string,
  blindMailboxId: string,
  art: keyof Quittungsstand,
  bisId: number,
): void {
  if (!blindMailboxId || zahl(bisId) === 0) return
  const alle = lies(schluessel)
  const bisher = eintragAus(schluessel, blindMailboxId)
  const stand: Quittungsstand = {
    zugestellt: zahl(bisher?.zugestellt),
    gelesen: zahl(bisher?.gelesen),
  }
  if (bisId <= stand[art]) return
  stand[art] = bisId
  alle[blindMailboxId] = stand
  setStorageItem(schluessel, JSON.stringify(alle))
}

export function quittungsstand(blindMailboxId: string): Quittungsstand {
  return standAus(SCHLUESSEL, blindMailboxId)
}

/**
 * Den Stand hochsetzen.
 *
 * Nur nach oben: ein später eintreffender Abruf mit einem kleineren Höchstwert
 * darf den Stand nicht zurückdrehen, sonst quittiert das Gerät dieselbe
 * Nachricht ein zweites Mal.
 */
export function merkeQuittung(
  blindMailboxId: string,
  art: keyof Quittungsstand,
  bisId: number,
): void {
  merke(SCHLUESSEL, blindMailboxId, art, bisId)
}

/** Bis wohin der **Gesprächspartner** gelesen und zugestellt hat. */
export function partnerstand(blindMailboxId: string): Quittungsstand {
  return standAus(SCHLUESSEL_PARTNER, blindMailboxId)
}

/** Was der Partner gelesen bzw. zugestellt hat, festhalten. */
export function merkePartnerQuittung(
  blindMailboxId: string,
  art: keyof Quittungsstand,
  bisId: number,
): void {
  merke(SCHLUESSEL_PARTNER, blindMailboxId, art, bisId)
}
