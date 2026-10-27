/**
 * Gruppeninfo und geteilter Gruppenhintergrund — zwei Blöcke, zwei Rechte.
 *
 * **Warum nicht im Rollenblock.** Bis 27.10.2026 lagen Name, Beschreibung und
 * Logo im selben verschlüsselten Block wie die Rollen. Damit hing beides am
 * selben Recht: wer Rollen verwalten durfte, konnte auch den Namen ändern,
 * und wer den Namen ändern sollte, musste die Rollen mitbekommen. Die
 * Oberfläche konnte das trennen, der Server nicht — er sieht nur einen Block.
 *
 * Jetzt gibt es zwei Blöcke mit eigener Revision und eigener AAD:
 *
 * * ``info``: Name, Beschreibung, Logo (Recht ``edit_group``)
 * * ``background``: Vorlage, Abdunkelung und eigenes Bild (Recht
 *   ``set_group_background``). Der Hintergrund gehört der Gruppe, nicht dem
 *   Gerät; alle Mitglieder sehen denselben.
 *
 * **Der alte Block bleibt lesbar.** Eine Gruppe von vor dem Umbau hat keinen
 * Info-Block. Dann fällt `ladeGruppenInfo` auf Name, Beschreibung und Logo im
 * Rollenblock zurück. Existiert ein Info-Block, ist er maßgeblich, auch wenn
 * alle drei Felder `null` sind: das ist ein bewusstes Leeren, kein fehlender
 * Wert.
 */

import {
  getGroupBackground,
  getGroupInfo,
  putGroupBackground,
  putGroupInfo,
} from '@/api/social'
import {
  entschluesseleGruppenUmschlag,
  verschluesseleFuerGruppe,
  type GruppenKontext,
} from './gruppenSchluessel'
import { ladeGruppenzustand } from './gruppenKonfig'
import { pruefeNutzlast, signiereNutzlast } from './nutzlastSignatur'

export const INFO_FORMAT = 1
export const HINTERGRUND_FORMAT = 1

export interface GruppenInfo {
  v: number
  name: string | null
  beschreibung: string | null
  logo: string | null
}

export interface GruppenHintergrund {
  v: number
  preset: string | null
  /** 0–100 Prozent Abdunkelung, damit Text auf jedem Bild lesbar bleibt. */
  dim: number
  bild: string | null
}

export type InfoLesung =
  | {
      art: 'info'
      info: GruppenInfo
      revision: number
      vonKonto: number
      /** Ob der Block aus dem neuen Info-Record oder dem alten Rollenblock stammt. */
      quelle: 'info' | 'config'
    }
  | { art: 'leer' }
  | { art: 'kein-schluessel'; keyId: string; revision: number }
  | { art: 'unbefugt'; behauptet: number; revision: number }
  | { art: 'unlesbar'; grund: string; revision: number }

export type HintergrundLesung =
  | {
      art: 'hintergrund'
      hintergrund: GruppenHintergrund
      revision: number
      vonKonto: number
    }
  | { art: 'leer' }
  | { art: 'kein-schluessel'; keyId: string; revision: number }
  | { art: 'unbefugt'; behauptet: number; revision: number }
  | { art: 'unlesbar'; grund: string; revision: number }

export type Infoschreibung =
  | { art: 'gespeichert'; revision: number }
  | { art: 'konflikt' }
  | { art: 'nicht-unterschreibbar' }

export type Hintergrundschreibung = Infoschreibung

function alsText(wert: unknown, hoechstens: number): string | null {
  if (typeof wert !== 'string') return null
  const sauber = wert.trim()
  return sauber ? sauber.slice(0, hoechstens) : null
}

function alsBild(wert: unknown): string | null {
  if (typeof wert !== 'string') return null
  return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(wert) ? wert : null
}

function alsDim(wert: unknown): number {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) return 25
  return Math.min(100, Math.max(0, Math.round(wert)))
}

function alsInfo(roh: Record<string, unknown>): GruppenInfo | null {
  if (Number(roh.v) !== INFO_FORMAT) return null
  return {
    v: INFO_FORMAT,
    name: alsText(roh.name, 64),
    beschreibung: alsText(roh.beschreibung, 256),
    logo: alsBild(roh.logo),
  }
}

function alsHintergrund(roh: Record<string, unknown>): GruppenHintergrund | null {
  if (Number(roh.v) !== HINTERGRUND_FORMAT) return null
  return {
    v: HINTERGRUND_FORMAT,
    preset: alsText(roh.preset, 64),
    dim: alsDim(roh.dim),
    bild: alsBild(roh.bild),
  }
}

function signaturKontext(kontext: GruppenKontext): string {
  return kontext.blindMailboxId || `group:${kontext.groupId}`
}

function meldeGeschrieben(
  groupId: number,
  art: 'info' | 'background',
  revision: number,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('msm:gruppenblock-geschrieben', {
      detail: { groupId, art, revision },
    }),
  )
}

