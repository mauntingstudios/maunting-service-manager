import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import {
  endPresenceSession,
  getOwnPresence,
  recordActivityTime,
  sendPresenceSession,
  setPresenceStatus,
  type PraesenzWahl,
} from '@/api/social'
import { aktivitaetFuerPfad } from '@/services/praesenz/aktivitaeten'
import {
  clientErkennen,
  geraeteKennung,
  plattformErkennen,
  type PraesenzPlattform,
} from '@/services/praesenz/sitzung'

/** Die Wahl des Menschen — was der Umschalter im Profil anbietet. */
export type PresenceStatus = PraesenzWahl

/** Nach so langer Ruhe gilt „abwesend“ (nur bei `auto`). */
export const INACTIVITY_TIMEOUT_MS = 300_000

/** Lebenszeichen: zwei verpasste Meldungen sind noch kein Offline. */
export const HERZSCHLAG_MS = 45_000

/** Zwei Meldungen in kurzer Folge (Route, Sichtbarkeit, Tippen) werden gebündelt. */
const MELDE_ABSTAND_MS = 5_000

export const ACTIVITY_CATEGORY_LABELS: Record<string, string> = {
  ai_chat: 'KI-Chat',
  general: 'Allgemein',
  server_admin: 'Server-Verwaltung',
  command_exec: 'Befehlsausführung',
}

export function formatActivityCategory(category: string): string {
  const norm = category.toLowerCase().trim()
  return ACTIVITY_CATEGORY_LABELS[norm] || norm.replace(/_/g, ' ')
}

/**
 * Präsenz: eine Wahl, ein Lebenszeichen je Gerät.
 *
 * Der Client meldet alle 45 Sekunden, bei einem Seitenwechsel, beim Wechsel
 * zwischen vorn und hinten und sobald die Automatik von „online“ auf
 * „abwesend“ springt. Damit gilt ein aktiver Nutzer nicht mehr nach zwei
 * Minuten als offline (bis 27.10.2026 wurde nur beim Routenwechsel gemeldet).
 *
 * Die Automatik greift nur bei der Wahl `auto`; `online`, `away` und
 * `invisible` sind Entscheidungen des Menschen und werden nicht überschrieben.
 */
