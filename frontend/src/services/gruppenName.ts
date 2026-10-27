/**
 * Wie eine Gruppe heisst — seit Stufe 6 weiss das nur noch der Client.
 *
 * `chat_groups.name`, `description` und `avatar_url` sind geräumt. Der Server
 * kennt sie nicht mehr, und das ist der Punkt: der Name einer Gruppe ist die
 * eine Zeile, aus der sich ohne jede Nachricht ablesen lässt, worum es geht.
 *
 * **Zwei Quellen, und beide braucht es.**
 *
 * 1. *Der verschlüsselte Gruppenblock* (`gruppenKonfig.ts`). Er reist über den
 *    Server und erreicht damit auch ein Gerät, das die Gruppe noch nie gesehen
 *    hat — aber nur, wenn es den Gruppenschlüssel schon hat.
 * 2. *Der örtliche Namensspeicher*, diese Datei. Er antwortet sofort, ohne
 *    Netz und ohne Schlüssel, und er trägt den Namen über den Moment, in dem
 *    die Migration die Spalte geleert hat.
 *
 * Ohne (1) verlöre man den Namen bei jedem Gerätewechsel. Ohne (2) stünde beim
 * Start jeder Sitzung erst einmal „Verschlüsselte Gruppe" in der Liste, bis
 * für jede Gruppe ein Block geholt und entschlüsselt ist — und für Gruppen
 * ohne Schlüssel für immer.
 *
 * **Versiegelt, nicht im Klartext.** Die Zusage lautet „so wenig wie möglich,
 * und was gespeichert wird, ist verschlüsselt — auch im lokalen Speicher". Ein
 * Gruppenname in einem offenen `localStorage`-Eintrag wäre genau die
 * Metadatenzeile, die gerade aus der Datenbank entfernt wurde, nur auf einer
 * anderen Platte. Ist der Messenger verschlossen, gibt es hier keine Namen —
 * das ist richtig so und kein Fehler.
 */

import type { ChatGroupItem } from '@/api/social'
import { entsiegleZeile, istOffen, versiegleZeile } from './lokaleVersiegelung'
import {
  aendereGruppenInfo,
  INFO_FORMAT,
  ladeGruppenInfo,
  type GruppenInfo,
} from './gruppenInfo'
import type { GruppenKontext } from './gruppenSchluessel'

const ABLAGE_SCHLUESSEL = 'msm:gruppennamen'

/**
 * Bindet jede Zeile an ihre Gruppe.
 *
 * Zwei Zeilen zu tauschen ergibt damit keine gültige Zeile mehr, sondern
 * einen Entschlüsselungsfehler — sonst liesse sich der Name einer Gruppe
 * unter der Kennung einer anderen unterschieben.
 */
function namensAad(groupId: number): string {
  return `msm-gruppenname:${groupId}`
}

/** Was über eine Gruppe zu wissen ist, ohne eine einzige Nachricht zu lesen. */
export interface GruppenAnsicht {
  name?: string | null
  beschreibung?: string | null
  logo?: string | null
}

/**
 * Der entsiegelte Stand im Arbeitsspeicher.
 *
 * `null` heisst „noch nicht geladen". Geladen wird einmal je Sitzung; die
 * Entsiegelung kostet eine AES-Operation, und die Liste wird bei jedem Abruf
 * der Gruppen gebraucht.
 */
let stand: Map<number, GruppenAnsicht> | null = null

/**
 * War der Messenger beim letzten Laden verschlossen?
 *
 * Dann ist `stand` leer, aber nicht, weil es nichts gäbe — es war nur nichts
 * zu öffnen. Ohne diese Marke bliebe die Liste nach dem Entsperren bis zum
 * nächsten Neuladen der Seite namenlos: der erste Aufruf fiele vor der
 * Eingabe der PIN, und jeder weitere bekäme die leere Karte aus dem Cache.
 */
let standWarZu = false

function leseRoh(): Record<string, unknown> | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const roh = localStorage.getItem(ABLAGE_SCHLUESSEL)
    return roh ? (JSON.parse(roh) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function sauber(wert: unknown, hoechstens: number): string | null {
  if (typeof wert !== 'string') return null
  const text = wert.trim()
  return text ? text.slice(0, hoechstens) : null
}

function alsLogo(wert: unknown): string | null {
  return typeof wert === 'string' &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(wert)
    ? wert
    : null
}

function alsAnsicht(roh: unknown): GruppenAnsicht | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Record<string, unknown>
  const name = sauber(r.name, 64)
  const beschreibung = sauber(r.beschreibung, 256)
  const logo = alsLogo(r.logo)
  if (!name && !beschreibung && !logo) return null
  return { name, beschreibung, logo }
}

