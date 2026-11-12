/**
 * Gemeinsame DNA-Suchleiste des Browsers (`Startseite` und `Maunting Search`).
 *
 * Eine einzige Komponente für die Sucheingabe: mitwachsende Textarea,
 * Suchmaschinen-Auswahl (`SuchwahlKnopf`), Sprachsuche (`SprachsucheKnopf`),
 * Löschen- und Senden-Knopf sowie optionaler Live-Autocomplete-Vorschlagsliste.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CreditCard, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api } from '@/api/client'
import { useAnkerLage } from '@maunting/ui'

import { useWirksameSuche } from '../services/einstellungenStore'
import { istAndroid } from '../services/plattform'
import { suchmaschine } from '../services/searchEngines'
import { istGekoppelt, useSitzung } from '../services/sitzung'
import { suchName, SuchwahlKnopf } from '../services/suchwahl'
import { passtZuWallet, walletOeffnenAnfragen } from '../seite/start/walletEinstieg'
import { SprachsucheKnopf } from './SprachsucheKnopf'

export interface SuchEingabeLeisteProps {
  /** Initialer oder gesteuerter Suchbegriff (z. B. auf der Ergebnisseite). */
  initialWert?: string
  /** Wird beim Absenden oder Auswählen eines Vorschlags gerufen. */
  onSuchen: (begriff: string) => void
  /** Automatischer Fokus beim Öffnen (Standard: auf Desktop ja). */
  autoFocus?: boolean
  /** Kompaktere Höhe für den Header auf der Suchergebnisseite. */
  kompakt?: boolean
  /** Live-Autocomplete über den eigenen Server aktivieren (wenn gekoppelt). */
  autocomplete?: boolean
  /** Aktuelle Sprache/Region für Autocomplete-Vorschläge. */
  sprache?: string
  /** Visuelle Variante für atmosphärische Hintergründe. */
  variante?: 'default' | 'glass'
  className?: string
}

