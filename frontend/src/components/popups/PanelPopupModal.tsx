import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useInRouterContext } from 'react-router-dom'
import { ArrowRight, Check, ExternalLink, EyeOff, Megaphone, Sparkles, Wrench, X } from 'lucide-react'
import { Button } from '@maunting/ui'
import {
  dismissPopup,
  getActivePopup,
  getPublicActivePopups,
  type PanelPopup,
  type PopupTone,
} from '@/api/popups'
import { still } from '@/lib/still'
import { useAuthStore } from '@/stores/authStore'

// Markdown erst laden, wenn eine Ankündigung erscheint, nicht auf jeder Seite.
const AiMarkdown = lazy(() => import('@/components/ai/AiMarkdown').then((m) => ({ default: m.AiMarkdown })))

export const POPUP_GUEST_STORAGE_KEY = 'msm.popup.dismissed.v1'
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000

interface GuestDismissalEntry {
  mode: 'snooze' | 'permanent'
  dismissedAt: number
}

export function sanitizePopupUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  if (/[\s\u0000-\u001F\u007F]/.test(trimmed)) return null
  if (trimmed.startsWith('//')) return null
  if (trimmed.startsWith('/')) return trimmed
  try {
    const parsed = new URL(trimmed)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
      return trimmed
    }
    return null
  } catch (err) {
    still(err, 'popup-url-parse')
    return null
  }
}

export function isSafePopupUrl(rawUrl?: string | null): boolean {
  return sanitizePopupUrl(rawUrl) !== null
}

function readGuestDismissals(): Record<string, GuestDismissalEntry> {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(POPUP_GUEST_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, GuestDismissalEntry>
  } catch (err) {
    still(err, 'popup-guest-storage-read')
    return {}
  }
}

function writeGuestDismissal(popupId: number, mode: 'snooze' | 'permanent'): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const current = readGuestDismissals()
    current[String(popupId)] = { mode, dismissedAt: Date.now() }
    window.localStorage.setItem(POPUP_GUEST_STORAGE_KEY, JSON.stringify(current))
  } catch (err) {
    still(err, 'popup-guest-storage-write')
  }
}

function filterGuestPopups(popups: PanelPopup[]): PanelPopup[] {
  const dismissed = readGuestDismissals()
  const now = Date.now()
  return popups.filter((item) => {
    const entry = dismissed[String(item.id)]
    if (!entry) return true
    if (entry.mode === 'permanent') return false
    if (entry.mode === 'snooze' && typeof entry.dismissedAt === 'number') {
      return now - entry.dismissedAt >= SNOOZE_DURATION_MS
    }
    return true
  })
}

function hasBlockingModalDialog(): boolean {
  if (typeof document === 'undefined') return false
  try {
    return Boolean(document.querySelector('[aria-modal="true"], dialog:modal'))
  } catch (err) {
    still(err, 'popup-modal-selector')
    return Boolean(document.querySelector('[aria-modal="true"]'))
  }
}

const TONE_STYLES: Record<
  PopupTone,
  {
    cardClass: string
    iconBoxClass: string
    badgeClass: string
    badgeKey: string
    Icon: typeof Megaphone
  }
> = {
  info: {
    cardClass: 'border-primary/35',
    iconBoxClass: 'bg-primary/15 text-primary',
    badgeClass: 'border-primary/25 bg-primary/10 text-primary',
    badgeKey: 'popups.toneInfo',
    Icon: Megaphone,
  },
  promo: {
    cardClass: 'border-primary/45 ring-1 ring-primary/20',
    iconBoxClass: 'bg-primary/20 text-primary',
    badgeClass: 'border-primary/35 bg-primary/15 text-primary',
    badgeKey: 'popups.tonePromo',
    Icon: Sparkles,
  },
  maintenance: {
    cardClass: 'border-status-warning/40 ring-1 ring-status-warning/20',
    iconBoxClass: 'bg-status-warning/15 text-status-warning',
    badgeClass: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
    badgeKey: 'popups.toneMaintenance',
    Icon: Wrench,
  },
}

