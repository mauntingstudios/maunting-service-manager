import { Plus, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { begruessungSchluessel, tageszeit, useTageszeitMotiv } from '@/lib/tageszeit'

export interface TeamsTageszeitBannerProps {
  onCreateTeam: () => void
  canCreate: boolean
  className?: string
}

const KURZ_FALLBACK: Record<'morgen' | 'tag' | 'abend' | 'nacht', string> = {
  morgen: 'Guten Morgen',
  tag: 'Guten Tag',
  abend: 'Guten Abend',
  nacht: 'Gute Nacht',
}

/**
 * Atmosphärischer Hero-Banner für die Team-Übersicht.
 * Wechselt passend zur Tageszeit und Jahreszeit das Landschaftsmotiv
 * und bietet einen direkten Absprung zur Team-Erstellung.
 */
export function TeamsTageszeitBanner({
  onCreateTeam,
  canCreate,
  className = '',
}: TeamsTageszeitBannerProps) {
  const { t } = useTranslation()
  const username = useAuthStore((s) => s.user?.username)

  const headerMotiv = useTageszeitMotiv('teams')
  const stunde = new Date().getHours()
  const zeit = tageszeit(stunde)
  const greetingKey = begruessungSchluessel(stunde, true)
  const image = headerMotiv.pfad
  const fallbackGreeting = KURZ_FALLBACK[zeit]

  const greeting = username
    ? `${t(greetingKey, fallbackGreeting)}, ${username}!`
    : t('teams.title', 'Deine Teams')

  return (
    <section
      aria-labelledby="teams-banner-heading"
      className={`relative overflow-hidden rounded-2xl sm:rounded-3xl border border-outline-variant/30 bg-surface-container-low shadow-xl ${className}`}
    >
      {/* Hintergrundbild mit sanftem Verlauf und Abdunkelung fuer perfekte Lesbarkeit */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-center transition-transform duration-700 hover:scale-105"
        />
        {/* Mehrschichtiger Licht- & Abdunkelungs-Verlauf */}
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-background/40 sm:via-background/60 sm:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-black/25" />
      </div>

      {/* Inhalt */}
      <div className="relative z-10 flex flex-col gap-4 p-5 sm:p-7 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
          <div className="grid h-12 w-12 sm:h-14 sm:w-14 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/20 text-primary backdrop-blur-xl shadow-lg shadow-primary/10">
            <Users className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
          </div>

          <div className="space-y-1">
            <div className="text-label-sm sm:text-xs font-semibold uppercase tracking-wider text-primary/90">
              {greeting}
            </div>
            <h2
              id="teams-banner-heading"
              className="font-headline text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-on-surface"
            >
              {t('teams.yourTeams', 'Deine Teams')}
            </h2>
            <p className="text-xs sm:text-sm text-on-surface-variant/90 max-w-xl leading-relaxed">
              {t(
                'teams.bannerDescription',
                'Verwalte deine Teams, Mitglieder, Wissen und gemeinsame Ressourcen.',
              )}
            </p>
          </div>
        </div>

        {canCreate && (
          <div className="mt-1 sm:mt-0 flex shrink-0 items-center">
            <button
              type="button"
              onClick={onCreateTeam}
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary hover:bg-primary/90 text-on-primary px-5 py-2.5 text-sm font-semibold shadow-lg shadow-primary/25 backdrop-blur-md transition-all duration-200 hover:scale-[1.02] active:scale-95"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
              <span>{t('teams.create', 'Team erstellen')}</span>
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
