// @vitest-environment node
import { describe, expect, it } from 'vitest'

/**
 * Verbindlicher Inventar- und Abdeckungstest für alle Mikrofon-,
 * Spracherkennungs- und Kamera-Einstiegspunkte im Frontend.
 *
 * Ziel: Keine Stelle im Produktcode darf unbemerkt ein Mikrofon zum Sprechen
 * öffnen, ohne entweder Audio-Ducking über `duckingBelegen` / den Anrufstore
 * auszulösen oder hier explizit als Nicht-Sprech-Ausnahme begründet zu sein.
 */
const QUELLEN = import.meta.glob(
  [
    '/src/**/*.{ts,tsx}',
    '!/src/**/*.test.{ts,tsx}',
    '!/src/**/*.spec.{ts,tsx}',
    '!/src/test/**',
    '/packages/maunting-ui/src/**/*.{ts,tsx}',
    '!/packages/maunting-ui/src/**/*.test.{ts,tsx}',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>

const MIKROFON_MUSTER =
  /\b(?:getUserMedia|webkitSpeechRecognition|SpeechRecognition|MediaRecorder|starteAufnahme|starteAudioAufnahme|sprachEingabe|wakewordAufnehmen)\b/g

/**
 * Aktive Sprech-Orte, die während aktiver Mikrofonaufnahme Ducking auslösen
 * müssen. Zu jedem Ort wird geprüft, ob `duckingBelegen` tatsächlich importiert
 * und aufgerufen wird.
 */
const AKTIVE_SPRECH_ORTE: Record<string, string> = {
  '/src/components/ai/voice/useSprachsitzung.ts': 'Realtime-KI-Sprachsitzung (WebRTC & Legacy)',
  '/src/components/ai/AiChat.tsx': 'KI-Chat Diktat (Speech-to-Text)',
  '/src/browser/services/sprachsuche.ts': 'Pontis Browser Sprachsuche (Whisper, Web Speech & Android)',
  '/src/hooks/useSprachaufnahme.ts': 'Messenger Sprachnachricht-Aufnahme',
  '/src/components/social/CircularVideoNoteRecorder.tsx': 'Messenger Videonotiz-Aufnahme mit Mikrofon',
  '/src/stores/useCallStore.ts': 'Messenger Anruf (Audio/Video via LiveKit)',
  '/src/desktop/WakewordEinrichtung.tsx': 'Explizite Wake-Word-Kalibrierung',
}

/**
 * Dokumentierte Ausnahmen: öffnen ein Gerät nur für Loopback-Test, reine
 * Kamera ohne Ton oder sind reine Low-Level-Capture-Bausteine, deren
 * Aufrufer das Ducking semantisch verwalten.
 */
const BEGRUENDETE_AUSNAHMEN: Record<string, string> = {
  '/src/components/ai/voice/audioAufnahme.ts':
    'Low-Level-Mikrofon-Pipeline; Aufrufer (useSprachsitzung, AiChat) verwalten Ducking.',
  '/src/browser/services/lokalesWhisper.ts':
    'Low-Level-Whisper-Capture; Aufrufer (useSprachsuche) verwaltet Ducking exakt für die Sprechdauer.',
  '/src/pages/profile/AudioTab.tsx':
    'Web-Profil Mikrofon-Testhören (Loopback-Selbsttest; soll Hintergrundaudio nicht verdecken).',
  '/src/desktop/einstellungsreiter/Testhoeren.tsx':
    'MSS Mikrofon-Testhören (Loopback-Selbsttest; soll kein Ducking auslösen).',
  '/src/hooks/useBackgroundQrScanner.ts':
    'Reiner Kamera-QR-Scanner ohne Mikrofonzugriff (video-only).',
  '/src/desktop/QrScannerModal.tsx':
    'Reiner Kamera-QR-Scanner ohne Mikrofonzugriff (video-only).',
  '/src/desktop/vault/QrScannerModal.tsx':
    'Reiner Kamera-QR-Scanner ohne Mikrofonzugriff (video-only).',
  '/src/components/social/CameraSnapshotModal.tsx':
    'Reiner Kamera-Foto-Schnappschuss ohne Mikrofonzugriff (video-only).',
}

/**
 * Hilfsfunktionen/Wrappers/Komponenten ohne eigenen Capture-Start, die das
 * Keyword z. B. nur typisieren, weiterreichen oder bereinigen (`nativ.ts`,
 * `audioAufnahme.ts`, etc.).
 */
const PASSIVE_TYPEN_UND_WRAPPERS = new Set<string>([
  '/src/browser/services/nativ.ts',
  '/src/desktop/tauri.ts',
])

function bereinigeKommentare(quelltext: string): string {
  return quelltext
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('Mikrofon-Inventar & Audio-Ducking-Abdeckung', () => {
  it('klassifiziert jede Mikrofon-, Spracherkennungs- und Recorder-Stelle im Frontend vollständig', () => {
    const nichtKlassifiziert: string[] = []

    for (const [pfad, inhalt] of Object.entries(QUELLEN)) {
      const bereinigt = bereinigeKommentare(inhalt)
      if (!MIKROFON_MUSTER.test(bereinigt)) continue
      MIKROFON_MUSTER.lastIndex = 0

      if (
        !(pfad in AKTIVE_SPRECH_ORTE) &&
        !(pfad in BEGRUENDETE_AUSNAHMEN) &&
        !PASSIVE_TYPEN_UND_WRAPPERS.has(pfad)
      ) {
        nichtKlassifiziert.push(pfad)
      }
    }

    expect(nichtKlassifiziert).toEqual([])
  })

  it('verdrahtet jeden aktiven Sprech-Ort mit `duckingBelegen` aus `@/lib/audioDucking`', () => {
    const fehlend: string[] = []

    for (const pfad of Object.keys(AKTIVE_SPRECH_ORTE)) {
      const inhalt = QUELLEN[pfad]
      expect(inhalt, `Erwartete Datei fehlt: ${pfad}`).toBeDefined()
      const bereinigt = bereinigeKommentare(inhalt)
      const hatImport = /@\/lib\/audioDucking/.test(bereinigt)
      const hatAufruf = /\bduckingBelegen\s*\(/.test(bereinigt)
      if (!hatImport || !hatAufruf) {
        fehlend.push(`${pfad} (${AKTIVE_SPRECH_ORTE[pfad]})`)
      }
    }

    expect(fehlend).toEqual([])
  })

  it('löst an reinen Selbsttest- und Kamera-Orten KEIN Ducking aus', () => {
    const unerwartet = [
      '/src/pages/profile/AudioTab.tsx',
      '/src/desktop/einstellungsreiter/Testhoeren.tsx',
      '/src/hooks/useBackgroundQrScanner.ts',
      '/src/desktop/QrScannerModal.tsx',
      '/src/desktop/vault/QrScannerModal.tsx',
      '/src/components/social/CameraSnapshotModal.tsx',
    ].filter((pfad) => /\bduckingBelegen\s*\(/.test(bereinigeKommentare(QUELLEN[pfad] ?? '')))

    expect(unerwartet).toEqual([])
  })

  it('enthält keine veraltete TTS-Ducking-Steuerung mehr in sprachKoordination.ts', () => {
    const koordination = bereinigeKommentare(QUELLEN['/src/desktop/sprachKoordination.ts'] ?? '')
    expect(koordination).not.toMatch(/\bduckingSetzen\s*\(/)
  })
})