async function leseBlock(
  kontext: GruppenKontext,
  umschlag: string,
  zweck: 'info' | 'background',
): Promise<
  | { roh: Record<string, unknown>; vonKonto: number }
  | { art: 'kein-schluessel' | 'unbefugt' | 'unlesbar'; behauptet?: number; grund?: string }
> {
  let text: string
  try {
    text = await entschluesseleGruppenUmschlag(kontext.groupId, umschlag, zweck)
  } catch {
    return { art: 'kein-schluessel' }
  }

  let roh: Record<string, unknown>
  try {
    const geparst = JSON.parse(text)
    if (!geparst || typeof geparst !== 'object' || Array.isArray(geparst)) {
      return { art: 'unlesbar', grund: 'kein-objekt' }
    }
    roh = geparst as Record<string, unknown>
  } catch {
    return { art: 'unlesbar', grund: 'kein-json' }
  }

  const beleg = await pruefeNutzlast(signaturKontext(kontext), roh)
  if (beleg.art !== 'geprueft') {
    return {
      art: 'unbefugt',
      behauptet: beleg.art === 'gefaelscht' ? beleg.behauptet : 0,
    }
  }
  return { roh, vonKonto: beleg.vonKonto }
}

/**
 * Liest die Gruppeninfo. Erst der neue Block, dann der alte Rollenblock.
 *
 * `darfSchreiben` prüft, ob der Unterzeichner die Info setzen durfte. Ohne die
 * Angabe wird nur beglaubigt; das ist die schwächere Betriebsart für Stellen,
 * die die Mitgliederzeile noch nicht kennen.
 */
export async function ladeGruppenInfo(
  kontext: GruppenKontext,
  darfSchreiben?: (konto: number) => boolean,
): Promise<InfoLesung> {
  const antwort = await getGroupInfo(kontext.groupId)

  if (!antwort || !antwort.blob) {
    // Der Altbestand: Name, Beschreibung und Logo im Rollenblock.
    const alt = await ladeGruppenzustand(kontext)
    if (alt.art === 'zustand') {
      return {
        art: 'info',
        info: {
          v: INFO_FORMAT,
          name: alt.zustand.name ?? null,
          beschreibung: alt.zustand.beschreibung ?? null,
          logo: alt.zustand.logo ?? null,
        },
        revision: 0,
        vonKonto: alt.vonKonto,
        quelle: 'config',
      }
    }
    return alt
  }

  const gelesen = await leseBlock(kontext, antwort.blob, 'info')
  if ('art' in gelesen) {
    return {
      art: gelesen.art,
      ...(gelesen.art === 'kein-schluessel' ? { keyId: '', revision: antwort.revision } : {}),
      ...(gelesen.art === 'unbefugt'
        ? { behauptet: gelesen.behauptet ?? 0, revision: antwort.revision }
        : {}),
      ...(gelesen.art === 'unlesbar'
        ? { grund: gelesen.grund ?? 'unbekannt', revision: antwort.revision }
        : {}),
    } as InfoLesung
  }
  if (darfSchreiben && !darfSchreiben(gelesen.vonKonto)) {
    return { art: 'unbefugt', behauptet: gelesen.vonKonto, revision: antwort.revision }
  }

  const info = alsInfo(gelesen.roh)
  if (!info) {
    return { art: 'unlesbar', grund: 'unbekanntes-format', revision: antwort.revision }
  }
  return {
    art: 'info',
    info,
    revision: antwort.revision,
    vonKonto: gelesen.vonKonto,
    quelle: 'info',
  }
}

export async function ladeGruppenHintergrund(
  kontext: GruppenKontext,
  darfSchreiben?: (konto: number) => boolean,
): Promise<HintergrundLesung> {
  const antwort = await getGroupBackground(kontext.groupId)
  if (!antwort || !antwort.blob) return { art: 'leer' }

  const gelesen = await leseBlock(kontext, antwort.blob, 'background')
  if ('art' in gelesen) {
    return {
      art: gelesen.art,
      ...(gelesen.art === 'kein-schluessel' ? { keyId: '', revision: antwort.revision } : {}),
      ...(gelesen.art === 'unbefugt'
        ? { behauptet: gelesen.behauptet ?? 0, revision: antwort.revision }
        : {}),
      ...(gelesen.art === 'unlesbar'
        ? { grund: gelesen.grund ?? 'unbekannt', revision: antwort.revision }
        : {}),
    } as HintergrundLesung
  }
  if (darfSchreiben && !darfSchreiben(gelesen.vonKonto)) {
    return { art: 'unbefugt', behauptet: gelesen.vonKonto, revision: antwort.revision }
  }

  const hintergrund = alsHintergrund(gelesen.roh)
  if (!hintergrund) {
    return { art: 'unlesbar', grund: 'unbekanntes-format', revision: antwort.revision }
  }
  return {
    art: 'hintergrund',
    hintergrund,
    revision: antwort.revision,
    vonKonto: gelesen.vonKonto,
  }
}

