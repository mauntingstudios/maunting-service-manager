/**
 * Die Ablage der Chat-Hintergründe: je Konto, im Siegel des Messengers.
 *
 * Bis 10/2026 lag die Wahl offen im `localStorage` und galt für den ganzen
 * Messenger. Ein eigenes Bild pro Chat ist Nutzerinhalt wie der Verlauf
 * daneben — es gehört dem angemeldeten Konto und nicht dem Browser. Deshalb
 * liegt es in derselben IndexedDB wie der Verlauf (`messengerLocalStore`,
 * Version 11) und wird mit demselben Schlüssel versiegelt.
 *
 * Lesbar bleibt nur der Platz (`direkt:<id>`, `global:messenger`, `global:ki`).
 * Ohne diesen Schlüssel gäbe es keinen Index; er sagt niemandem, welches Bild
 * dort liegt.
 */

import {
  ladeHintergrundZeilen,
  loescheHintergrundZeile,
  speichereHintergrundZeile,
} from '@/services/messengerLocalStore'

export function globalerSchluessel(bereich: 'messenger' | 'ki'): string {
  return `global:${bereich}`
}

export function direkterSchluessel(peerId: number): string {
  return `direkt:${peerId}`
}

/** Alle gespeicherten Plätze mit ihrem rohen, entsiegelten Inhalt. */
export async function leseHintergrundAblage(): Promise<Map<string, Record<string, unknown>>> {
  const karte = new Map<string, Record<string, unknown>>()
  for (const zeile of await ladeHintergrundZeilen()) {
    const schluessel = String(zeile.schluessel ?? '')
    if (!schluessel) continue
    karte.set(schluessel, zeile)
  }
  return karte
}

export async function schreibeHintergrundAblage(
  schluessel: string,
  wert: Record<string, unknown>,
): Promise<void> {
  await speichereHintergrundZeile(schluessel, wert)
}

export async function loescheHintergrundAblage(schluessel: string): Promise<void> {
  await loescheHintergrundZeile(schluessel)
}

/** Alle direkten Chat-Hintergründe entfernen — für „für alle Chats". */
export async function entferneDirekteHintergruende(): Promise<void> {
  const karte = await leseHintergrundAblage()
  for (const schluessel of karte.keys()) {
    if (schluessel.startsWith('direkt:')) {
      await loescheHintergrundAblage(schluessel)
    }
  }
}
