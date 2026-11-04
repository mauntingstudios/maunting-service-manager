import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { Button, Input } from '@maunting/ui'
import { benutzernameFehler } from '@/lib/benutzername'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/toastStore'
import type { User } from '@/types'

/**
 * Speichert den Benutzernamen (`PATCH /auth/me/username`) für Wahlseite und
 * Profil. Die Antwort ist das ganze Konto; sie ersetzt das im Store, damit
 * `username_gewaehlt` sofort gilt. Die Sitzung bleibt: das Backend findet das
 * Konto über die Kennung, nicht über den Namen.
 */
export function useBenutzernameSpeichern() {
  const { t } = useTranslation()
  const setUser = useAuthStore((s) => s.setUser)
  const [speichert, setSpeichert] = useState(false)

  /**
   * `uebernehmen: false` lässt den Sitzungsspeicher unberührt. Die Namenswahl
   * braucht das: erst nach der Kartenfreigabe soll das Panel erscheinen, der
   * Name auf der Karte aber schon der neue sein.
   */
  const speichern = async (
    name: string,
    optionen?: { uebernehmen?: boolean },
  ): Promise<User | null> => {
    setSpeichert(true)
    try {
      const konto = await api<User>('/auth/me/username', {
        method: 'PATCH',
        body: JSON.stringify({ username: name.trim() }),
      })
      if (optionen?.uebernehmen !== false) setUser(konto)
      toast.success(t('benutzername.gespeichert'))
      return konto
    } catch (err: any) {
      toast.error(err?.message || t('common.error'))
      return null
    } finally {
      setSpeichert(false)
    }
  }

  return { speichert, speichern }
}

interface Props {
  /** Womit das Feld startet. */
  start: string
  /**
   * `false`: Das gespeicherte Konto wird nicht in die Sitzung übernommen.
   * Die Namenswahl zeigt danach die Maunting Card und übernimmt es erst am Ende.
   */
  uebernehmen?: boolean
  onGespeichert?: (konto: User) => void
}

/**
 * Die einmalige Namenswahl (`BenutzernameWaehlen`). Ändern im Profil geht
 * über `BenutzernameInline`, nicht hierüber.
 */
export function BenutzernameFeld({ start, uebernehmen = true, onGespeichert }: Props) {
  const { t } = useTranslation()
  const { speichert, speichern } = useBenutzernameSpeichern()
  const [name, setName] = useState(start)
  const [beruehrt, setBeruehrt] = useState(false)

  const fehler = benutzernameFehler(name)
  const fehlertext = beruehrt && fehler ? t(fehler.schluessel, fehler) : undefined

  const abschicken = async (e: FormEvent) => {
    e.preventDefault()
    setBeruehrt(true)
    if (fehler) return
    const konto = await speichern(name, { uebernehmen })
    if (konto) onGespeichert?.(konto)
  }

  return (
    <form onSubmit={abschicken} className="flex max-w-md items-start gap-3">
      <div className="flex-1">
        <Input
          id="benutzername"
          label={t('benutzername.label')}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setBeruehrt(true)
          }}
          maxLength={12}
          autoComplete="username"
          autoFocus
          error={fehlertext}
        />
        {!fehlertext && (
          <span className="mt-1.5 block text-xs text-on-surface-variant">{t('benutzername.regel')}</span>
        )}
      </div>
      <Button type="submit" className="mt-7" disabled={speichert || Boolean(fehler)}>
        {t('common.continue')}
      </Button>
    </form>
  )
}