export function SuchEingabeLeiste({
  initialWert = '',
  onSuchen,
  autoFocus,
  kompakt = false,
  autocomplete = false,
  sprache = 'de',
  variante = 'default',
  className = '',
}: SuchEingabeLeisteProps) {
  const { t } = useTranslation()
  const [text, setText] = useState(initialWert)
  const [istMehrzeilig, setIstMehrzeilig] = useState(false)
  const [offen, setOffen] = useState(false)
  const [vorschlaege, setVorschlaege] = useState<string[]>([])
  const [markiert, setMarkiert] = useState(-1)

  const huelleRef = useRef<HTMLDivElement>(null)
  const feldRef = useRef<HTMLTextAreaElement>(null)
  const listeRef = useRef<HTMLDivElement>(null)
  const listenId = useId()

  const suche = suchmaschine(useWirksameSuche())
  const gekoppelt = useSitzung((s) => istGekoppelt(s.stand))
  const handy = istAndroid()

  useEffect(() => {
    setText(initialWert)
  }, [initialWert])

  useLayoutEffect(() => {
    const el = feldRef.current
    if (!el) return
    el.style.height = 'auto'
    const scrollH = el.scrollHeight
    const minH = kompakt ? (handy ? 44 : 40) : handy ? 52 : 48
    const neuH = Math.min(192, Math.max(minH, scrollH))
    el.style.height = `${neuH}px`
    setIstMehrzeilig(neuH > minH + 6)
  }, [text, handy, kompakt])

  // Live-Autocomplete vom eigenen Server holen (debounced)
  useEffect(() => {
    if (!autocomplete || !gekoppelt || !offen) {
      setVorschlaege([])
      return
    }
    const q = text.trim()
    if (q.length < 2) {
      setVorschlaege([])
      return
    }
    let aktiv = true
    const timer = window.setTimeout(() => {
      api<{ vorschlaege?: string[] }>('/browser/suche/autocomplete', {
        method: 'POST',
        body: JSON.stringify({ q, sprache: sprache.slice(0, 2) }),
      })
        .then((res) => {
          if (!aktiv) return
          const liste = (res.vorschlaege ?? []).filter((s) => s.toLowerCase() !== q.toLowerCase()).slice(0, 6)
          setVorschlaege(liste)
          setMarkiert(-1)
        })
        .catch(() => {
          if (aktiv) setVorschlaege([])
        })
    }, 160)
    return () => {
      aktiv = false
      window.clearTimeout(timer)
    }
  }, [text, autocomplete, gekoppelt, offen, sprache])

  // Wer das Wallet meint, bekommt einen Eintrag — auch ohne Servervorschläge.
  const zeigeWallet = offen && passtZuWallet(text)
  const zeigeDropdown = offen && (vorschlaege.length > 0 || zeigeWallet)
  const lage = useAnkerLage(zeigeDropdown, huelleRef, listeRef, { abstand: 6, mindestensAnkerbreite: true })

  useEffect(() => {
    if (!offen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        huelleRef.current &&
        !huelleRef.current.contains(target) &&
        (!listeRef.current || !listeRef.current.contains(target))
      ) {
        setOffen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [offen])

  const absenden = (zielText: string) => {
    const bereinigt = zielText.trim()
    if (!bereinigt) return
    setOffen(false)
    onSuchen(bereinigt)
  }

  const shellKlassen =
    variante === 'glass'
      ? 'border-outline-variant/55 bg-surface-container-low/75 backdrop-blur-2xl shadow-[inset_0_1px_0_hsl(0_0%_100%/0.08),var(--mui-shadow-float)] hover:border-outline-variant/85 hover:bg-surface-container/85'
      : 'border-outline-variant/50 bg-surface-container-low/85 backdrop-blur-xl shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06),var(--mui-shadow-float)] hover:border-outline-variant/80 hover:bg-surface-container/90'

  return (
    <form
      role="search"
      className={`w-full ${className}`}
      onSubmit={(e) => {
        e.preventDefault()
        absenden(text)
      }}
    >
      <div
        ref={huelleRef}
        className={`relative flex w-full items-start border transition-all duration-200 focus-within:border-primary/65 focus-within:bg-surface-container/95 focus-within:ring-2 focus-within:ring-primary/20 overflow-hidden ${shellKlassen} ${
          istMehrzeilig ? 'rounded-2xl' : 'rounded-full'
        }`}
      >
        <div
          className={`absolute left-2 z-10 flex items-center gap-1 ${
            kompakt ? 'top-1.5 [@media(pointer:coarse)]:top-2' : 'top-2 [@media(pointer:coarse)]:top-2.5'
          }`}
        >
          <SuchwahlKnopf kompakt={kompakt} />
          <span className="h-4 w-px shrink-0 bg-outline-variant/40" aria-hidden="true" />
        </div>
        <textarea
          ref={feldRef}
          value={text}
          onFocus={() => setOffen(true)}
          onChange={(e) => {
            setText(e.target.value)
            setOffen(true)
          }}
          onKeyDown={(e) => {
            // Während einer IME-Komposition (z. B. CJK/Umlaut-Picker) gehört Enter
            // und die Pfeiltaste der Eingabemethode, nicht dem Suchformular.
            if (e.nativeEvent.isComposing || e.keyCode === 229) {
              return
            }
            if (zeigeDropdown && e.key === 'ArrowDown') {
              e.preventDefault()
              setMarkiert((m) => (m + 1) % vorschlaege.length)
              return
            }
            if (zeigeDropdown && e.key === 'ArrowUp') {
              e.preventDefault()
              setMarkiert((m) => (m <= 0 ? vorschlaege.length - 1 : m - 1))
              return
            }
            if (e.key === 'Escape' && zeigeDropdown) {
              e.preventDefault()
              setOffen(false)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              const gewaehlt = markiert >= 0 ? vorschlaege[markiert] : text
              absenden(gewaehlt)
            }
          }}
          rows={1}
          aria-label={t('browser.start.suchen')}
          aria-expanded={zeigeDropdown}
          aria-controls={zeigeDropdown ? listenId : undefined}
          aria-activedescendant={zeigeDropdown && markiert >= 0 ? `${listenId}-${markiert}` : undefined}
          placeholder={t('browser.adresse.platzhalter', { suchmaschine: suchName(suche, t) })}
          className={`w-full resize-none bg-transparent text-body-sm sm:text-body-md text-on-surface placeholder:text-on-surface-variant/75 outline-none max-h-48 overflow-y-auto leading-6 msm-suchleiste-rollbalken transition-[padding] duration-150 ${
            kompakt
              ? 'pl-[3.5rem] py-2 min-h-[2.5rem] [@media(pointer:coarse)]:min-h-[2.75rem] [@media(pointer:coarse)]:py-2.5'
              : 'pl-[4.25rem] py-3 min-h-[3rem] [@media(pointer:coarse)]:min-h-[3.25rem] [@media(pointer:coarse)]:py-3.5'
          } ${text.length > 0 ? 'pr-[7.5rem] [@media(pointer:coarse)]:pr-[9rem]' : 'pr-20 [@media(pointer:coarse)]:pr-24'}`}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          enterKeyHint="search"
          spellCheck={false}
          autoFocus={autoFocus ?? (!handy && !kompakt)}
          style={{ fieldSizing: 'content' }}
        />
        <div
          className={`absolute right-1.5 z-10 flex items-center gap-1 ${
            kompakt ? 'top-1 [@media(pointer:coarse)]:top-1.5' : 'top-2 [@media(pointer:coarse)]:top-2.5'
          }`}
        >
          {text.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  setText('')
                  setVorschlaege([])
                  feldRef.current?.focus()
                }}
                aria-label={t('common.clear')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface transition-colors [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 animate-fade-in"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="h-4 w-px bg-outline-variant/40" aria-hidden="true" />
            </>
          )}
          <SprachsucheKnopf
            groesse={kompakt ? 'sm' : 'md'}
            onErgebnis={(sttText) => {
              setText((alt) => (alt ? `${alt.trim()} ${sttText}` : sttText))
              feldRef.current?.focus()
            }}
          />
          <button
            type="submit"
            aria-label={t('browser.start.suchen')}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm transition-all hover:bg-primary/90 active:scale-95 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {zeigeDropdown &&
        createPortal(
          <div
            ref={listeRef}
            id={listenId}
            role="listbox"
            aria-label={t('browser.adresse.vorschlaege')}
            style={lage}
            data-msm-dropdown-menu=""
            className="max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl border border-outline-variant/45 bg-surface-container-high/95 p-1.5 shadow-panel backdrop-blur-2xl animate-fade-in"
          >
            {zeigeWallet && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setOffen(false)
                  void walletOeffnenAnfragen()
                }}
                className="mb-1 flex w-full items-center gap-3 rounded-xl border border-outline-variant/25 bg-surface-container/60 px-3.5 py-2.5 text-left text-body-sm text-on-surface transition-colors hover:bg-surface-container-highest/65"
              >
                <CreditCard className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t('browser.wallet.oeffnen')}</span>
                  <span className="block truncate text-label-sm text-on-surface-variant">{t('browser.wallet.untertitel')}</span>
                </span>
              </button>
            )}
            <div className="space-y-0.5">
              {vorschlaege.map((v, i) => (
                <button
                  key={v}
                  id={`${listenId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === markiert}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setText(v)
                    absenden(v)
                  }}
                  onMouseEnter={() => setMarkiert(i)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-body-sm transition-colors ${
                    i === markiert
                      ? 'bg-primary/12 text-primary'
                      : 'text-on-surface hover:bg-surface-container-highest/65'
                  }`}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate font-medium">{v}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </form>
  )
}
