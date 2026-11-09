import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hand, Server, ShieldAlert, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AiActionProposal, type AiRunInfo } from '@/api/ai'
import { api, SanitizedApiError } from '@/api/client'
import { Button, Kurzinfo } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import { AiVerlauf, mergeEntries } from './AiVerlauf'
import { useAiLauf } from './useAiLauf'

interface ServerOption {
  id: number
  name: string
}

/**
 * Wie oft nachgesehen wird, ob im Hintergrund eine Reparatur angelaufen ist.
 *
 * Der Takt im Panel sieht jede Minute nach offenen Vorfällen; schneller als er
 * kann hier nichts entstehen. Zwanzig Sekunden sind das Mittelmaß dazwischen:
 * man sieht eine beginnende Reparatur, ohne dass die Seite dauernd fragt.
 *
 * Solange ein Strom hängt, wird gar nicht gefragt — dann kommt alles über SSE,
 * und eine Abfrage nebenher wäre nur Last.
 */
const NACHSEHEN_MS = 20_000

/**
 * Das Guardian-Fenster: ein Verlauf, den man liest.
 *
 * Hier schreiben die Läufe, die eine Guardian-Störung ausgelöst hat — und
 * sonst niemand. Es gibt kein Eingabefeld, und das ist der Zweck der Sache:
 * eine getippte Nachricht löst über `vorgaenger_abloesen` jeden offenen Lauf
 * ihrer Unterhaltung ab. In einem Fenster, in dem seit vier Uhr eine Reparatur
 * läuft, wäre ein Eingabefeld ein Knopf zum versehentlichen Abbrechen — genau
 * der Fehler, den die Trennung der Fenster beseitigt hat.
 *
 * Vorschlagskarten bleiben trotzdem bedienbar: eine Karte zu bestätigen ist
 * keine Nachricht, sie löst nichts ab, sondern weckt den geparkten Lauf dort,
 * wo er steht.
 */
