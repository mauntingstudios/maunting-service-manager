/**
 * Neutrale, temporäre KI-Suchzusammenfassung (Singra AI Überblick) für Maunting Search.
 *
 * Eigenschaften:
 * - 0 Bytes Speicherung in der Datenbank (reiner ephemerer Zustand im Tab).
 * - Streng isoliert: kein Gedächtnis, keine Ethik-Engine.
 * - Minimaler Prompt-Overhead, schneller SSE-Stream.
 * - Klickbare Quellenverweise [1], [2], die die jeweilige Quellen-Karte hervorheben und zu den Treffern scrollen.
 * - Visuelles Top-Quellen-Dropdown mit 3 Vorschaukarten (dynamisches Favicon & Proxy-Thumbnail).
 * - Nachfragen im selben Reiter möglich (Verlauf verbleibt rein im Speicher).
 * - Die Denkstufe steht fest am Anbieter (Einstellungen); denkt das Modell,
 *   zeigt die Kachel den Denkprozess und klappt ihn mit der Antwort ein.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Brain, Check, ChevronDown, ChevronUp, Copy, Loader2, Send, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { apiStream, SanitizedApiError, translateErrorCode } from '@/api/client'
import { Button, ChatInputBar, Kurzinfo } from '@maunting/ui'

import type { Treffer } from '../MsmSuche'
import { SeitenSymbol } from '../SeitenSymbol'
import { SuchBild } from '../SuchBild'

interface SuchNachricht {
  role: 'user' | 'assistant'
  content: string
  fehler?: boolean
}

interface SuchzusammenfassungKachelProps {
  begriff: string
  treffer: Treffer[]
  vorschlaege?: string[]
  onNeueTreffer?: (neue: Treffer[]) => void
  onOeffnen?: (url: string, neuerTab?: boolean) => void
}

function hostName(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function SuchzusammenfassungKachel({
  begriff,
  treffer,
  vorschlaege = [],
  onNeueTreffer,
  onOeffnen,
}: SuchzusammenfassungKachelProps) {
  const { t } = useTranslation()
  const [eingeklappt, setEingeklappt] = useState(false)
  // Quellen sind eingeklappt, bis jemand sie sehen will: erst die Zusammenfassung
  // lesen, dann die Quellen. Genau andersherum wäre es überladen.
  const [quellenOffen, setQuellenOffen] = useState(false)
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null)
  // Der Grund gehört zum Zustand: „deaktiviert" allein sagt niemandem, was fehlt.
  const [deaktiviertGrund, setDeaktiviertGrund] = useState<'permission' | 'not_configured' | 'no_key' | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [hauptText, setHauptText] = useState('')
  const [gedankenText, setGedankenText] = useState('')
  // Der Denkblock öffnet sich mit dem ersten Gedanken und klappt ein, sobald
  // die Antwort beginnt; von Hand lässt er sich jederzeit wieder öffnen.
  const [denkenOffen, setDenkenOffen] = useState(false)
  const [recherche, setRecherche] = useState<string[]>([])
  const [verlauf, setVerlauf] = useState<SuchNachricht[]>([])
  const [nachfrage, setNachfrage] = useState('')
  const [folgeFehler, setFolgeFehler] = useState<string | null>(null)
  const [hauptFehler, setHauptFehler] = useState<string | null>(null)
  const [kopierStand, setKopierStand] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [kopierAnsage, setKopierAnsage] = useState('')

  const abbruchRef = useRef<AbortController | null>(null)
  const begonneneSucheRef = useRef<string | null>(null)
  const kopierTimerRef = useRef<number | null>(null)
  const letzteAnsageRef = useRef('')

  const topQuellen = treffer.slice(0, 3)

  const scrollToTreffer = (index: number) => {
    setHervorgehoben(index)
    setTimeout(() => setHervorgehoben((aktuell) => (aktuell === index ? null : aktuell)), 1800)

    const el = document.getElementById(`treffer-${index}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-primary')
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 2000)
    }
  }

  const kopieren = async () => {
    if (!hauptText) return
    if (kopierTimerRef.current !== null) {
      window.clearTimeout(kopierTimerRef.current)
      kopierTimerRef.current = null
    }
    try {
      await navigator.clipboard.writeText(hauptText)
      setKopierStand('copied')
      const basis = t('common.copied')
      const ansage = letzteAnsageRef.current === basis ? `${basis}\u00A0` : basis
      letzteAnsageRef.current = ansage
      setKopierAnsage(ansage)
    } catch {
      setKopierStand('failed')
      const basis = t('browser.msmSuche.kopierenFehlgeschlagen')
      const ansage = letzteAnsageRef.current === basis ? `${basis}\u00A0` : basis
      letzteAnsageRef.current = ansage
      setKopierAnsage(ansage)
    }
    kopierTimerRef.current = window.setTimeout(() => {
      setKopierStand('idle')
      setKopierAnsage('')
      kopierTimerRef.current = null
    }, 2000)
  }

  const istAktuell = (controller: AbortController) => abbruchRef.current === controller

  const fehlerText = () =>
    t('browser.msmSuche.zusammenfassungFehler', { defaultValue: 'Antwort konnte nicht generiert werden.' })
  // Kein Text im Strom ist etwas anderes als keine Verbindung: Das sagt der
  // Nutzerin, woran sie ist, und dem Betrieb, wo er nachsehen muss.
  const leerText = () =>
    t('browser.msmSuche.zusammenfassungLeer', { defaultValue: 'Die KI hat keine Antwort geliefert.' })
  // Der Dienst schickt teils stabile Codes statt Sätzen; die Oberfläche sagt
  // den Satz aus dem Katalog, nie den Schlüssel.
  const serverMeldung = (message: unknown) => {
    const text = typeof message === 'string' ? message.trim() : ''
    if (!text) return fehlerText()
    if (/^[A-Z][A-Z0-9_]+$/.test(text)) return translateErrorCode(text) ?? fehlerText()
    return text
  }

  const fehlerSetzen = (controller: AbortController, dialogVerlauf: SuchNachricht[], meldung: string) => {
    setFolgeFehler(meldung)
    if (dialogVerlauf.length > 0) {
      setVerlauf((prev) => {
        const kopie = [...prev]
        if (kopie.length > 0 && kopie[kopie.length - 1].role === 'assistant') {
          kopie[kopie.length - 1] = { role: 'assistant', content: meldung, fehler: true }
          return kopie
        }
        return [...kopie, { role: 'assistant', content: meldung, fehler: true }]
      })
    }
    if (istAktuell(controller)) setLaedt(false)
  }

  const starteStream = async (frage: string, dialogVerlauf: SuchNachricht[] = []) => {
    if (abbruchRef.current) {
      abbruchRef.current.abort()
    }
    const controller = new AbortController()
    abbruchRef.current = controller

    setLaedt(true)
    setFolgeFehler(null)
    setHauptFehler(null)
    setGedankenText('')
    setDenkenOffen(false)
    setRecherche([])

    const trefferPayload = treffer.slice(0, 15).map((item, idx) => ({
      index: idx + 1,
      titel: item.titel,
      url: item.url,
      inhalt: item.inhalt,
    }))

    const verlaufPayload = dialogVerlauf.map((e) => ({
      role: e.role,
      content: e.content,
    }))

    try {
      const res = await apiStream('/browser/suche/zusammenfassung', {
        method: 'POST',
        signal: controller.signal,
        // Das Backend liest vor dem ersten Byte bis zu fünf Seiten ein. Ohne
        // Frist bliebe die Kachel bei einem hängenden Lauf unbegrenzt im Ladezustand.
        connectTimeoutMs: 30_000,
        body: JSON.stringify({
          q: frage,
          treffer: trefferPayload,
          verlauf: verlaufPayload,
        }),
      })

      const reader = res.body?.getReader()
      if (!reader) {
        if (dialogVerlauf.length === 0) {
          setHauptFehler(t('browser.msmSuche.zusammenfassungFehler', { defaultValue: 'Antwort konnte nicht generiert werden.' }))
          if (istAktuell(controller)) setLaedt(false)
        } else {
          fehlerSetzen(controller, dialogVerlauf, t('browser.msmSuche.zusammenfassungFehler'))
        }
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let akkumulierterText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const getrimmt = line.trim()
          if (!getrimmt.startsWith('data:')) continue

          const jsonStr = getrimmt.slice(5).trim()
          if (!jsonStr) continue

          try {
            const data = JSON.parse(jsonStr)
            if (data.type === 'disabled') {
              const grund =
                data.reason === 'permission' || data.reason === 'no_key' || data.reason === 'not_configured'
                  ? data.reason
                  : 'not_configured'
              if (dialogVerlauf.length === 0) {
                setDeaktiviertGrund(grund)
                if (istAktuell(controller)) setLaedt(false)
              } else {
                fehlerSetzen(controller, dialogVerlauf, t('browser.msmSuche.zusammenfassungFehler'))
              }
              try {
                await reader.cancel()
              } catch {
                // Ignorieren falls Stream bereits geschlossen ist
              }
              return
            }
            if (data.type === 'thought' && typeof data.text === 'string') {
              setGedankenText((prev) => prev + data.text)
              setDenkenOffen(true)
            } else if (data.type === 'recherche' && typeof data.anfrage === 'string') {
              setRecherche((prev) => (prev.includes(data.anfrage) ? prev : [...prev, data.anfrage]))
            } else if (data.type === 'neue_treffer' && Array.isArray(data.treffer)) {
              onNeueTreffer?.(data.treffer as Treffer[])
            } else if (data.type === 'content' && typeof data.text === 'string') {
              akkumulierterText += data.text
              setDenkenOffen(false)
              if (dialogVerlauf.length === 0) {
                setHauptText(akkumulierterText)
              } else {
                setVerlauf((prev) => {
                  const kopie = [...prev]
                  if (kopie.length > 0 && kopie[kopie.length - 1].role === 'assistant') {
                    kopie[kopie.length - 1] = { role: 'assistant', content: akkumulierterText }
                    return kopie
                  }
                  return [...kopie, { role: 'assistant', content: akkumulierterText }]
                })
              }
            } else if (data.type === 'error') {
              const meldung = serverMeldung(data.message)
              if (dialogVerlauf.length === 0) {
                setHauptFehler(meldung)
              } else {
                fehlerSetzen(controller, dialogVerlauf, meldung)
              }
              try {
                await reader.cancel()
              } catch {
                // Ignorieren falls Stream bereits geschlossen ist
              }
              return
            } else if (data.type === 'done') {
              if (istAktuell(controller)) setLaedt(false)
              // Leere Antwort ohne Inhalt ist ein Fehler, kein ewiger Spinner.
              if (!akkumulierterText && dialogVerlauf.length > 0) {
                fehlerSetzen(controller, dialogVerlauf, leerText())
                return
              }
            }
          } catch {
            // Ignoriere unvollständige JSON-Chunks
          }
        }
      }

      if (!akkumulierterText && !deaktiviertGrund) {
        if (dialogVerlauf.length === 0) {
          setHauptFehler(leerText())
        } else {
          fehlerSetzen(controller, dialogVerlauf, leerText())
        }
      }
    } catch (err: unknown) {
      // Ein abgebrochener Vorgänger-Stream darf den neuen Lauf nicht stoppen.
      if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') {
        return
      }
      // Die Meldung des Servers (z. B. „Zu viele Anfragen") ist bereits für die
      // Anzeige aufbereitet; alles andere (Netzfehler) bekommt den festen Text.
      const meldung =
        err instanceof SanitizedApiError && err.message
          ? err.message
          : fehlerText()
      if (dialogVerlauf.length === 0) {
        setHauptFehler(meldung)
      } else {
        fehlerSetzen(controller, dialogVerlauf, meldung)
      }
    } finally {
      if (istAktuell(controller)) {
        setLaedt(false)
      }
    }
  }

  // Abbruch bei Unmount, damit kein Stream oder Copy-Timer nach dem Schließen weiterläuft.
  useEffect(() => () => {
    abbruchRef.current?.abort()
    if (kopierTimerRef.current !== null) window.clearTimeout(kopierTimerRef.current)
  }, [])

  // Initialer Start beim Laden der Suchbegriffe. Frische Treffer via onNeueTreffer
  // dürfen den laufenden Stream nicht abbrechen; kommt die Trefferliste erst nach
  // dem ersten Rendern, startet der Lauf hier nach.
  //
  // Der Start liegt bewusst in einem Timer: StrictMode (Dev-Bau) mountet jeden
  // Effekt doppelt. Startete der Lauf direkt, gingen zwei Anfragen mit gleichem
  // CORS-Preflight raus; der Abriss der ersten nimmt der zweiten den Preflight,
  // und sie hängt bis zur Zeitüberschreitung, ohne je beim Server anzukommen.
  // Der Cleanup verwirft den ersten Anlauf, bevor er feuert.
  const hatTreffer = treffer.length > 0
  useEffect(() => {
    if (!begriff || !hatTreffer) return
    if (begonneneSucheRef.current === begriff) return

    const timer = setTimeout(() => {
      begonneneSucheRef.current = begriff
      setDeaktiviertGrund(null)
      setHauptText('')
      setGedankenText('')
      setVerlauf([])
      setNachfrage('')
      setFolgeFehler(null)

      void starteStream(begriff, [])
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [begriff, hatTreffer])

  if (deaktiviertGrund) {
    return (
      <div className="mb-4 rounded-2xl border border-outline-variant/35 bg-surface-container/65 px-4 py-3 backdrop-blur-md">
        <p className="flex items-start gap-2.5 text-body-sm text-on-surface-variant">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            {t(
              deaktiviertGrund === 'permission'
                ? 'browser.msmSuche.zusammenfassungNichtVerfuegbarRecht'
                : 'browser.msmSuche.zusammenfassungNichtVerfuegbarEinrichtung',
              { defaultValue: 'Der Singra-Überblick ist nicht verfügbar.' }
            )}
          </span>
        </p>
      </div>
    )
  }

  if (!laedt && !hauptText && !hauptFehler) {
    return null
  }

  if (hauptFehler && !hauptText) {
    return (
      <div className="mb-4 rounded-2xl border border-outline-variant/40 bg-surface-container/70 p-4 sm:p-5 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-on-surface">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="text-title-sm font-semibold">{t('browser.msmSuche.zusammenfassungTitel', { defaultValue: 'Singra-Überblick' })}</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setHauptFehler(null)
              void starteStream(begriff, [])
            }}
            className="rounded-full"
          >
            {t('common.retry', { defaultValue: 'Erneut versuchen' })}
          </Button>
        </div>
        <p className="mt-2.5 text-body-sm text-on-surface-variant">{hauptFehler}</p>
      </div>
    )
  }

  const stelleFolgefrage = (frageText: string) => {
    const text = frageText.trim()
    if (!text || laedt) return

    // Verlauf strikt alternierend aufbauen: Nutzer (Ausgangsfrage) -> Assistent
    // (initiale Zusammenfassung) -> Nutzer (Folgefrage) -> Assistent (Antwort).
    // hauptText lebt außerhalb von verlauf, deshalb bei der ersten Folgefrage
    // explizit als Assistent-Turn voranstellen, sonst sendet das Frontend zwei
    // aufeinanderfolgende user-Turns und die LLM-API antwortet mit HTTP 400.
    const basis: SuchNachricht[] =
      verlauf.length === 0 && hauptText
        ? [
            { role: 'user', content: begriff },
            { role: 'assistant', content: hauptText },
          ]
        : verlauf

    const neuerVerlauf: SuchNachricht[] = [
      ...basis,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ]

    setVerlauf(neuerVerlauf)
    setNachfrage('')
    setFolgeFehler(null)
    void starteStream(text, neuerVerlauf.slice(0, -1))
  }

  const letzteFolgefrageErneut = () => {
    for (let i = verlauf.length - 1; i >= 0; i -= 1) {
      if (verlauf[i].role === 'user') {
        const ohneFehler = verlauf.slice(0, i)
        const basis: SuchNachricht[] =
          ohneFehler.length === 0 && hauptText
            ? [
                { role: 'user', content: begriff },
                { role: 'assistant', content: hauptText },
              ]
            : ohneFehler
        const erneut: SuchNachricht[] = [
          ...basis,
          { role: 'user', content: verlauf[i].content },
          { role: 'assistant', content: '' },
        ]
        setVerlauf(erneut)
        setFolgeFehler(null)
        void starteStream(verlauf[i].content, erneut.slice(0, -1))
        return
      }
    }
  }

  const absendenNachfrage = () => {
    stelleFolgefrage(nachfrage)
  }

  const renderMarkdown = (text: string) => {
    // Wandelt [1], [2] in Markdown-Links [#treffer-1], [#treffer-2] um
    const aufbereitet = text.replace(/\[(\d+)\](?!\()/g, '[$1](#treffer-$1)')

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#treffer-')) {
              const nr = parseInt(href.replace('#treffer-', ''), 10)
              return (
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.preventDefault()
                    scrollToTreffer(nr)
                  }}
                  className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.2rem] -translate-y-0.5 cursor-pointer items-center justify-center rounded-full border border-primary/30 bg-primary/12 px-1.5 text-label-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={t('browser.msmSuche.quelle', { nr })}
                >
                  {children}
                </button>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2 hover:text-primary/80">
                {children}
              </a>
            )
          },
          p: ({ children }) => <p className="mb-3 leading-[1.68] text-on-surface/95 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1.5 pl-5 text-on-surface/95 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-on-surface/95 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-[1.65]">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-on-surface">{children}</strong>,
        }}
      >
        {aufbereitet}
      </ReactMarkdown>
    )
  }

  const schnellChips = vorschlaege.slice(0, 3)

  return (
    <section
      aria-label={t('browser.msmSuche.zusammenfassungTitel')}
      className="relative overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container/75 p-5 sm:p-6 text-on-surface backdrop-blur-xl shadow-[inset_0_1px_0_hsl(0_0%_100%/0.07),var(--mui-shadow-panel)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent"
      />

      {/* Kopfbereich mit ruhiger Hierarchie & kompakten Aktionen */}
      <div className="flex items-center justify-between gap-2 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary shadow-[0_0_16px_hsl(var(--mui-focus)/0.16)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <h2 className="text-title-sm font-semibold tracking-tight text-on-surface">
            {t('browser.msmSuche.zusammenfassungTitel')}
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {hauptText && (
            <span className="relative inline-flex items-center">
              <Kurzinfo
                text={t(
                  kopierStand === 'copied'
                    ? 'common.copied'
                    : kopierStand === 'failed'
                      ? 'browser.msmSuche.kopierenFehlgeschlagen'
                      : 'browser.msmSuche.zusammenfassungKopieren',
                )}
                seite="ende"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={kopieren}
                  data-copied={kopierStand === 'copied' ? '' : undefined}
                  data-failed={kopierStand === 'failed' ? '' : undefined}
                  aria-label={t('browser.msmSuche.zusammenfassungKopieren')}
                  className="h-8 w-8 rounded-full border border-outline-variant/35 bg-surface-container-low/65 text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-high hover:text-on-surface [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                >
                  {kopierStand === 'copied' ? (
                    <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  ) : kopierStand === 'failed' ? (
                    <AlertCircle className="h-3.5 w-3.5 text-status-destructive" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </Button>
              </Kurzinfo>
              <span role="status" aria-live="polite" className="sr-only">
                {kopierAnsage}
              </span>
            </span>
          )}

          <Kurzinfo text={t(eingeklappt ? 'browser.msmSuche.zusammenfassungAusklappen' : 'browser.msmSuche.zusammenfassungEinklappen')} seite="ende">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setEingeklappt((v) => !v)}
              aria-expanded={!eingeklappt}
              aria-label={t(eingeklappt ? 'browser.msmSuche.zusammenfassungAusklappen' : 'browser.msmSuche.zusammenfassungEinklappen')}
              className="h-8 w-8 rounded-full border border-outline-variant/35 bg-surface-container-low/65 text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-high hover:text-on-surface [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
            >
              {eingeklappt ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </Kurzinfo>
        </div>
      </div>

      {/* Einklappbarer Inhalt der KI-Zusammenfassung */}
      {!eingeklappt && (
        <div className="space-y-4 pt-0.5">
          {/* Ladezustand vor erstem Token */}
          {laedt && !hauptText && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                <span>{t('browser.msmSuche.zusammenfassungLaedt')}</span>
              </div>
              <div className="animate-pulse motion-reduce:animate-none space-y-2" aria-hidden="true">
                <div className="h-3 w-11/12 rounded-full bg-surface-container-high/70" />
                <div className="h-3 w-4/5 rounded-full bg-surface-container-high/55" />
                <div className="h-3 w-3/5 rounded-full bg-surface-container-high/40" />
              </div>
            </div>
          )}

          {/* Optionaler Denkprozess: öffnet sich mit dem ersten Gedanken und
              klappt ein, sobald die Antwort beginnt. */}
          {gedankenText && (
            <details
              open={denkenOffen}
              onToggle={(ev) => setDenkenOffen(ev.currentTarget.open)}
              className="rounded-xl border border-outline-variant/30 bg-surface-container-low/60 px-3 py-2 text-label-sm"
            >
              <summary className="flex cursor-pointer select-none items-center gap-1.5 font-medium text-on-surface-variant hover:text-on-surface">
                {laedt && !hauptText ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                ) : (
                  <Brain className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                )}
                <span>{t('browser.msmSuche.zusammenfassungDenkprozess')}</span>
              </summary>
              <div className="mt-2 whitespace-pre-wrap border-t border-outline-variant/20 pt-2 font-mono text-label-sm text-on-surface-variant/90">
                {gedankenText}
              </div>
            </details>
          )}

          {/* Nachrecherche: welche Suchanfragen die KI von sich aus gestellt hat */}
          {recherche.length > 0 && (
            <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
              {laedt && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />}
              <span>
                {t('browser.msmSuche.zusammenfassungRecherche')}: {recherche.join(' · ')}
              </span>
            </div>
          )}

          {/* Hauptantwort */}
          {hauptText && (
            <div className="text-body-sm sm:text-body-md text-on-surface">
              {renderMarkdown(hauptText)}
            </div>
          )}

          {/* Quellen-Block: eingeklappt als kompakte, scrollbar-snapping Chips-Zeile,
              aufgeklappt als 3er-Vorschaukarten-Raster. */}
          {hauptText && topQuellen.length > 0 && (
            <div className="border-t border-outline-variant/25 pt-3.5">
              {!quellenOffen ? (
                <div className="flex items-center gap-2">
                  <div className="msm-suche-quellen-scrolle min-w-0 flex-1 items-center sm:flex-wrap">
                    <span className="shrink-0 text-label-sm font-medium text-on-surface-variant">
                      {t('browser.msmSuche.quellenLabel')}
                    </span>
                    {topQuellen.map((src, idx) => {
                      const nr = idx + 1
                      const domain = hostName(src.url)
                      return (
                        <button
                          key={src.url}
                          id={`source-card-${nr}`}
                          type="button"
                          onClick={(ev) => (onOeffnen ? onOeffnen(src.url, ev.ctrlKey || ev.metaKey) : scrollToTreffer(nr))}
                          onMouseEnter={() => setHervorgehoben(nr)}
                          onMouseLeave={() => setHervorgehoben(null)}
                          onFocus={() => setHervorgehoben(nr)}
                          onBlur={() => setHervorgehoben(null)}
                          className={`flex shrink-0 min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-label-md transition-all duration-150 ${
                            hervorgehoben === nr
                              ? 'border-primary/65 bg-surface-container-high text-primary shadow-sm'
                              : 'border-outline-variant/35 bg-surface-container-low/75 text-on-surface-variant hover:border-primary/45 hover:bg-surface-container-high/80 hover:text-on-surface'
                          }`}
                          aria-label={domain}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full">
                            <SeitenSymbol url={src.url} host={domain} />
                          </span>
                          <span className="max-w-[140px] truncate">{domain}</span>
                          <span className="inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-surface-container-high px-1 text-label-sm font-semibold text-on-surface-variant">
                            {nr}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <Kurzinfo
                    text={t('browser.msmSuche.quellenUmschalten', { count: topQuellen.length })}
                    seite="ende"
                    aussen="shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => setQuellenOffen(true)}
                      aria-expanded={false}
                      aria-label={t('browser.msmSuche.quellenUmschalten', { count: topQuellen.length })}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container-low/65 text-on-surface-variant transition-colors hover:border-primary/40 hover:bg-surface-container-high hover:text-on-surface [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </Kurzinfo>
                </div>
              ) : (
                <>
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setQuellenOffen(false)}
                      aria-expanded={true}
                      aria-label={t('browser.msmSuche.quellenUmschalten', { count: topQuellen.length })}
                      className="flex items-center gap-2 text-label-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
                    >
                      <span>{t('browser.msmSuche.topQuellenTitel')}</span>
                      <ChevronDown className="h-3.5 w-3.5 rotate-180 text-primary transition-transform" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="msm-suche-quellen-scrolle pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible sm:gap-2.5">
                    {topQuellen.map((src, idx) => {
                      const nr = idx + 1
                      const domain = hostName(src.url)
                      const aktiv = hervorgehoben === nr
                      return (
                        <button
                          key={src.url}
                          id={`source-card-${nr}`}
                          type="button"
                          onClick={(ev) => {
                            if (onOeffnen) {
                              onOeffnen(src.url, ev.ctrlKey || ev.metaKey)
                            } else {
                              scrollToTreffer(nr)
                            }
                          }}
                          onMouseEnter={() => setHervorgehoben(nr)}
                          onMouseLeave={() => setHervorgehoben(null)}
                          onFocus={() => setHervorgehoben(nr)}
                          onBlur={() => setHervorgehoben(null)}
                          className={`group flex min-w-[220px] sm:min-w-0 flex-col justify-between overflow-hidden rounded-xl border bg-surface-container-low/80 backdrop-blur-md transition-all text-left ${
                            aktiv
                              ? 'border-primary ring-2 ring-primary/35 shadow-primary-glow'
                              : 'border-outline-variant/35 hover:border-primary/45 hover:bg-surface-container-high/75'
                          }`}
                        >
                          {/* Vorschau: das Bild der Seite über den eigenen Proxy.
                              Ohne Bild bleibt die DNA-Fläche, nie ein weißer Block. */}
                          <div className="relative flex h-28 w-full flex-col justify-between overflow-hidden border-b border-outline-variant/25 bg-gradient-to-br from-surface-container-high via-surface-container to-primary-container/25 p-2.5">
                            {src.bild && (
                              <SuchBild
                                url={src.bild}
                                alt=""
                                className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                            )}
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent" aria-hidden="true" />
                            <div className="relative z-10 flex items-center justify-between gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-surface/85 shadow-sm backdrop-blur-sm">
                                <SeitenSymbol url={src.url} host={domain} />
                              </span>
                              <span className="truncate rounded-full bg-surface/85 px-2 py-0.5 text-label-sm font-semibold text-primary backdrop-blur-sm">
                                {nr}
                              </span>
                            </div>
                            <span className="relative z-10 truncate text-label-sm font-medium text-on-surface drop-shadow">{domain}</span>
                          </div>

                          {/* Card Body */}
                          <div className="flex flex-1 flex-col justify-between p-2.5">
                            <p className="line-clamp-2 text-body-sm font-medium leading-snug text-on-surface transition-colors group-hover:text-primary">
                              {src.titel || domain}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Dialogverlauf (Folgefragen) — ruhige redaktionelle Struktur ohne verschachtelte Boxen */}
          {verlauf.length > 0 && (
            <div className="space-y-3 border-t border-outline-variant/25 pt-3.5">
              {verlauf.map((nachricht, idx) => (
                <div
                  key={idx}
                  className={
                    nachricht.role === 'user'
                      ? 'pt-2 first:pt-0 text-label-md font-semibold text-primary'
                      : 'pb-2 text-body-sm sm:text-body-md text-on-surface border-b border-outline-variant/20 last:border-b-0 last:pb-0'
                  }
                >
                  {nachricht.role === 'user' ? (
                    <p className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      <span>{nachricht.content}</span>
                    </p>
                  ) : nachricht.fehler ? (
                    <div className="flex flex-wrap items-center gap-2.5 text-body-sm text-on-surface-variant">
                      <span>{nachricht.content || t('browser.msmSuche.zusammenfassungFehler')}</span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={letzteFolgefrageErneut}
                        disabled={laedt}
                        className="h-8 rounded-full px-3 text-label-sm"
                      >
                        {t('common.retry')}
                      </Button>
                    </div>
                  ) : nachricht.content ? (
                    renderMarkdown(nachricht.content)
                  ) : laedt ? (
                    <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                      <span>{t('browser.msmSuche.zusammenfassungLaedt')}</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2.5 text-body-sm text-on-surface-variant">
                      <span>{t('browser.msmSuche.zusammenfassungFehler')}</span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={letzteFolgefrageErneut}
                        disabled={laedt}
                        className="h-8 rounded-full px-3 text-label-sm"
                      >
                        {t('common.retry')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Schnellwahl-Chips für Folgefragen */}
          {hauptText && schnellChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {schnellChips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={laedt}
                  onClick={() => stelleFolgefrage(chip)}
                  className="flex items-center gap-1.5 rounded-full border border-outline-variant/35 bg-surface-container-low/70 px-3 py-1.5 text-label-sm text-on-surface-variant backdrop-blur-sm transition-all hover:border-primary/45 hover:bg-surface-container-high hover:text-primary active:scale-95 disabled:opacity-50"
                >
                  <span className="truncate max-w-[260px]">{chip}</span>
                </button>
              ))}
            </div>
          )}

          {/* Genereller Stream-Fehler der Initialsuche (kein ewiger Spinner) */}
          {folgeFehler && verlauf.length === 0 && !laedt && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant/35 bg-surface-container-low/65 p-3 text-body-sm text-on-surface-variant">
              <span>{folgeFehler}</span>
            </div>
          )}

          {/* Nachfrage-Eingabezeile über gemeinsame Design-DNA ChatInputBar */}
          {hauptText && (
            <div className="border-t border-outline-variant/25 pt-3.5">
              <form
                onSubmit={(ev) => {
                  ev.preventDefault()
                  absendenNachfrage()
                }}
              >
                <ChatInputBar
                  variant="glass"
                  value={nachfrage}
                  onChange={setNachfrage}
                  onSubmit={absendenNachfrage}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' && (ev.nativeEvent.isComposing || ev.keyCode === 229)) {
                      ev.preventDefault()
                    }
                  }}
                  placeholder={t('browser.msmSuche.zusammenfassungNachfragePlaceholder')}
                  aria-label={t('browser.msmSuche.zusammenfassungNachfragePlaceholder')}
                  disabled={laedt}
                  minHeight={40}
                  maxHeight={40}
                  className="rounded-full border-outline-variant/50 bg-surface-container-low/90 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.07),0_10px_28px_rgba(0,0,0,0.3)] focus-within:ring-2 focus-within:ring-primary/20"
                  textareaClassName="px-3"
                  rightActions={
                    <Button
                      type="submit"
                      variant="primary"
                      size="icon"
                      disabled={!nachfrage.trim() || laedt}
                      className="h-8 w-8 rounded-full shrink-0 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                      aria-label={t('browser.msmSuche.zusammenfassungSenden')}
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  }
                />
              </form>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 text-label-sm text-on-surface-variant/80">
                <span>{t('browser.msmSuche.zusammenfassungDisclaimer')}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