export function usePresenceAndActivity(
  socialEnabled: boolean = true,
  enableActivityTracking: boolean = true
) {
  const { user } = useAuthStore()
  const location = useLocation()
  const [wahl, setWahl] = useState<PraesenzWahl>('auto')

  const wahlRef = useRef<PraesenzWahl>('auto')
  const kontoRef = useRef<number | null>(null)
  const geraetRef = useRef<string>('')
  const clientRef = useRef(clientErkennen())
  const plattformRef = useRef<PraesenzPlattform>('web')
  const pfadRef = useRef<string>(location.pathname)
  const letzteEingabeRef = useRef<number>(Date.now())
  const letzteMeldungRef = useRef<number>(0)
  const laeuftRef = useRef<boolean>(false)
  const nachholenRef = useRef<boolean>(false)
  const autoAwayRef = useRef<boolean>(false)
  const wegRef = useRef<boolean>(false)
  const activeSecondsRef = useRef<number>(0)
  const activeCategoryRef = useRef<string>('general')
  const lastAiInteractionTimeRef = useRef<number>(0)

  pfadRef.current = location.pathname

  // Konto, Gerät und Plattform
  useEffect(() => {
    kontoRef.current = user?.id ?? null
    if (!user?.id) {
      geraetRef.current = ''
      return
    }
    geraetRef.current = geraeteKennung(user.id)
    plattformRef.current = plattformErkennen(clientRef.current)
  }, [user?.id])

  const sichtbar = () =>
    typeof document === 'undefined' || document.visibilityState === 'visible'

  const zustandJetzt = useCallback((): 'online' | 'away' => {
    if (wahlRef.current === 'away') return 'away'
    if (wahlRef.current === 'online') return 'online'
    if (!sichtbar()) return 'away'
    return Date.now() - letzteEingabeRef.current >= INACTIVITY_TIMEOUT_MS ? 'away' : 'online'
  }, [])

  /** Ein Lebenszeichen. `sofort` umgeht die Bündelung (Takt, Sichtbarkeit). */
  const melde = useCallback(
    async (sofort = false) => {
      const konto = kontoRef.current
      const geraet = geraetRef.current
      if (!socialEnabled || !konto || !geraet || wegRef.current) return

      const jetzt = Date.now()
      if (!sofort && jetzt - letzteMeldungRef.current < MELDE_ABSTAND_MS) return
      if (laeuftRef.current) {
        nachholenRef.current = true
        return
      }

      laeuftRef.current = true
      letzteMeldungRef.current = jetzt
      try {
        await sendPresenceSession({
          geraet,
          client: clientRef.current,
          plattform: plattformRef.current,
          zustand: zustandJetzt(),
          activity_key: aktivitaetFuerPfad(pfadRef.current).key,
          vorn: sichtbar(),
        })
      } catch {
        // Kein Netz: der nächste Takt versucht es erneut.
      } finally {
        laeuftRef.current = false
        if (nachholenRef.current && !wegRef.current) {
          nachholenRef.current = false
          void melde(true)
        }
      }
    },
    [socialEnabled, zustandJetzt]
  )

  // Die eigene Wahl vom Server holen (anderes Gerät kann sie geändert haben).
  useEffect(() => {
    if (!socialEnabled || !user?.id) return
    let aktiv = true
    getOwnPresence()
      .then((stand) => {
        if (!aktiv) return
        const neu = stand.manual_status ?? 'auto'
        wahlRef.current = neu
        setWahl(neu)
      })
      .catch(() => {})
    return () => {
      aktiv = false
    }
  }, [socialEnabled, user?.id])

  // Erste Meldung und jede neue Seite
  useEffect(() => {
    if (!socialEnabled || !user?.id) return
    void melde(true)
  }, [socialEnabled, user?.id, location.pathname, melde])

  // Lebenszeichen
  useEffect(() => {
    if (!socialEnabled || !user?.id) return
    const takt = window.setInterval(() => void melde(true), HERZSCHLAG_MS)
    return () => window.clearInterval(takt)
  }, [socialEnabled, user?.id, melde])

  // Vorn/hinten: sofort melden, damit ein versteckter Tab nicht „online“ bleibt
  useEffect(() => {
    if (!socialEnabled || !user?.id) return
    const beiSichtbarkeit = () => {
      if (document.visibilityState === 'visible') {
        letzteEingabeRef.current = Date.now()
        autoAwayRef.current = false
      }
      void melde(true)
    }
    document.addEventListener('visibilitychange', beiSichtbarkeit)
    return () => document.removeEventListener('visibilitychange', beiSichtbarkeit)
  }, [socialEnabled, user?.id, melde])

  // Abmelden der Sitzung beim Schließen oder Abmelden
  useEffect(() => {
    if (!socialEnabled || !user?.id) return
    wegRef.current = false
    const geraet = geraeteKennung(user.id)
    const beenden = () => {
      wegRef.current = true
      void endPresenceSession(geraet, true).catch(() => {})
    }
    window.addEventListener('pagehide', beenden)
    return () => {
      wegRef.current = true
      window.removeEventListener('pagehide', beenden)
      void endPresenceSession(geraet, true).catch(() => {})
    }
  }, [socialEnabled, user?.id])

  // Eingaben, Automatik und Spielzeit
  useEffect(() => {
    if (!socialEnabled || !enableActivityTracking || !user) return

    const registerActivity = () => {
      letzteEingabeRef.current = Date.now()
      if (autoAwayRef.current && wahlRef.current === 'auto') {
        autoAwayRef.current = false
        void melde(true)
      }
    }

    let lastMoveTime = 0
    const handlePointerMove = () => {
      const now = Date.now()
      if (now - lastMoveTime > 3000) {
        lastMoveTime = now
        registerActivity()
      }
    }

    const handleAiInteraction = () => {
      lastAiInteractionTimeRef.current = Date.now()
      registerActivity()
    }

    window.addEventListener('pointerdown', registerActivity, { passive: true })
    window.addEventListener('keydown', registerActivity, { passive: true })
    window.addEventListener('wheel', registerActivity, { passive: true })
    window.addEventListener('touchstart', registerActivity, { passive: true })
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('msm:ai-user-typing', handleAiInteraction)
    window.addEventListener('msm:ai-message-sent', handleAiInteraction)

    const ticker = setInterval(() => {
      const now = Date.now()
      const idleTime = now - letzteEingabeRef.current

      // Automatik: nach fünf Minuten ohne Eingabe „abwesend“.
      if (
        wahlRef.current === 'auto' &&
        sichtbar() &&
        idleTime >= INACTIVITY_TIMEOUT_MS &&
        !autoAwayRef.current
      ) {
        autoAwayRef.current = true
        void melde(true)
      }

      if (document.hidden) return
      const isRecentlyActive = idleTime < 45000

      if (isRecentlyActive) {
        const bereich = aktivitaetFuerPfad(pfadRef.current)
        activeCategoryRef.current = bereich.kategorie

        // Im KI-Chat zählt nur echte Interaktion, nicht das bloße Offenlassen.
        let canCountTime = true
        if (bereich.kategorie === 'ai_chat') {
          canCountTime = now - lastAiInteractionTimeRef.current <= 60000
        }

        if (canCountTime) {
          activeSecondsRef.current += 1
          if (activeSecondsRef.current >= 30) {
            const secs = activeSecondsRef.current
            activeSecondsRef.current = 0
            recordActivityTime(bereich.kategorie, secs).catch(() => {})
          }
        }
      }
    }, 1000)

    return () => {
      window.removeEventListener('pointerdown', registerActivity)
      window.removeEventListener('keydown', registerActivity)
      window.removeEventListener('wheel', registerActivity)
      window.removeEventListener('touchstart', registerActivity)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('msm:ai-user-typing', handleAiInteraction)
      window.removeEventListener('msm:ai-message-sent', handleAiInteraction)
      clearInterval(ticker)
      if (activeSecondsRef.current >= 10) {
        recordActivityTime(activeCategoryRef.current, activeSecondsRef.current).catch(() => {})
        activeSecondsRef.current = 0
      }
    }
  }, [socialEnabled, enableActivityTracking, user, melde])

  const changeStatus = useCallback(
    async (neu: PraesenzWahl) => {
      wahlRef.current = neu
      setWahl(neu)
      autoAwayRef.current = false
      letzteEingabeRef.current = Date.now()
      if (!socialEnabled || !user) return
      try {
        await setPresenceStatus(neu)
      } catch {
        // Der nächste Takt meldet die Sitzung; die Wahl bleibt lokal sichtbar.
      }
      void melde(true)
    },
    [socialEnabled, user, melde]
  )

  return {
    /** Die Wahl: automatisch, online, abwesend oder unsichtbar. */
    status: wahl,
    changeStatus,
    client: clientRef.current,
    plattform: plattformRef.current,
  }
}
