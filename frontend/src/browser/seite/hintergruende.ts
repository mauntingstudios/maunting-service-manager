import type React from 'react'
import { alleSaisonMotive, jahreszeit, saisonBildFuerPhase, tageszeit } from '@/lib/tageszeit'
import type { Hintergrund } from '../services/einstellungenStore'

export interface BildHintergrund {
  id: string
  pfad: string
  titelKey: string
}

export const BILD_HINTERGRUENDE: BildHintergrund[] = [
  // Saisonale Alpenmotive (Frühling, Sommer, Herbst, Winter × 4 Tageszeiten)
  { id: 'alpen_fruehling_morgen', pfad: saisonBildFuerPhase('morgen', 'singra', 'fruehling'), titelKey: 'browser.hintergrund.alpen_fruehling_morgen' },
  { id: 'alpen_fruehling_tag', pfad: saisonBildFuerPhase('tag', 'singra', 'fruehling'), titelKey: 'browser.hintergrund.alpen_fruehling_tag' },
  { id: 'alpen_fruehling_abend', pfad: saisonBildFuerPhase('abend', 'singra', 'fruehling'), titelKey: 'browser.hintergrund.alpen_fruehling_abend' },
  { id: 'alpen_fruehling_nacht', pfad: saisonBildFuerPhase('nacht', 'singra', 'fruehling'), titelKey: 'browser.hintergrund.alpen_fruehling_nacht' },
  { id: 'alpen_sommer_morgen', pfad: saisonBildFuerPhase('morgen', 'singra', 'sommer'), titelKey: 'browser.hintergrund.alpen_sommer_morgen' },
  { id: 'alpen_sommer_tag', pfad: saisonBildFuerPhase('tag', 'singra', 'sommer'), titelKey: 'browser.hintergrund.alpen_sommer_tag' },
  { id: 'alpen_sommer_abend', pfad: saisonBildFuerPhase('abend', 'singra', 'sommer'), titelKey: 'browser.hintergrund.alpen_sommer_abend' },
  { id: 'alpen_sommer_nacht', pfad: saisonBildFuerPhase('nacht', 'singra', 'sommer'), titelKey: 'browser.hintergrund.alpen_sommer_nacht' },
  { id: 'alpen_herbst_morgen', pfad: saisonBildFuerPhase('morgen', 'singra', 'herbst'), titelKey: 'browser.hintergrund.alpen_herbst_morgen' },
  { id: 'alpen_herbst_tag', pfad: saisonBildFuerPhase('tag', 'singra', 'herbst'), titelKey: 'browser.hintergrund.alpen_herbst_tag' },
  { id: 'alpen_herbst_abend', pfad: saisonBildFuerPhase('abend', 'singra', 'herbst'), titelKey: 'browser.hintergrund.alpen_herbst_abend' },
  { id: 'alpen_herbst_nacht', pfad: saisonBildFuerPhase('nacht', 'singra', 'herbst'), titelKey: 'browser.hintergrund.alpen_herbst_nacht' },
  { id: 'alpen_winter_morgen', pfad: saisonBildFuerPhase('morgen', 'singra', 'winter'), titelKey: 'browser.hintergrund.alpen_winter_morgen' },
  { id: 'alpen_winter_tag', pfad: saisonBildFuerPhase('tag', 'singra', 'winter'), titelKey: 'browser.hintergrund.alpen_winter_tag' },
  { id: 'alpen_winter_abend', pfad: saisonBildFuerPhase('abend', 'singra', 'winter'), titelKey: 'browser.hintergrund.alpen_winter_abend' },
  { id: 'alpen_winter_nacht', pfad: saisonBildFuerPhase('nacht', 'singra', 'winter'), titelKey: 'browser.hintergrund.alpen_winter_nacht' },
  // Klassische Landschaften & Orte
  { id: 'bergwald', pfad: '/hintergruende/bergwald.webp', titelKey: 'browser.hintergrund.bergwald' },
  { id: 'bergsee', pfad: '/hintergruende/bergsee.webp', titelKey: 'browser.hintergrund.bergsee' },
  { id: 'feld', pfad: '/hintergruende/feld.webp', titelKey: 'browser.hintergrund.feld' },
  { id: 'balkon', pfad: '/hintergruende/balkon.webp', titelKey: 'browser.hintergrund.balkon' },
  { id: 'bahnhof', pfad: '/hintergruende/bahnhof.webp', titelKey: 'browser.hintergrund.bahnhof' },
  // Statische Weltraum- & Ozeanszenen (bewusst außerhalb der Jahreszeiten-Automatik)
  { id: 'erde', pfad: '/hintergruende/erde.webp', titelKey: 'browser.hintergrund.erde' },
  { id: 'sonnensystem', pfad: '/hintergruende/sonnensystem.webp', titelKey: 'browser.hintergrund.sonnensystem' },
  { id: 'mars', pfad: '/hintergruende/mars.webp', titelKey: 'browser.hintergrund.mars' },
  { id: 'ozean', pfad: '/hintergruende/ozean.webp', titelKey: 'browser.hintergrund.ozean' },
  { id: 'wasserfaelle', pfad: '/hintergruende/wasserfaelle.webp', titelKey: 'browser.hintergrund.wasserfaelle' },
]

