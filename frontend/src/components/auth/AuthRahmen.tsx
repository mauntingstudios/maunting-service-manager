import { useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { headerHintergrundWaehlen } from '@/lib/tageszeit'
import { Logo } from '@/components/Logo'
import { VersionFooter } from '@/components/VersionFooter'

export interface AuthRahmenProps {
  children: ReactNode
  /** Breite der Karte, z. B. `max-w-md` oder `max-w-2xl`. */
  breite?: string
}

/**
 * Gemeinsamer Rahmen für Anmeldung, Registrierung, Passwort-Reset, die
 * Passkey-Bestätigung im Browser und den zweiten Faktor.
 *
 * Der Hintergrund kommt aus derselben Tageszeit-Auswahl wie Dashboard und
 * Kalender. Er bleibt leicht unscharf und abgedunkelt, damit die Karte
 * unabhängig vom Motiv lesbar ist. Das Logo sitzt halb über der Oberkante,
 * die Karte selbst bleibt eine gewöhnliche MSM-Oberfläche ohne zusätzliches
 * Glasmorphism-System.
 */
export function AuthRahmen({ children, breite = 'max-w-md' }: AuthRahmenProps) {
  const { t } = useTranslation()
  const zufall = useRef(Math.random() * 5)
  const stunde = new Date().getHours()
  const motiv = useMemo(() => headerHintergrundWaehlen(stunde, zufall.current), [stunde])

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-background text-on-surface">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute inset-0 scale-[1.04] blur-[2px]">
          <TageszeitHintergrund motiv={motiv} hoehe="h-full" deckkraft="opacity-45" verlauf="" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-background/55 via-background/70 to-background" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-16 sm:py-20">
        <main className={`w-full ${breite}`}>
          <section className="relative rounded-panel border border-outline-variant/30 bg-surface-container/95 shadow-[0_30px_90px_-45px_hsl(var(--mui-focus)/0.55)]">
            <div className="absolute -top-9 left-1/2 -translate-x-1/2">
              <div className="rounded-full border border-outline-variant/40 bg-surface-container p-1.5 shadow-[0_12px_32px_-14px_rgba(0,0,0,0.9)]">
                <Logo size="lg" />
              </div>
            </div>

            <header className="px-6 pb-6 pt-12 text-center sm:px-8">
              <h1 className="font-headline text-headline-sm font-extrabold tracking-tight text-primary">
                MSM
              </h1>
              <p className="mt-1 font-headline text-sm font-semibold text-on-surface">
                Mounting Service Manager
              </p>
              <p className="mt-1.5 text-xs text-on-surface-variant">{t('auth.brandTagline')}</p>
            </header>

            <div className="px-6 pb-8 sm:px-8">{children}</div>
          </section>

          <VersionFooter ohneHerkunftszeichen />
        </main>
      </div>
    </div>
  )
}