export function GuardianAnsicht() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [laedt, setLaedt] = useState(true)
  const [lauf, setLauf] = useState<AiRunInfo | null>(null)
  const [uebernimmt, setUebernimmt] = useState(false)
  const [servers, setServers] = useState<ServerOption[]>([])
  const [selectedServerId, setSelectedServerId] = useState<number | 'all'>('all')
  const verlaufRef = useRef<HTMLDivElement | null>(null)
  const [amEnde, setAmEnde] = useState(true)

  useEffect(() => {
    let active = true
    api<ServerOption[]>('/servers')
      .then((list) => {
        if (active) setServers(list)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const {
    entries, setEntries, streaming, laufendeWerkzeuge, merkeVorschlag, haengeAn,
  } = useAiLauf({
    providerId: null,
    canAttach: false,
    denken: { an: false, stufe: null },
    // Der Füllstandsring gehört zum Eingabefeld, und das gibt es hier nicht.
    ladeKontext: async () => undefined,
    setAttachments: () => undefined,
  })

  const laden = useCallback(async () => {
    const [conversation, actions, aktiverLauf] = await Promise.all([
      aiApi.getConversation('guardian'),
      aiApi.listActions('guardian'),
      aiApi.getActiveRun('guardian').catch(() => null),
    ])
    setEntries(mergeEntries(conversation.messages, actions))
    setLauf(aktiverLauf)
    return aktiverLauf
  }, [setEntries])

  useEffect(() => {
    let lebt = true
    laden()
      .catch((error: unknown) => {
        if (lebt) {
          toast.error(
            error instanceof SanitizedApiError ? error.message : t('ai.chat.errors.load'),
          )
        }
      })
      .finally(() => {
        if (lebt) setLaedt(false)
      })
    return () => {
      lebt = false
    }
  }, [laden, t])

  /**
   * Nachsehen, ob im Hintergrund etwas angelaufen ist — und sich anhängen.
   *
   * `live` ist die ehrliche Auskunft, ob dieser Prozess dem Lauf beim Arbeiten
   * zusehen kann. Nach einem Neustart des Panels steht ein geparkter Lauf
   * weiterhin in der Datenbank, aber niemand hält ihn im Speicher; ein
   * Anhängeversuch endete dann in einem Ladebalken, der sich nie bewegt.
   *
   * `angehaengtRef` merkt sich, an welchem Lauf man schon hing. Ohne das
   * entstünde eine Schleife: der Strom endet, `streaming` fällt zurück, der
   * Zustand `lauf` trägt aber weiterhin `live` — und der Effekt hinge sich
   * sofort wieder an denselben, bereits fertigen Lauf. Der Chat hat die Frage
   * nicht, weil er den Lauf beim Öffnen **verbraucht** (`setLaufBeimOeffnen(null)`);
   * hier ist er dauerhafter Zustand, weil hier auch später noch einer anlaufen
   * kann, ohne dass jemand etwas tippt.
   */
  const angehaengtRef = useRef<string | null>(null)
  useEffect(() => {
    if (streaming) return
    if (lauf?.live && angehaengtRef.current !== lauf.id) {
      angehaengtRef.current = lauf.id
      void haengeAn(lauf.id)
      return
    }
    const timer = window.setInterval(() => {
      void laden().catch(() => undefined)
    }, NACHSEHEN_MS)
    return () => window.clearInterval(timer)
  }, [haengeAn, lauf, laden, streaming])

  // Dieselbe 50-Pixel-Regel wie im Chat und in der Serverkonsole: wer fast
  // unten steht, meint unten. Wer zurückgescrollt hat, um etwas zu lesen, soll
  // von der nächsten Zeile nicht wieder nach unten gerissen werden.
  useEffect(() => {
    if (!amEnde) return
    const bereich = verlaufRef.current
    if (bereich) bereich.scrollTop = bereich.scrollHeight
  }, [amEnde, entries, laufendeWerkzeuge])

  const aufVorschlag = useCallback((updated: AiActionProposal) => {
    merkeVorschlag(updated)
    // **Hier ging es sonst nicht weiter.** Der geparkte Lauf wartet auf genau
    // diese Entscheidung; ohne das Anhängen liefe er zwar weiter, aber im
    // Fenster bliebe es still, bis jemand die Seite neu lädt.
    const id = updated.run_id ?? lauf?.id
    if (id && updated.status !== 'proposed') {
      angehaengtRef.current = id
      void haengeAn(id)
    }
  }, [haengeAn, lauf?.id])

  /**
   * Übernehmen: der Auftrag endet, und man steht im Dauerchat.
   *
   * Beendet wird der **Auftrag**, nicht nur der Lauf — sonst startet der Takt
   * neunzig Sekunden später den nächsten, und die KI arbeitete weiter, während
   * der Mensch längst selbst Hand angelegt hat.
   *
   * Danach in den Chat: dort kann man tippen, hier nicht. Wer übernimmt, will
   * als Nächstes etwas sagen.
   */
  const selectedServer = useMemo(
    () => (selectedServerId === 'all' ? null : servers.find((s) => s.id === selectedServerId) ?? null),
    [selectedServerId, servers],
  )

  const gefilterteEntries = useMemo(() => {
    if (selectedServerId === 'all') return entries
    return entries.filter((entry) => {
      if (entry.kind === 'proposal') {
        return entry.proposal.server_id === selectedServerId
      }
      if (entry.kind === 'message') {
        if (!selectedServer) return true
        const text = entry.message.content.toLowerCase()
        const sName = selectedServer.name.toLowerCase()
        const sId = String(selectedServer.id)
        return text.includes(sName) || text.includes(`server ${sId}`) || text.includes(`server #${sId}`)
      }
      return true
    })
  }, [entries, selectedServerId, selectedServer])

  const uebernehmen = useCallback(async () => {
    setUebernimmt(true)
    try {
      const { aborted } = await aiApi.takeOverGuardian()
      const serverName = selectedServer ? selectedServer.name : 'Server'
      const title = `Guardian: Reparatur ${serverName}`

      let newConvId: string | null = null
      if (typeof aiApi.createConversation === 'function') {
        try {
          const created = await aiApi.createConversation({ title })
          newConvId = created.id
        } catch {
          // Fallback
        }
      }

      if (aborted > 0) {
        toast.success(t('ai.guardian.takeOverDone', 'Steuerung übernommen. Neuer Chat wurde vorbereitet.'))
      } else {
        toast.success('Steuerung übernommen. Neuer Chat gestartet.')
      }

      if (newConvId) {
        window.dispatchEvent(
          new CustomEvent('singra-open-conversation', { detail: { conversationId: newConvId } }),
        )
      } else {
        navigate('/ai')
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof SanitizedApiError ? error.message : t('ai.guardian.takeOverFailed'),
      )
    } finally {
      setUebernimmt(false)
    }
  }, [navigate, selectedServer, t])

  const leer = gefilterteEntries.length === 0

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface">
      <header className="relative flex shrink-0 items-center gap-2 border-b border-outline-variant/30 px-4 py-3 bg-surface-container-low/40">
        <ShieldAlert className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="truncate font-headline text-sm font-semibold text-on-surface">
            {t('ai.guardian.title')}
          </h2>
          <p className="truncate text-xs text-on-surface-variant">
            {t('ai.guardian.subtitle')}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {streaming ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {t('ai.guardian.running')}
            </span>
          ) : lauf?.status === 'waiting_confirmation' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-warning/10 px-2.5 py-1 text-xs font-medium text-status-warning">
              {t('ai.guardian.waitingApproval')}
            </span>
          ) : (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => void laden().catch(() => undefined)}
            >
              {t('common.refresh')}
            </Button>
          )}
          <Kurzinfo text={t('ai.guardian.takeOverHint')} seite="ende">
            <Button
              type="button" variant="ghost" size="sm"
              disabled={uebernimmt}
              aria-description={t('ai.guardian.takeOverHint')}
              onClick={() => void uebernehmen()}
            >
              <Hand className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t('ai.guardian.takeOver')}
            </Button>
          </Kurzinfo>
        </div>
      </header>

      {/* Server Filterleiste */}
      {servers.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-outline-variant/20 bg-surface-container-low/25 px-4 py-2 overflow-x-auto msm-ohne-rollbalken shrink-0">
          <span className="text-xs font-medium text-on-surface-variant mr-1 shrink-0">
            Server:
          </span>
          <button
            type="button"
            onClick={() => setSelectedServerId('all')}
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0 border',
              selectedServerId === 'all'
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-outline-variant/25 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
            ].join(' ')}
          >
            <span>Alle Server</span>
            <span className="rounded-full bg-surface-container-high px-1.5 py-0.2 text-label-sm text-on-surface-variant">
              {entries.length}
            </span>
          </button>
          {servers.map((s) => {
            const active = selectedServerId === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedServerId(s.id)}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0 border',
                  active
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-outline-variant/25 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high',
                ].join(' ')}
              >
                <Server className="h-3 w-3" aria-hidden="true" />
                <span>{s.name}</span>
              </button>
            )
          })}
        </div>
      )}

      <div
        ref={verlaufRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        aria-live="polite"
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          setAmEnde(scrollHeight - scrollTop - clientHeight < 50)
        }}
      >
        <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-4">
          {leer && !laedt && (
            <div className="py-16 text-center">
              <Sparkles className="mx-auto h-10 w-10 text-primary/70" aria-hidden="true" />
              <h3 className="mt-4 font-headline text-title-lg font-semibold text-on-surface">
                {t('ai.guardian.emptyTitle')}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-on-surface-variant">
                {t('ai.guardian.emptyDescription')}
              </p>
            </div>
          )}
          <AiVerlauf
            entries={gefilterteEntries}
            laufendeWerkzeuge={laufendeWerkzeuge}
            onProposalChange={aufVorschlag}
          />
        </div>
      </div>

      {/* Kein Eingabefeld — siehe der Kommentar über dieser Komponente. Der
          Hinweis steht dort, wo sonst das Feld wäre: sonst sucht man es. */}
      <p className="relative shrink-0 border-t border-outline-variant/40 px-4 py-3 text-xs text-on-surface-variant">
        {t('ai.guardian.readOnly')}
      </p>
    </section>
  )
}
