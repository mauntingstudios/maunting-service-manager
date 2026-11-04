/**
 * Settings-Tab „Sicherheit“:
 * 1) Konfigurierbare Rate-Limits (Login/Auth + globales API-Limit) — panel.settings.*
 * 2) Rotation des Managed-Postgres-Cluster-Admins (msm_admin) — system.secrets.rotate
 *
 * Rate-Limits und Rotation sind bewusst getrennt permission-gated, damit
 * Admins mit Settings-Rechten Limits anpassen können, ohne Secret-Rotation
 * freizuschalten (und umgekehrt).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Fingerprint,
  Gauge,
  KeyRound,
  Laptop,
  Save,
  ShieldAlert,
  X,
} from 'lucide-react'
import { api } from '@/api/client'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { useHasPermission } from '@/hooks/useHasPermission'
import { useAuthStore } from '@/stores/authStore'
import { passkeyNachweis } from '@/services/passkeyService'
import { Badge } from '@maunting/ui'
import { Button } from '@maunting/ui'
import { Input } from '@maunting/ui'
import { NumberStepper } from '@maunting/ui'
import { PasswordInput } from '@maunting/ui'
import { Spinner } from '@maunting/ui'
import { Switch } from '@maunting/ui'
import {
  formatRotateSuccessSummary,
  mapRotateAdminResult,
} from '@/services/securityRotatePresentation'
import {
  EMPTY_PANEL_SETTINGS,
  PanelSettings,
  RATE_LIMIT_AUTH_DEFAULT,
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_AUTH_MIN,
  RATE_LIMIT_GLOBAL_DEFAULT,
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_GLOBAL_MIN,
} from './types'

/** Client-seitige Range-Prüfung vor dem POST — Backend validiert erneut. */
export function validateRateLimitAuth(value: number): string | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return 'Login-Limit muss eine ganze Zahl sein.'
  }
  if (value < RATE_LIMIT_AUTH_MIN || value > RATE_LIMIT_AUTH_MAX) {
    return `Login-Limit muss zwischen ${RATE_LIMIT_AUTH_MIN} und ${RATE_LIMIT_AUTH_MAX} liegen.`
  }
  return null
}

/** Client-seitige Range-Prüfung für das globale API-Limit. */
export function validateRateLimitGlobal(value: number): string | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return 'API-Limit muss eine ganze Zahl sein.'
  }
  if (value < RATE_LIMIT_GLOBAL_MIN || value > RATE_LIMIT_GLOBAL_MAX) {
    return `API-Limit muss zwischen ${RATE_LIMIT_GLOBAL_MIN} und ${RATE_LIMIT_GLOBAL_MAX} liegen.`
  }
  return null
}

/**
 * Parst Eingabefeld-Text zu Integer; leere/ungültige Werte → null
 * (kein stilles Fallback auf Default beim Speichern).
 */
export function parseRateLimitInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^-?\d+$/.test(trimmed)) return null
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isSafeInteger(n)) return null
  return n
}