/**
 * Lädt den versiegelten Stand. Mehrfach aufrufbar; lädt nur einmal — ausser
 * der letzte Versuch fiel in eine verschlossene Ablage.
 */
export async function ladeGruppenNamen(): Promise<Map<number, GruppenAnsicht>> {
  if (stand && !(standWarZu && istOffen())) return stand
  const frisch = new Map<number, GruppenAnsicht>()
  const roh = leseRoh()
  if (roh && istOffen()) {
    for (const [kennung, zeile] of Object.entries(roh)) {
      const id = Number(kennung)
      if (!Number.isInteger(id) || id <= 0) continue
      try {
        const offen = await entsiegleZeile<Record<string, unknown>>(
          zeile as never,
          namensAad(id),
        )
        const ansicht = alsAnsicht(offen)
        if (ansicht) frisch.set(id, ansicht)
      } catch {
        // Eine Zeile, die sich nicht öffnen lässt, nimmt die anderen nicht mit.
      }
    }
  }
  stand = frisch
  standWarZu = !istOffen()
  return stand
}

async function schreibeStand(): Promise<void> {
  if (!stand || typeof localStorage === 'undefined' || !istOffen()) return
  const raus: Record<string, unknown> = {}
  for (const [id, ansicht] of stand) {
    try {
      // Kein Klarfeld: an einer Zeile, die nur aus Name, Beschreibung und
      // Logo besteht, gibt es nichts, was lesbar bleiben müsste.
      raus[String(id)] = await versiegleZeile(ansicht as never, [], namensAad(id))
    } catch {
      // Versiegelt oder gar nicht. Ein Klartextname wäre schlimmer als ein
      // fehlender.
    }
  }
  try {
    localStorage.setItem(ABLAGE_SCHLUESSEL, JSON.stringify(raus))
  } catch {
    // Voller Speicher. Der Name steht im Block; beim nächsten Öffnen kommt er
    // von dort.
  }
}

/** Schreibt den vorhandenen Stand beim PIN-Wechsel neu. */
export async function schreibeGruppenNamenBestandNeu(): Promise<number> {
  await ladeGruppenNamen()
  if (!stand) return 0
  await schreibeStand()
  return stand.size
}

/**
 * Merkt sich, wie eine Gruppe heisst.
 *
 * Überschreibt, statt den ersten Stand zu halten — anders als bei den
 * Geheimnissen. Ein Name ist kein Schlüssel: eine spätere Fassung ist die
 * richtigere, und ein falscher Name kostet eine Überschrift, keinen Zugang.
 *
 * Ein Feld, das ausdrücklich `null` oder leer ist, **löscht** den bisherigen
 * Wert. Ein fehlendes Feld lässt ihn stehen. Ohne diese Unterscheidung würde
 * ein geleerter Name für immer stehen bleiben: der frühere `??`-Merge nahm
 * den alten Wert, sobald der neue `null` war.
 */
export async function merkeGruppenName(
  groupId: number,
  ansicht: GruppenAnsicht,
): Promise<void> {
  if (!Number.isInteger(groupId) || groupId <= 0) return
  const karte = await ladeGruppenNamen()
  const bisher = karte.get(groupId)
  const naechste: GruppenAnsicht = {
    name: ansicht.name !== undefined ? sauber(ansicht.name, 64) : bisher?.name ?? null,
    beschreibung:
      ansicht.beschreibung !== undefined
        ? sauber(ansicht.beschreibung, 256)
        : bisher?.beschreibung ?? null,
    logo: ansicht.logo !== undefined ? alsLogo(ansicht.logo) : bisher?.logo ?? null,
  }
  if (!naechste.name && !naechste.beschreibung && !naechste.logo) {
    if (!karte.delete(groupId)) return
  } else {
    karte.set(groupId, naechste)
  }
  await schreibeStand()
}

/** Beim Verlassen einer Gruppe. Was weg ist, soll auch hier weg sein. */
export async function vergissGruppenName(groupId: number): Promise<void> {
  const karte = await ladeGruppenNamen()
  if (!karte.delete(groupId)) return
  await schreibeStand()
}

/** Beim Abmelden. Der nächste Mensch an diesem Gerät erbt keine Gruppennamen. */
export function leereGruppenNamen(): void {
  stand = null
  standWarZu = false
  try {
    localStorage?.removeItem(ABLAGE_SCHLUESSEL)
  } catch {
    /* nichts zu räumen */
  }
}