async function unterschreibe(
  kontext: GruppenKontext,
  nutzlast: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const unterschrieben = await signiereNutzlast(signaturKontext(kontext), kontext.eigeneId, nutzlast)
  if (typeof unterschrieben.sig !== 'string' || !unterschrieben.sig) return null
  return unterschrieben
}

export async function schreibeGruppenInfo(
  kontext: GruppenKontext,
  info: GruppenInfo,
  erwarteteRevision: number,
): Promise<Infoschreibung> {
  const nutzlast = await unterschreibe(kontext, {
    v: INFO_FORMAT,
    name: info.name ?? null,
    beschreibung: info.beschreibung ?? null,
    logo: info.logo ?? null,
  })
  if (!nutzlast) return { art: 'nicht-unterschreibbar' }

  const umschlag = await verschluesseleFuerGruppe(kontext, JSON.stringify(nutzlast), 'info')
  try {
    const gespeichert = await putGroupInfo(kontext.groupId, umschlag, erwarteteRevision)
    meldeGeschrieben(kontext.groupId, 'info', gespeichert.revision)
    return { art: 'gespeichert', revision: gespeichert.revision }
  } catch (fehler) {
    if ((fehler as { status?: number })?.status === 409) return { art: 'konflikt' }
    throw fehler
  }
}

export async function schreibeGruppenHintergrund(
  kontext: GruppenKontext,
  hintergrund: GruppenHintergrund,
  erwarteteRevision: number,
  mime: string | null,
): Promise<Hintergrundschreibung> {
  const nutzlast = await unterschreibe(kontext, {
    v: HINTERGRUND_FORMAT,
    preset: hintergrund.preset ?? null,
    dim: alsDim(hintergrund.dim),
    bild: hintergrund.bild ?? null,
  })
  if (!nutzlast) return { art: 'nicht-unterschreibbar' }

  const umschlag = await verschluesseleFuerGruppe(
    kontext,
    JSON.stringify(nutzlast),
    'background',
  )
  try {
    const gespeichert = await putGroupBackground(
      kontext.groupId,
      umschlag,
      erwarteteRevision,
      mime,
    )
    meldeGeschrieben(kontext.groupId, 'background', gespeichert.revision)
    return { art: 'gespeichert', revision: gespeichert.revision }
  } catch (fehler) {
    if ((fehler as { status?: number })?.status === 409) return { art: 'konflikt' }
    throw fehler
  }
}

/**
 * Lesen, ändern, schreiben — und bei einem Konflikt noch einmal.
 *
 * Zwei Versuche, wie beim Rollenblock: wer zweimal verliert, hat kein
 * Nebenläufigkeitsproblem mehr, sondern ein anderes.
 */
export async function aendereGruppenInfo(
  kontext: GruppenKontext,
  darfSchreiben: (konto: number) => boolean,
  aendere: (vorher: GruppenInfo) => GruppenInfo,
): Promise<Infoschreibung | { art: 'nicht-lesbar'; lesung: InfoLesung }> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const lesung = await ladeGruppenInfo(kontext, darfSchreiben)
    if (lesung.art !== 'info' && lesung.art !== 'leer') {
      return { art: 'nicht-lesbar', lesung }
    }
    const vorher: GruppenInfo =
      lesung.art === 'info'
        ? lesung.info
        : { v: INFO_FORMAT, name: null, beschreibung: null, logo: null }
    const revision = lesung.art === 'info' ? lesung.revision : 0

    const ergebnis = await schreibeGruppenInfo(kontext, aendere(vorher), revision)
    if (ergebnis.art !== 'konflikt') return ergebnis
  }
  return { art: 'konflikt' }
}

export async function aendereGruppenHintergrund(
  kontext: GruppenKontext,
  darfSchreiben: (konto: number) => boolean,
  aendere: (vorher: GruppenHintergrund) => GruppenHintergrund,
  mime: string | null,
): Promise<Hintergrundschreibung | { art: 'nicht-lesbar'; lesung: HintergrundLesung }> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const lesung = await ladeGruppenHintergrund(kontext, darfSchreiben)
    if (lesung.art !== 'hintergrund' && lesung.art !== 'leer') {
      return { art: 'nicht-lesbar', lesung }
    }
    const vorher: GruppenHintergrund =
      lesung.art === 'hintergrund'
        ? lesung.hintergrund
        : { v: HINTERGRUND_FORMAT, preset: null, dim: 25, bild: null }
    const revision = lesung.art === 'hintergrund' ? lesung.revision : 0

    const ergebnis = await schreibeGruppenHintergrund(
      kontext,
      aendere(vorher),
      revision,
      mime,
    )
    if (ergebnis.art !== 'konflikt') return ergebnis
  }
  return { art: 'konflikt' }
}