export function SecurityTab() {
  const { t } = useTranslation()
  const canReadSettings = useHasPermission('panel.settings.read')
  const canWriteSettings = useHasPermission('panel.settings.write')
  const canRotate = useHasPermission('system.secrets.rotate')

  const [authLimit, setAuthLimit] = useState(String(RATE_LIMIT_AUTH_DEFAULT))
  const [globalLimit, setGlobalLimit] = useState(String(RATE_LIMIT_GLOBAL_DEFAULT))
  const [allowLocalhost, setAllowLocalhost] = useState(false)
  const [localhostBusy, setLocalhostBusy] = useState(false)
  const [showLocalhostModal, setShowLocalhostModal] = useState(false)
  const [localhostSocialStep, setLocalhostSocialStep] = useState<1 | 2 | 3>(1)
  const [localhostPassword, setLocalhostPassword] = useState('')
  const [localhostTotp, setLocalhostTotp] = useState('')
  const [loading, setLoading] = useState(canReadSettings)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastSummary, setLastSummary] = useState<string | null>(null)

  const currentUser = useAuthStore((s) => s.user)
  const hasPasskey = Boolean(currentUser?.two_factor_methods?.includes('passkey'))
  const hasTotp = Boolean(currentUser?.two_factor_methods?.includes('totp') || (!hasPasskey && currentUser?.two_factor_enabled))
  const hasPassword = currentUser?.has_password !== false
  const isPureSocialLogin = !hasPasskey && !hasTotp && !hasPassword

  useEffect(() => {
    if (!canReadSettings) {
      setLoading(false)
      return
    }
    let active = true
    api<PanelSettings>('/settings')
      .then((data) => {
        if (!active) return
        const merged = { ...EMPTY_PANEL_SETTINGS, ...(data && typeof data === 'object' ? data : {}) }
        const auth =
          typeof merged.rate_limit_auth === 'number' && Number.isFinite(merged.rate_limit_auth)
            ? merged.rate_limit_auth
            : RATE_LIMIT_AUTH_DEFAULT
        const global =
          typeof merged.rate_limit_global === 'number' && Number.isFinite(merged.rate_limit_global)
            ? merged.rate_limit_global
            : RATE_LIMIT_GLOBAL_DEFAULT
        setAuthLimit(String(auth))
        setGlobalLimit(String(global))
        setAllowLocalhost(Boolean(merged.allow_localhost_connections))
      })
      .catch((err: unknown) => {
        // Kein stiller Fehler: Nutzer sieht die API-Meldung
        const message = err instanceof Error ? err.message : t('settings.loadFailed')
        toast.error(message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [canReadSettings, t])

  const handleSaveRateLimits = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canWriteSettings) {
      toast.error(t('security.rateLimitNoWrite'))
      return
    }

    const authParsed = parseRateLimitInput(authLimit)
    const globalParsed = parseRateLimitInput(globalLimit)

    if (authParsed === null) {
      toast.error(t('security.rateLimitAuthInvalid'))
      return
    }
    if (globalParsed === null) {
      toast.error(t('security.rateLimitGlobalInvalid'))
      return
    }

    const authErr = validateRateLimitAuth(authParsed)
    if (authErr) {
      toast.error(authErr)
      return
    }
    const globalErr = validateRateLimitGlobal(globalParsed)
    if (globalErr) {
      toast.error(globalErr)
      return
    }

    setSaving(true)
    try {
      // Nur die beiden Rate-Limit-Felder — andere Settings-Tabs speichern separat
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({
          rate_limit_auth: authParsed,
          rate_limit_global: globalParsed,
        }),
      })
      toast.success(t('settings.saved', { defaultValue: 'Einstellungen gespeichert' }))
    } catch (err: unknown) {
      // API-4xx (Range, RBAC) und Netzwerkfehler sichtbar machen — nie still schlucken
      const message =
        err instanceof Error
          ? err.message
          : t('security.rateLimitSaveFailed')
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleLocalhost = async (checked: boolean) => {
    if (!canWriteSettings) {
      toast.error(t('security.rateLimitNoWrite'))
      return
    }
    if (!checked) {
      setLocalhostBusy(true)
      try {
        await api('/settings', {
          method: 'POST',
          body: JSON.stringify({ allow_localhost_connections: false }),
        })
        setAllowLocalhost(false)
        toast.success(t('security.localhostDisabled'))
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('security.localhostSaveFailed')
        toast.error(message)
      } finally {
        setLocalhostBusy(false)
      }
    } else {
      setShowLocalhostModal(true)
      setLocalhostSocialStep(1)
      setLocalhostPassword('')
      setLocalhostTotp('')
    }
  }

  const handleConfirmWithPasskey = async () => {
    setLocalhostBusy(true)
    try {
      const nachweis = await passkeyNachweis('localhost_connections')
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({
          allow_localhost_connections: true,
          confirm_passkey: nachweis,
        }),
      })
      setAllowLocalhost(true)
      setShowLocalhostModal(false)
      toast.success(t('security.localhostEnabled'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('security.localhostSaveFailed')
      toast.error(msg)
    } finally {
      setLocalhostBusy(false)
    }
  }

  const handleConfirmWithTotp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!localhostTotp.trim()) return
    setLocalhostBusy(true)
    try {
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({
          allow_localhost_connections: true,
          confirm_otp_code: localhostTotp.trim(),
        }),
      })
      setAllowLocalhost(true)
      setShowLocalhostModal(false)
      toast.success(t('security.localhostEnabled'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('security.localhostSaveFailed')
      toast.error(msg)
    } finally {
      setLocalhostBusy(false)
    }
  }

  const handleConfirmWithPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!localhostPassword) return
    setLocalhostBusy(true)
    try {
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({
          allow_localhost_connections: true,
          confirm_password: localhostPassword,
        }),
      })
      setAllowLocalhost(true)
      setShowLocalhostModal(false)
      toast.success(t('security.localhostEnabled'))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('security.localhostSaveFailed')
      toast.error(msg)
    } finally {
      setLocalhostBusy(false)
    }
  }

  const handleConfirmSocialStep2 = async () => {
    setLocalhostBusy(true)
    try {
      await api('/settings', {
        method: 'POST',
        body: JSON.stringify({
          allow_localhost_connections: true,
        }),
      })
      setAllowLocalhost(true)
      setShowLocalhostModal(false)
      toast.success(t('security.localhostEnabled'))
    } catch (err: unknown) {
      // Rein social: Der Server schickt stattdessen einen Einmal-Link an die
      // bestätigte E-Mail (Befund 46). Der Schalter bleibt aus, bis der Link
      // geöffnet wird — das steht hier, nicht nur im Toast.
      const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : null
      if (code === 'LOCALHOST_LINK_GESENDET') {
        setLocalhostSocialStep(3)
        toast.success(t('security.localhostLinkSentTitle'))
      } else {
        const msg = err instanceof Error ? err.message : t('security.localhostSaveFailed')
        toast.error(msg)
      }
    } finally {
      setLocalhostBusy(false)
    }
  }

  const rotateClusterAdmin = async () => {
    if (!canRotate) {
      toast.error(t('security.noPermission'))
      return
    }
    const ok = await confirm({
      title: t('security.rotateConfirmTitle'),
      message: t('security.rotateConfirmBody'),
      confirmText: t('security.rotateConfirmBtn'),
      danger: true,
    })
    if (!ok) return

    setBusy(true)
    setLastSummary(null)
    try {
      const raw = await api<unknown>('/admin/managed-postgres/rotate-admin', {
        method: 'POST',
      })
      const result = mapRotateAdminResult(raw)
      if (!result.ok) {
        throw new Error(t('security.rotateFailed'))
      }
      const summary = formatRotateSuccessSummary(result)
      setLastSummary(summary)
      toast.success(t('security.rotateSuccess'))
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t('security.rotateFailed')
      toast.error(message)
      setLastSummary(null)
    } finally {
      setBusy(false)
    }
  }

  // Weder Settings noch Rotation: klare Meldung statt leerer Tab
  if (!canReadSettings && !canRotate) {
    return (
      <div className="msm-card p-6 text-sm text-on-surface-variant">
        {t('security.noPermissionDetail')}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {canReadSettings && (
        // noValidate: JS-Validierung liefert Toasts; HTML5 min/max würde Submit sonst still blocken
        <form
          noValidate
          onSubmit={(e) => void handleSaveRateLimits(e)}
          className="space-y-4"
        >
          <fieldset disabled={!canWriteSettings} className="m-0 space-y-4 border-0 p-0">
            <div className="msm-card p-6">
              <div className="mb-3 flex items-center gap-2">
                <Gauge className="h-5 w-5 text-primary" />
                <h3 className="font-headline text-title-lg font-semibold text-on-surface">
                  {t('security.rateLimitsTitle', {
                    defaultValue: 'API- und Login-Rate-Limits',
                  })}
                </h3>
              </div>
              <p className="mb-6 max-w-2xl text-sm text-on-surface-variant">
                {t('security.rateLimitsBody', {
                  defaultValue:
                    'Begrenzt Anfragen pro Minute pro IP. Schützt Login und die Panel-API vor Brute-Force und Überlastung. Änderungen greifen ohne Neustart.',
                })}
              </p>

              {/*
                Zwei Spalten mit gleicher Label-Mindesthöhe, damit beide
                NumberStepper auf einer Linie sitzen (kein Versatz durch
                unterschiedlich lange Labels). Links Auth (strenger/niedriger),
                rechts Global (höher) — bewusst so, Login bleibt enger als API.
              */}
              <div className="grid max-w-2xl grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="rate-limit-auth"
                    className="flex min-h-[2.75rem] items-end font-label-md text-label-md uppercase tracking-wider text-on-surface-variant"
                  >
                    {t('security.rateLimitAuthLabel', {
                      defaultValue: 'Login & Authentifizierung (pro Minute)',
                    })}
                  </label>
                  <NumberStepper
                    id="rate-limit-auth"
                    value={authLimit}
                    onValueChange={setAuthLimit}
                    min={RATE_LIMIT_AUTH_MIN}
                    max={RATE_LIMIT_AUTH_MAX}
                    step={1}
                    disabled={!canWriteSettings}
                    aria-describedby="rate-limit-auth-help"
                  />
                  <div id="rate-limit-auth-help" className="space-y-1">
                    <p className="font-body-md text-xs text-on-surface-variant">
                      {t('security.rateLimitAuthHelp', {
                        defaultValue:
                          'Maximal erlaubte Login- und Passwort-Versuche pro Minute pro IP. Erhöhe diesen Wert, wenn sich mehrere Personen über dieselbe Firmen-IP anmelden.',
                      })}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {t('security.rateLimitAuthRange', {
                        defaultValue: `Bereich: ${RATE_LIMIT_AUTH_MIN}–${RATE_LIMIT_AUTH_MAX} (Standard: ${RATE_LIMIT_AUTH_DEFAULT})`,
                        min: RATE_LIMIT_AUTH_MIN,
                        max: RATE_LIMIT_AUTH_MAX,
                        default: RATE_LIMIT_AUTH_DEFAULT,
                      })}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="rate-limit-global"
                    className="flex min-h-[2.75rem] items-end font-label-md text-label-md uppercase tracking-wider text-on-surface-variant"
                  >
                    {t('security.rateLimitGlobalLabel', {
                      defaultValue: 'Globales API-Limit (pro Minute)',
                    })}
                  </label>
                  <NumberStepper
                    id="rate-limit-global"
                    value={globalLimit}
                    onValueChange={setGlobalLimit}
                    min={RATE_LIMIT_GLOBAL_MIN}
                    max={RATE_LIMIT_GLOBAL_MAX}
                    step={1}
                    disabled={!canWriteSettings}
                    aria-describedby="rate-limit-global-help"
                  />
                  <div id="rate-limit-global-help" className="space-y-1">
                    <p className="font-body-md text-xs text-on-surface-variant">
                      {t('security.rateLimitGlobalHelp', {
                        defaultValue:
                          'Maximal erlaubte API-Aufrufe pro Minute pro IP. Erhöhe diesen Wert, wenn du eigene Skripte oder externe Tools zur Steuerung nutzt.',
                      })}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {t('security.rateLimitGlobalRange', {
                        defaultValue: `Bereich: ${RATE_LIMIT_GLOBAL_MIN}–${RATE_LIMIT_GLOBAL_MAX} (Standard: ${RATE_LIMIT_GLOBAL_DEFAULT})`,
                        min: RATE_LIMIT_GLOBAL_MIN,
                        max: RATE_LIMIT_GLOBAL_MAX,
                        default: RATE_LIMIT_GLOBAL_DEFAULT,
                      })}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {canWriteSettings && (
              <div className="flex justify-end">
                <Button type="submit" disabled={saving} className="px-6">
                  {saving ? (
                    <Spinner />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t('settings.save', { defaultValue: 'Speichern' })}
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      )}

      {/* ── Lokale Verbindungen (Localhost / Entwickler) ── */}
      {canReadSettings && (
        <div className="msm-card p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Laptop className="h-5 w-5 text-primary" />
                <h3 className="font-headline text-title-lg font-semibold text-on-surface">
                  {t('security.localhostTitle', {
                    defaultValue: 'Lokale Verbindungen (Localhost)',
                  })}
                </h3>
                <Badge variant={allowLocalhost ? 'success' : 'default'}>
                  {allowLocalhost
                    ? t('security.localhostActiveBadge', { defaultValue: 'Aktiviert' })
                    : t('security.localhostInactiveBadge', { defaultValue: 'Deaktiviert' })}
                </Badge>
              </div>
              <p className="max-w-2xl text-sm text-on-surface-variant">
                {t('security.localhostBody', {
                  defaultValue:
                    'Erlaubt lokalen Entwicklungs- und Test-Clients (z. B. Tauri Dev für Pontis oder MSS auf beliebigen Ports), über CORS auf dieses Backend zuzugreifen.',
                })}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {localhostBusy && <Spinner />}
              <Switch
                checked={allowLocalhost}
                disabled={!canWriteSettings || localhostBusy}
                onCheckedChange={(checked) => void handleToggleLocalhost(checked)}
                aria-label={t('security.localhostTitle', { defaultValue: 'Lokale Verbindungen (Localhost)' })}
              />
            </div>
          </div>

          {allowLocalhost && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-on-surface">
              <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning mt-0.5" />
              <span>
                {t('security.localhostWarning', {
                  defaultValue:
                    'Wenn diese Option aktiv ist, können alle lokalen Anwendungen, Webseiten und Skripte unter localhost Anfragen an dieses Panel senden. Standardmäßig deaktiviert.',
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {canRotate && (
        <div className="msm-card p-6">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-status-warning" />
            <h3 className="font-headline text-title-lg font-semibold text-on-surface">
              {t('security.clusterAdminTitle')}
            </h3>
          </div>
          <p className="mb-4 max-w-2xl text-sm text-on-surface-variant">
            {t('security.clusterAdminBody')}
          </p>
          <ul className="mb-5 list-inside list-disc space-y-1 text-sm text-on-surface-variant">
            <li>{t('security.notPanelLogin')}</li>
            <li>{t('security.notAppDbUser')}</li>
            <li>{t('security.isMsmAdmin')}</li>
          </ul>
          <Button variant="destructive"
            type="button"
            className="inline-flex items-center gap-2"
            onClick={() => void rotateClusterAdmin()}
            disabled={busy}
          >
            <KeyRound className="h-4 w-4" />
            {busy
              ? t('security.rotating')
              : t('security.rotateBtn')}
          </Button>
          {lastSummary && (
            <p className="mt-4 rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm text-on-surface">
              {lastSummary}
            </p>
          )}
        </div>
      )}

      {!canRotate && canReadSettings && (
        <p className="text-xs text-on-surface-variant">
          {t('security.rotateHiddenHint')}
        </p>
      )}

      {/* ── Bestätigungs- & Authentifizierungs-Modal für Localhost ── */}
      {showLocalhostModal && (
        <div
          className="msm-modal-overlay"
          onClick={() => !localhostBusy && setShowLocalhostModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="msm-card w-full max-w-lg p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-outline/10 pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-status-warning shrink-0" />
                <h3 className="font-headline text-title-md font-semibold text-on-surface">
                  {isPureSocialLogin && localhostSocialStep === 3
                    ? t('security.localhostLinkSentTitle')
                    : isPureSocialLogin && localhostSocialStep === 2
                      ? t('security.localhostSocialStep2Title')
                      : t('security.localhostConfirmTitle')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !localhostBusy && setShowLocalhostModal(false)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg"
                disabled={localhostBusy}
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Risikohinweis */}
            {!(isPureSocialLogin && localhostSocialStep !== 1) && (
              <div className="space-y-3">
                <p className="text-sm text-on-surface-variant">
                  {t('security.localhostConfirmBody')}
                </p>
                <div className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-on-surface">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning mt-0.5" />
                  <span>{t('security.localhostWarning')}</span>
                </div>
              </div>
            )}

            {/* Fall 1: Passkey hinterlegt */}
            {hasPasskey && (
              <div className="space-y-4 pt-2">
                <p className="text-xs text-on-surface-variant">
                  {t('security.localhostPasskeyPrompt')}
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowLocalhostModal(false)}
                    disabled={localhostBusy}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleConfirmWithPasskey()}
                    disabled={localhostBusy}
                    className="inline-flex items-center gap-2"
                  >
                    {localhostBusy ? <Spinner /> : <Fingerprint className="h-4 w-4" />}
                    {t('security.localhostPasskeyBtn')}
                  </Button>
                </div>
              </div>
            )}

            {/* Fall 2: 2FA / TOTP (kein Passkey) */}
            {!hasPasskey && hasTotp && (
              <form onSubmit={(e) => void handleConfirmWithTotp(e)} className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                    {t('security.localhostTotpLabel')}
                  </label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder="123456"
                    value={localhostTotp}
                    onChange={(e) => setLocalhostTotp(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowLocalhostModal(false)}
                    disabled={localhostBusy}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={localhostBusy || !localhostTotp.trim()}
                    className="inline-flex items-center gap-2"
                  >
                    {localhostBusy && <Spinner />}
                    {t('common.confirm')}
                  </Button>
                </div>
              </form>
            )}

            {/* Fall 3: Account-Passwort (kein Passkey, kein TOTP) */}
            {!hasPasskey && !hasTotp && hasPassword && (
              <form onSubmit={(e) => void handleConfirmWithPassword(e)} className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-medium text-on-surface-variant mb-1.5">
                    {t('security.localhostPasswordLabel')}
                  </label>
                  <PasswordInput
                    value={localhostPassword}
                    onChange={(e) => setLocalhostPassword(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowLocalhostModal(false)}
                    disabled={localhostBusy}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={localhostBusy || !localhostPassword}
                    className="inline-flex items-center gap-2"
                  >
                    {localhostBusy && <Spinner />}
                    {t('common.confirm')}
                  </Button>
                </div>
              </form>
            )}

            {/* Fall 4: Rein Social Login (kein Passwort, kein 2FA) */}
            {isPureSocialLogin && (
              <div className="space-y-4 pt-2">
                {localhostSocialStep === 3 ? (
                  <div className="space-y-4">
                    <p className="text-sm text-on-surface-variant">
                      {t('security.localhostLinkSentBody')}
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        onClick={() => setShowLocalhostModal(false)}
                        disabled={localhostBusy}
                      >
                        {t('common.close')}
                      </Button>
                    </div>
                  </div>
                ) : localhostSocialStep === 1 ? (
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowLocalhostModal(false)}
                      disabled={localhostBusy}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setLocalhostSocialStep(2)}
                      disabled={localhostBusy}
                    >
                      {t('common.next', { defaultValue: 'Weiter zur Bestätigung' })}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-status-destructive font-medium">
                      {t('security.localhostSocialStep2Body')}
                    </p>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setLocalhostSocialStep(1)}
                        disabled={localhostBusy}
                      >
                        {t('common.back', { defaultValue: 'Zurück' })}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void handleConfirmSocialStep2()}
                        disabled={localhostBusy}
                        className="inline-flex items-center gap-2"
                      >
                        {localhostBusy && <Spinner />}
                        {t('security.localhostSocialConfirmBtn')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
