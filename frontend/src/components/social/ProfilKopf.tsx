import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays } from 'lucide-react'

import { Avatar } from '@/Singra/UI'
import { aktivitaetText } from '@/services/praesenz/aktivitaeten'
import { DeviceBadge } from './DeviceBadge'
import { StatusDot } from './StatusIndicator'

export interface ProfilKopfProps {
  username: string
  avatarUrl?: string | null
  status?: string | null
  presence?: { client?: string | null; device_type?: string | null; activity_key?: string | null } | null
  infoText?: string | null
  /** Für die Vorschau: die Info ist gerade niemandem sichtbar. */
  infoVerborgen?: boolean
  memberSince?: string | null
  istFreund?: boolean
  selbst?: boolean
  funke?: ReactNode
  actions?: ReactNode
  titleId?: string
  /** Auf der Profilseite eine h1, in der Vorschau eine h2. */
  titleTag?: 'h1' | 'h2'
  /** Kleinere Fassung für die Vorschau in der Info-Karte. */
  kompakt?: boolean
}

/**
 * Der Kopf eines Profils: Bild, Name, Info, Status, Mitgliedszeit und die
 * Aktionen daneben.
 *
 * Dieselbe Darstellung steht auf der Profilseite (`Benutzerprofil`) und in der
 * Vorschau der Info-Karte. Bis 10/2026 war die Vorschau nur ein Text; wer sie
 * ansah, sah nicht, was Freunde sehen.
 */
export function ProfilKopf({
  username,
  avatarUrl,
  status,
  presence,
  infoText,
  infoVerborgen = false,
  memberSince,
  istFreund = false,
  selbst = false,
  funke,
  actions,
  titleId = 'profil-name',
  titleTag: Titel = 'h1',
  kompakt = false,
}: ProfilKopfProps) {
  const { t } = useTranslation()
  const aktivitaet = presence ? aktivitaetText(presence.activity_key, t) : ''

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div className="relative shrink-0">
          <Avatar src={avatarUrl} name={username} size={kompakt ? 'xl' : '2xl'} />
          {status && <StatusDot status={status} size={kompakt ? 'md' : 'lg'} className="absolute bottom-1 right-1" />}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Titel
              id={titleId}
              className={`min-w-0 truncate font-headline font-bold text-on-surface ${kompakt ? 'text-xl' : 'text-2xl'}`}
            >
              {username}
            </Titel>
            {funke}
          </div>
          {infoVerborgen ? (
            <p className="truncate text-sm italic text-on-surface-variant">{t('social.info.previewHidden')}</p>
          ) : infoText ? (
            <p className="truncate text-sm text-on-surface">{infoText}</p>
          ) : null}
          {presence && (
            <p className="flex items-center gap-1.5 text-sm text-on-surface-variant">
              <span>{t(`social.status.${status}`)}</span>
              {status !== 'offline' && <DeviceBadge client={presence.client} deviceType={presence.device_type} />}
              {status !== 'offline' && aktivitaet && <span className="truncate">· {aktivitaet}</span>}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-surface-variant">
            {memberSince && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {t('social.profile.memberSince', { date: memberSince })}
              </span>
            )}
            {istFreund && !selbst && <span className="text-primary">{t('social.profile.friend')}</span>}
          </div>
        </div>
      </div>

      {actions && <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div>}
    </div>
  )
}