/**
 * Setzt Name, Beschreibung und Logo in eine Gruppenliste ein — und ordnet sie.
 *
 * Der Server liefert dort seit Stufe 6 überall `null`. Diese Stelle ist der
 * Ersatz — und sie sitzt bewusst an der Liste und nicht an jeder Anzeige
 * einzeln: so bleibt `ChatGroupItem.name` das eine Feld, aus dem die
 * Oberfläche liest, und nichts weiter unten muss von der Änderung wissen.
 *
 * Sortiert wird hier mit, aus demselben Grund. Der Server gibt die Gruppen
 * seit der Räumung nach Alter heraus, weil er keinen Namen mehr kennt, nach
 * dem er ordnen könnte. Alphabetisch geht erst hier, hinter der
 * Entschlüsselung — und namenlose Gruppen fallen ans Ende, statt sich unter
 * einer gemeinsamen Überschrift zwischen die benannten zu mischen.
 */
export async function benenneGruppen(gruppen: ChatGroupItem[]): Promise<ChatGroupItem[]> {
  if (gruppen.length === 0) return gruppen
  const karte = await ladeGruppenNamen()
  const benannt =
    karte.size === 0
      ? gruppen
      : gruppen.map((g) => {
          const ansicht = karte.get(g.id)
          if (!ansicht) return g
          return {
            ...g,
            name: g.name ?? ansicht.name ?? null,
            description: g.description ?? ansicht.beschreibung ?? null,
            avatar_url: g.avatar_url ?? ansicht.logo ?? null,
          }
        })

  return [...benannt].sort((a, b) => {
    if (!a.name && !b.name) return a.id - b.id
    if (!a.name) return 1
    if (!b.name) return -1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/**
 * Holt Name, Beschreibung und Logo aus dem verschlüsselten Info-Block.
 *
 * Der Weg für ein frisches Gerät: dort ist der örtliche Speicher leer, und der
 * Block ist die einzige Quelle. Fehlt der neue Info-Block, liest
 * `ladeGruppenInfo` den Altbestand aus dem Rollenblock.
 *
 * Bewusst **ohne** `darfSchreiben`: wer den Namen gesetzt hat, ist hier egal.
 * Ein untergeschobener Name ist eine falsche Überschrift, kein Zugang — und
 * eine Befugnisprüfung bräuchte die Rollenlage, die selbst erst aus dem
 * Rollenblock kommt.
 */
export async function holeGruppenAnsicht(
  kontext: GruppenKontext,
): Promise<GruppenAnsicht | null> {
  try {
    const lesung = await ladeGruppenInfo(kontext)
    if (lesung.art !== 'info') return null
    const ansicht: GruppenAnsicht = {
      name: lesung.info.name,
      beschreibung: lesung.info.beschreibung,
      logo: lesung.info.logo,
    }
    // Auch ein bewusst geleerter Block räumt den örtlichen Namen weg.
    await merkeGruppenName(kontext.groupId, ansicht)
    return alsAnsicht(ansicht)
  } catch {
    return null
  }
}

/**
 * Schreibt Name, Beschreibung und Logo in den Info-Block.
 *
 * `undefined` heisst „nicht angefasst", `null` oder leer heisst „leeren". Ein
 * Aufruf, der nur das Logo setzt, lässt Name und Beschreibung stehen.
 *
 * Gibt zurück, ob es geklappt hat. Ein `false` ist kein Grund, das Anlegen
 * einer Gruppe abzubrechen — der örtliche Speicher trägt den Namen, und der
 * nächste Versuch holt den Block nach.
 */
export async function sichereGruppenAnsicht(
  kontext: GruppenKontext,
  ansicht: GruppenAnsicht,
): Promise<boolean> {
  await merkeGruppenName(kontext.groupId, ansicht)
  try {
    const ergebnis = await aendereGruppenInfo(
      kontext,
      () => true,
      (vorher: GruppenInfo): GruppenInfo => ({
        v: INFO_FORMAT,
        name: ansicht.name !== undefined ? sauber(ansicht.name, 64) : vorher.name,
        beschreibung:
          ansicht.beschreibung !== undefined
            ? sauber(ansicht.beschreibung, 256)
            : vorher.beschreibung,
        logo: ansicht.logo !== undefined ? alsLogo(ansicht.logo) : vorher.logo,
      }),
    )
    return ergebnis.art === 'gespeichert'
  } catch {
    return false
  }
}