export interface PanelPopupCardProps {
  popup?: PanelPopup | null
  surface?: 'shop' | 'panel'
  isPreview?: boolean
  onClose?: () => void
}

export function PanelPopupCard({
  popup: initialPopup,
  surface = 'panel',
  isPreview = false,
  onClose,
}: PanelPopupCardProps) {
  const { t } = useTranslation()
  const { isAuthenticated } = useAuthStore()
  const inRouter = useInRouterContext()
  const titleId = useId()
  const cardRef = useRef<HTMLElement | null>(null)

  const [queue, setQueue] = useState<PanelPopup[]>(() => (initialPopup ? [initialPopup] : []))
  const [dismissing, setDismissing] = useState(false)
  const [suppressedByModal, setSuppressedByModal] = useState(false)

  const supportsPopover =
    typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'

  useEffect(() => {
    if (initialPopup !== undefined) {
      setQueue(initialPopup ? [initialPopup] : [])
      return
    }

    if (isPreview) {
      setQueue([])
      return
    }

    if (surface === 'panel' && !isAuthenticated) {
      setQueue([])
      return
    }

    let active = true
    const loadQueue = async () => {
      let items: PanelPopup[] = []
      if (typeof getPublicActivePopups === 'function') {
        const result = await getPublicActivePopups(surface)
        if (Array.isArray(result)) {
          items = result
        } else if (isAuthenticated && surface === 'panel' && typeof getActivePopup === 'function') {
          const single = await getActivePopup()
          items = single ? [single] : []
        }
      } else if (isAuthenticated && surface === 'panel' && typeof getActivePopup === 'function') {
        const single = await getActivePopup()
        items = single ? [single] : []
      }

      if (!active) return
      setQueue(isAuthenticated ? items : filterGuestPopups(items))
    }

    loadQueue().catch((err) => {
      still(err, 'popup-fetch')
    })

    return () => {
      active = false
    }
  }, [initialPopup, surface, isAuthenticated, isPreview])

  // Blendet die Karte voruebergehend aus, solange ein modaler Dialog offen ist.
  // Ohne anstehenden Hinweis kein document.body-MutationObserver noetig.
  useEffect(() => {
    if (isPreview || queue.length === 0 || typeof document === 'undefined') {
      setSuppressedByModal(false)
      return
    }

    const syncModalState = () => {
      setSuppressedByModal(hasBlockingModalDialog())
    }
    syncModalState()

    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(syncModalState)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'open'],
    })
    return () => observer.disconnect()
  }, [isPreview, queue.length])

  const currentPopup = queue[0] ?? null
  const isVisible = Boolean(currentPopup && (isPreview || !suppressedByModal))

  // Top-Layer-Einbindung per manual Popover, wo vom Browser unterstuetzt.
  useEffect(() => {
    const el = cardRef.current
    if (!el || !supportsPopover || !isVisible) return
    try {
      el.showPopover()
    } catch (err) {
      still(err, 'popup-show-popover')
    }
    return () => {
      try {
        el.hidePopover()
      } catch (err) {
        still(err, 'popup-hide-popover')
      }
    }
  }, [supportsPopover, isVisible, currentPopup?.id])

  const handleDismiss = useCallback(
    async (mode: 'snooze' | 'permanent') => {
      if (!currentPopup) return
      if (isPreview) {
        onClose?.()
        return
      }

      const advanceQueue = () => {
        setQueue((prev) => {
          const rest = prev.slice(1)
          if (rest.length === 0) {
            onClose?.()
          }
          return rest
        })
      }

      setDismissing(true)
      try {
        if (isAuthenticated) {
          await dismissPopup(currentPopup.id, mode)
        } else {
          writeGuestDismissal(currentPopup.id, mode)
        }
        advanceQueue()
      } catch (err) {
        still(err, 'popup-dismiss')
        advanceQueue()
      } finally {
        setDismissing(false)
      }
    },
    [currentPopup, isPreview, isAuthenticated, onClose],
  )

  const safeButtonUrl = useMemo(() => sanitizePopupUrl(currentPopup?.button_url), [currentPopup?.button_url])

  if (!currentPopup || !isVisible) return null

  const tone: PopupTone =
    currentPopup.tone && currentPopup.tone in TONE_STYLES ? currentPopup.tone : 'info'
  const toneStyle = TONE_STYLES[tone]
  const ToneIcon = toneStyle.Icon
  const isRelativeUrl = Boolean(safeButtonUrl?.startsWith('/'))

  return (
    <section
      ref={cardRef}
      {...(supportsPopover ? { popover: 'manual' as const } : {})}
      role="region"
      aria-labelledby={titleId}
      data-testid="panel-popup-card"
      data-surface={surface}
      data-tone={tone}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          void handleDismiss('snooze')
        }
      }}
      className={`fixed inset-auto m-0 p-0 right-4 bottom-[calc(5.25rem+var(--msm-unten-sicher,0px))] z-40 w-[min(24rem,calc(100vw-2rem))] max-h-[min(70vh,28rem)] flex flex-col overflow-hidden rounded-2xl border bg-surface-container-high/95 backdrop-blur-2xl text-on-surface shadow-2xl msm-popup-card ${toneStyle.cardClass}`}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3 border-b border-outline-variant/25">
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${toneStyle.iconBoxClass}`}
            aria-hidden="true"
          >
            <ToneIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneStyle.badgeClass}`}
              >
                {t(toneStyle.badgeKey)}
              </span>
              {queue.length > 1 && (
                <span className="text-xs text-on-surface-variant">
                  {t('popups.queuePosition', { current: 1, total: queue.length })}
                </span>
              )}
            </div>
            <h2 id={titleId} className="font-headline text-sm font-semibold text-on-surface leading-snug break-words">
              {currentPopup.title}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleDismiss('snooze')}
          disabled={dismissing}
          className="shrink-0 p-1.5 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
          aria-label={t('common.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 overflow-y-auto space-y-3 flex-1 text-sm leading-relaxed">
        <Suspense fallback={null}>
          <AiMarkdown content={currentPopup.content_markdown} />
        </Suspense>

        {currentPopup.button_text && safeButtonUrl && (
          <div className="pt-1">
            {isRelativeUrl && inRouter ? (
              <Link
                to={safeButtonUrl}
                onClick={() => void handleDismiss('snooze')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-medium text-xs hover:bg-primary/90 transition-colors shadow-sm"
              >
                <span>{currentPopup.button_text}</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            ) : isRelativeUrl ? (
              <a
                href={safeButtonUrl}
                onClick={() => void handleDismiss('snooze')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-medium text-xs hover:bg-primary/90 transition-colors shadow-sm"
              >
                <span>{currentPopup.button_text}</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            ) : (
              <a
                href={safeButtonUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary font-medium text-xs hover:bg-primary/90 transition-colors shadow-sm"
              >
                <span>{currentPopup.button_text}</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-outline-variant/25 bg-surface-container/60">
        <Button
          variant="ghost"
          size="sm"
          disabled={dismissing}
          onClick={() => void handleDismiss('permanent')}
          className="text-on-surface-variant hover:text-status-destructive"
        >
          <EyeOff className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          {t('popups.neverShowAgain')}
        </Button>

        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={dismissing}
            onClick={() => void handleDismiss('snooze')}
          >
            {t('common.close')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={dismissing}
            onClick={() => void handleDismiss('snooze')}
          >
            <Check className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {t('popups.understand')}
          </Button>
        </div>
      </div>
    </section>
  )
}

export const PanelPopupModal = PanelPopupCard
