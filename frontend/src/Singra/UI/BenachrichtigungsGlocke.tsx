import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Bell, Bot, Mail, Send, Smartphone } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/api/client'
import { toast } from '@/stores/toastStore'
import { Switch } from '@/components/ui/Switch'
import { pruefeUndFrageGeraeteBerechtigung, sendeGeraeteBenachrichtigung } from '@/lib/benachrichtigung'
import { ausschalten, dienstVerfuegbar, einschalten, stand, type DienstStand } from '@/services/hintergrunddienst'
import { useAnkerLage } from './Ankerlage'

interface BenachrichtigungsGlockeProps {
  className?: string
  align?: 'left' | 'right' | 'sidebar'
  placement?: 'top' | 'bottom'
}

export function BenachrichtigungsGlocke({ className = '', align = 'sidebar', placement = 'top' }: BenachrichtigungsGlockeProps) {
  const { t } = useTranslation()
  const { user, updateUser } = useAuthStore()

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(user?.email_notifications ?? true)
  const [aiNotificationsEnabled, setAiNotificationsEnabled] = useState<boolean>(user?.ai_notifications ?? true)
  const [deviceNotificationsEnabled, setDeviceNotificationsEnabled] = useState<boolean>(user?.device_notifications ?? true)
  const [dienstStand, setDienstStand] = useState<DienstStand | null>(null)
  const [geraetSchaltet, setGeraetSchaltet] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const menueRef = useRef<HTMLDivElement>(null)
  // `sidebar` hieß früher: links bündig, am Telefon rechts. Das entscheidet jetzt die Messung.
  const lage = useAnkerLage(bellOpen, bellRef, menueRef, {
    seite: placement === 'top' ? 'oben' : 'unten',
    ausrichtung: align === 'right' ? 'ende' : 'start',
  })

  const irgendwasAn = notificationsEnabled || aiNotificationsEnabled || deviceNotificationsEnabled

  useEffect(() => {
    if (user) {
      setNotificationsEnabled(user.email_notifications)
      setAiNotificationsEnabled(user.ai_notifications !== false)
      setDeviceNotificationsEnabled(user.device_notifications !== false)
    }
  }, [user?.email_notifications, user?.ai_notifications, user?.device_notifications])

  // Der Dienst läuft außerhalb der App; sein Stand kommt aus Android, nicht
  // aus diesem Fenster.
  useEffect(() => {
    if (!bellOpen || !dienstVerfuegbar()) {
      setDienstStand(null)
      return
    }
    let aktiv = true
    void stand().then((lage) => {
      if (aktiv) setDienstStand(lage)
    }).catch(() => {})
    return () => {
      aktiv = false
    }
  }, [bellOpen])

  useEffect(() => {
    if (!bellOpen) return
    function handleClickOutside(e: MouseEvent) {
      const ziel = e.target as Node
      // Das Menü hängt per Portal an body, also außerhalb von bellRef.
      if (!bellRef.current?.contains(ziel) && !menueRef.current?.contains(ziel)) {
        setBellOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setBellOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [bellOpen])

  const schalte = async (feld: 'email' | 'ai' | 'device', naechster: boolean) => {
    if (!user) return
    const vorher =
      feld === 'email'
        ? notificationsEnabled
        : feld === 'ai'
        ? aiNotificationsEnabled
        : deviceNotificationsEnabled

    if (feld === 'email') setNotificationsEnabled(naechster)
    else if (feld === 'ai') setAiNotificationsEnabled(naechster)
    else setDeviceNotificationsEnabled(naechster)

    if (feld === 'device') {
      if (dienstVerfuegbar()) {
        // Der Dienst ist die Fortsetzung desselben Schalters: an startet ihn,
        // aus stoppt und widerruft ihn. Ein eigener Nachweis wäre für einen
        // reinen Lese-Zugang zu viel Reibung.
        setGeraetSchaltet(true)
        try {
          if (naechster) {
            const eingeschaltet = await einschalten(t('notifications.deviceLabel'))
            if (!eingeschaltet) {
              setDeviceNotificationsEnabled(vorher)
              toast.error(t('notifications.backgroundFailed'))
              return
            }
          } else {
            await ausschalten()
          }
          setDienstStand(await stand())
        } catch {
          setDeviceNotificationsEnabled(vorher)
          toast.error(t('notifications.backgroundFailed'))
          return
        } finally {
          setGeraetSchaltet(false)
        }
      } else if (naechster) {
        const erlaubt = await pruefeUndFrageGeraeteBerechtigung()
        if (!erlaubt) {
          setDeviceNotificationsEnabled(vorher)
          toast.error(t('notifications.devicePermissionDenied'))
          return
        }
      }
    }

    try {
      const param = feld === 'email' ? 'enabled' : feld === 'ai' ? 'ai' : 'device'
      await api(`/auth/me/notifications?${param}=${naechster}`, { method: 'PATCH' })
      updateUser(
        feld === 'email'
          ? { email_notifications: naechster }
          : feld === 'ai'
          ? { ai_notifications: naechster }
          : { device_notifications: naechster },
      )
    } catch {
      // Der Dienst darf nicht weiterlaufen, wenn die Kontoeinstellung nicht
      // gespeichert wurde.
      if (feld === 'device' && naechster && dienstVerfuegbar()) {
        await ausschalten().catch(() => {})
        setDienstStand(await stand().catch(() => null))
      }
      if (feld === 'email') setNotificationsEnabled(vorher)
      else if (feld === 'ai') setAiNotificationsEnabled(vorher)
      else setDeviceNotificationsEnabled(vorher)
      toast.error(t('notifications.updateFailed'))
    }
  }

  const testeMeldung = async () => {
    const ergebnis = await sendeGeraeteBenachrichtigung({
      titel: t('notifications.testTitle'),
      text: t('notifications.testText'),
      erzwingen: true,
    })
    if (!ergebnis.ok) toast.error(t('notifications.testFailed'))
  }

  return (
    <div className={`relative ${className}`} ref={bellRef}>
      <button
        onClick={() => setBellOpen((offen) => !offen)}
        aria-expanded={bellOpen}
        aria-haspopup="menu"
        aria-label={irgendwasAn ? t('notifications.activeLabel') : t('notifications.inactiveLabel')}
        className="p-2 rounded-full transition-colors active:scale-95 relative hover:bg-surface-variant/50 text-on-surface-variant hover:text-primary"
      >
        <div className="relative inline-flex">
          <Bell className="w-[18px] h-[18px]" />
          <span
            className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-background ${
              irgendwasAn ? 'bg-status-success' : 'bg-status-destructive'
            }`}
            aria-hidden="true"
          />
        </div>
      </button>

      {bellOpen && createPortal(
        <div
          ref={menueRef}
          role="menu"
          style={lage}
          className="w-72 sm:w-80 max-w-[calc(100vw-1rem)] bg-surface-container-high border border-outline-variant rounded-lg shadow-xl max-h-[calc(100dvh-1rem)] overflow-y-auto"
        >
          <div className="p-3 border-b border-outline-variant/30">
            <p className="font-label-md text-sm text-on-surface font-medium">
              {t('notifications.title')}
            </p>
          </div>
          <label className="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-container-highest transition-colors cursor-pointer">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-on-surface">
                {t('notifications.emailLabel')}
              </span>
              <span className="block text-xs text-on-surface-variant">
                {t('notifications.emailHint')}
              </span>
            </span>
            <Switch
              checked={notificationsEnabled}
              onCheckedChange={(wert) => void schalte('email', wert)}
              aria-label={t('notifications.emailLabel')}
            />
          </label>
          <label className="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-container-highest transition-colors cursor-pointer border-t border-outline-variant/20">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-on-surface">
                {t('notifications.aiLabel')}
              </span>
              <span className="block text-xs text-on-surface-variant">
                {t('notifications.aiHint')}
              </span>
            </span>
            <Switch
              checked={aiNotificationsEnabled}
              onCheckedChange={(wert) => void schalte('ai', wert)}
              aria-label={t('notifications.aiLabel')}
            />
          </label>
          <label className="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-container-highest transition-colors cursor-pointer border-t border-outline-variant/20">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-on-surface">
                {t('notifications.deviceLabel')}
              </span>
              <span className="block text-xs text-on-surface-variant">
                {t('notifications.deviceHint')}
              </span>
            </span>
            <Switch
              checked={deviceNotificationsEnabled}
              disabled={geraetSchaltet}
              onCheckedChange={(wert) => void schalte('device', wert)}
              aria-label={t('notifications.deviceLabel')}
            />
          </label>
          {dienstVerfuegbar() && dienstStand && (
            <div className="px-3 pb-2.5">
              {!dienstStand.benachrichtigungenErlaubt ? (
                <p className="flex items-start gap-1.5 text-xs text-status-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('notifications.devicePermissionDenied')}</span>
                </p>
              ) : dienstStand.aktiv ? (
                <p className="text-xs text-on-surface-variant">{t('notifications.deviceActive')}</p>
              ) : null}
            </div>
          )}
          {deviceNotificationsEnabled && (
            <button
              type="button"
              onClick={() => void testeMeldung()}
              className="flex w-full items-center gap-2 border-t border-outline-variant/20 px-3 py-2.5 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              <Send className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
              {t('notifications.testLabel')}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