export const FARB_HINTERGRUENDE: Record<'schlicht' | 'nacht' | 'wald' | 'tiefsee', string> = {
  schlicht: 'none',
  nacht: 'linear-gradient(135deg, #090a1a 0%, #17153b 50%, #0c0d1b 100%)',
  wald: 'linear-gradient(135deg, #021a14 0%, #063c2c 50%, #03120e 100%)',
  tiefsee: 'linear-gradient(135deg, #050b14 0%, #0d2137 50%, #030712 100%)',
}
export const HINTERGRUENDE = FARB_HINTERGRUENDE

export interface HintergrundGruppe {
  id: 'automatisch' | 'jahreszeiten' | 'landschaften' | 'weltraum' | 'farben'
  titelKey: string
  optionen: Hintergrund[]
}

/** Aufgeräumte Kategorien für die Startseiten-Auswahl in den Einstellungen. */
export const HINTERGRUND_GRUPPEN: readonly HintergrundGruppe[] = [
  {
    id: 'automatisch',
    titelKey: 'browser.hintergrundGruppe.automatisch',
    optionen: ['wechsel'],
  },
  {
    id: 'jahreszeiten',
    titelKey: 'browser.hintergrundGruppe.jahreszeiten',
    optionen: [
      'alpen_fruehling_morgen',
      'alpen_fruehling_tag',
      'alpen_fruehling_abend',
      'alpen_fruehling_nacht',
      'alpen_sommer_morgen',
      'alpen_sommer_tag',
      'alpen_sommer_abend',
      'alpen_sommer_nacht',
      'alpen_herbst_morgen',
      'alpen_herbst_tag',
      'alpen_herbst_abend',
      'alpen_herbst_nacht',
      'alpen_winter_morgen',
      'alpen_winter_tag',
      'alpen_winter_abend',
      'alpen_winter_nacht',
    ],
  },
  {
    id: 'landschaften',
    titelKey: 'browser.hintergrundGruppe.landschaften',
    optionen: ['bergwald', 'bergsee', 'feld', 'balkon', 'bahnhof'],
  },
  {
    id: 'weltraum',
    titelKey: 'browser.hintergrundGruppe.weltraum',
    optionen: ['erde', 'sonnensystem', 'mars', 'ozean', 'wasserfaelle'],
  },
  {
    id: 'farben',
    titelKey: 'browser.hintergrundGruppe.farben',
    optionen: ['schlicht', 'nacht', 'wald', 'tiefsee'],
  },
]

/** Alle waehlbaren Hintergrund-Schluessel in der Reihenfolge fuer die UI. */
export const HINTERGRUND_OPTIONEN: Hintergrund[] = HINTERGRUND_GRUPPEN.flatMap((g) => g.optionen)

/** Liefert das alle 30 Minuten passende Motiv zur aktuellen Tageszeit und Jahreszeit. */
export function aktuellesWechselBild(zeit: number = Date.now()): BildHintergrund {
  const datum = new Date(zeit)
  const pfade = alleSaisonMotive(datum.getHours(), datum)
  const intervall = 30 * 60 * 1000
  const index = Math.floor(Math.abs(zeit) / intervall) % pfade.length
  const pfad = pfade[index]
  const gefunden = BILD_HINTERGRUENDE.find((b) => b.pfad === pfad)
  return (
    gefunden ?? {
      id: `wechsel-${jahreszeit(datum)}-${tageszeit(datum.getHours())}`,
      pfad,
      titelKey: 'browser.hintergrund.wechsel',
    }
  )
}

/** Ermittelt den CSS-Hintergrundstil (Gradient oder Bild-URL). */
export function hintergrundStil(
  hintergrund: Hintergrund,
  eigenesBild: string | null,
  zeit: number = Date.now(),
): React.CSSProperties {
  if (hintergrund === 'eigen' && eigenesBild) {
    return { backgroundImage: `url("${eigenesBild}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  if (hintergrund === 'wechsel') {
    const bild = aktuellesWechselBild(zeit)
    return { backgroundImage: `url("${bild.pfad}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  const festesBild = BILD_HINTERGRUENDE.find((b) => b.id === hintergrund)
  if (festesBild) {
    return { backgroundImage: `url("${festesBild.pfad}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  const verlauf = FARB_HINTERGRUENDE[hintergrund as keyof typeof FARB_HINTERGRUENDE] ?? 'none'
  return verlauf === 'none' ? {} : { background: verlauf }
}

/**
 * Konvertiert ein hochgeladenes Bild (PNG, JPG, etc.) clientseitig
 * direkt in verlustarmes WebP mit 85 % Qualitaet fuer minimale Speichergroesse.
 */
export function bildZuWebp(datei: File, qualitaet = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const blobUrl = URL.createObjectURL(datei)
    img.onload = () => {
      URL.revokeObjectURL(blobUrl)
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas Context nicht verfuegbar'))
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/webp', qualitaet))
    }
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl)
      reject(new Error('Bild konnte nicht dekodiert werden'))
    }
    img.src = blobUrl
  })
}
