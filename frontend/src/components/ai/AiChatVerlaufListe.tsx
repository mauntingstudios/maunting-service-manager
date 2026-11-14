import type { RefObject, UIEvent } from 'react'
import { Check, Copy, Forward, Sparkles, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiActionProposal, AiAttachment, AiMessage, AiToolPlanAufruf } from '@/api/ai'
import { Auswahlleiste, ChatBubbleSurface, ChatMessageMetaRow, NachrichtStatus } from '@maunting/ui'
import { KI_NAME } from '@/lib/kiName'
import { AiActionProposalCard } from './AiActionProposalCard'
import { AI_IS_BETA } from './AiBetaBanner'
import { AiAnhangListe } from './anhaenge/AiAnhangListe'
import { AiAntwortblase, formatMessageTime, KEINE_AUFRUFE } from './AiVerlauf'
import { SingraEmptyState } from './singra/SingraEmptyState'
import type { Entry } from './useAiLauf'

interface AiChatVerlaufListeProps {
  entries: Entry[]
  empty: boolean
  singraShell: boolean
  userName?: string
  activeProjectName?: string | null
  beispielSchluessel: readonly string[]
  onSelectEmptyPrompt: (promptText: string) => void
  auswahlModus: boolean
  gewaehlteNachrichten: AiMessage[]
  selectedIds: ReadonlySet<string> | null
  onBulkForward: () => void
  onBulkCopy: () => void
  onBulkStar: () => void
  onClearSelection: () => void
  verlaufRef: RefObject<HTMLDivElement>
  messagesContainerRef: RefObject<HTMLDivElement>
  bottomMarkerRef: RefObject<HTMLDivElement>
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  starredIds: Set<string>
  editingMessageId?: string | null
  busy: boolean
  laufendeWerkzeuge: AiToolPlanAufruf[]
  anhaengeJeNachricht: Map<string, AiAttachment[]>
  onProposalChange: (updated: AiActionProposal) => void
  onAnswer: (text: string) => void
  onOpenMessageMenu: (msg: AiMessage) => void
  onToggleSelectMessage: (msg: AiMessage) => void
}

export function AiChatVerlaufListe({
  entries,
  empty,
  singraShell,
  userName,
  activeProjectName,
  beispielSchluessel,
  onSelectEmptyPrompt,
  auswahlModus,
  gewaehlteNachrichten,
  selectedIds,
  onBulkForward,
  onBulkCopy,
  onBulkStar,
  onClearSelection,
  verlaufRef,
  messagesContainerRef,
  bottomMarkerRef,
  onScroll,
  starredIds,
  editingMessageId,
  busy,
  laufendeWerkzeuge,
  anhaengeJeNachricht,
  onProposalChange,
  onAnswer,
  onOpenMessageMenu,
  onToggleSelectMessage,
}: AiChatVerlaufListeProps) {
  const { t } = useTranslation()

  const auswahlAktionen = [
    {
      key: 'weiterleiten',
      label: 'Weiterleiten',
      icon: <Forward className="h-5 w-5 md:h-4 md:w-4" />,
      onSelect: onBulkForward,
    },
    {
      key: 'kopieren',
      label: 'Text kopieren',
      kurz: 'Kopieren',
      icon: <Copy className="h-5 w-5 md:h-4 md:w-4" />,
      onSelect: onBulkCopy,
    },
    {
      key: 'markieren',
      label: 'Markieren',
      icon: <Star className="h-5 w-5 md:h-4 md:w-4" />,
      onSelect: onBulkStar,
    },
  ]

  return (
    <>
      {auswahlModus && (
        <>
          <div className="relative z-40 flex min-h-14 shrink-0 items-center border-b border-outline-variant/40 bg-surface-container-high/95 px-2 backdrop-blur-md sm:px-3">
            <Auswahlleiste
              variante="kopf"
              anzahlLabel={`${gewaehlteNachrichten.length} ausgewählt`}
              aktionen={auswahlAktionen}
              abbrechenLabel="Auswahl beenden"
              onAbbrechen={onClearSelection}
            />
          </div>
          <Auswahlleiste
            variante="fuss"
            className="absolute inset-x-0 bottom-0 z-40"
            anzahlLabel={`${gewaehlteNachrichten.length} ausgewählt`}
            aktionen={auswahlAktionen}
            abbrechenLabel="Auswahl beenden"
            onAbbrechen={onClearSelection}
          />
        </>
      )}

      <div
        ref={verlaufRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        aria-live="polite"
        onScroll={onScroll}
      >
        <div
          ref={messagesContainerRef}
          className={`mx-auto w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl px-3 sm:px-6 ${
            singraShell ? 'pt-14 pb-6 lg:py-6' : 'py-6'
          }`}
        >
          {empty && (
            singraShell ? (
              <SingraEmptyState
                userName={userName}
                activeProjectName={activeProjectName}
                onSelectPrompt={onSelectEmptyPrompt}
              />
            ) : (
              <div className="py-16 text-center">
                <Sparkles className="mx-auto h-10 w-10 text-primary/70" aria-hidden="true" />
                <div className="mt-4 flex items-center justify-center gap-2">
                  <h2 className="font-headline text-xl font-semibold text-on-surface">
                    {t('ai.chat.emptyTitle')}
                  </h2>
                  {AI_IS_BETA && (
                    <span className="px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning border border-status-warning/30 text-label-sm font-bold uppercase tracking-wider">
                      {t('ai.betaBadge', 'Beta')}
                    </span>
                  )}
                </div>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-on-surface-variant">
                  {t('ai.chat.emptyDescription')}
                </p>
                <ul className="mx-auto mt-6 grid max-w-lg gap-2 text-left">
                  {beispielSchluessel.map((key) => (
                    <li key={key}>
                      <button
                        type="button"
                        className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low/40 px-4 py-3 text-sm text-on-surface-variant transition-colors hover:border-primary/40 hover:text-on-surface"
                        onClick={() => onSelectEmptyPrompt(t(`ai.chat.examples.${key}`))}
                      >
                        {t(`ai.chat.examples.${key}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}

          <div className="space-y-4">
            {entries.map((entry, index) => {
              if (entry.kind === 'compacted') {
                return (
                  <div key={entry.id} className="flex items-center gap-3 py-2">
                    <span className="h-px flex-1 bg-outline-variant/40" />
                    <span className="text-xs text-on-surface-variant">{t('ai.chat.compacted')}</span>
                    <span className="h-px flex-1 bg-outline-variant/40" />
                  </div>
                )
              }
              if (entry.kind === 'proposal') {
                return (
                  <AiActionProposalCard
                    key={entry.id}
                    proposal={entry.proposal}
                    onChange={onProposalChange}
                  />
                )
              }

              const { message } = entry
              const isStarred = starredIds.has(message.id)
              const isSelected = Boolean(selectedIds?.has(message.id))

              if (message.role === 'user') {
                return (
                  <article
                    key={entry.id}
                    className={`group flex flex-col items-end transition-colors ${
                      auswahlModus ? 'cursor-pointer' : ''
                    }`}
                    onClick={auswahlModus ? () => onToggleSelectMessage(message) : undefined}
                  >
                    {auswahlModus && (
                      <div className="mb-1 flex flex-row-reverse items-center gap-2">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary text-on-primary'
                              : 'border-outline-variant/60 text-transparent'
                          }`}
                          aria-hidden="true"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    )}
                    <ChatBubbleSurface
                      isSelf
                      highlighted={Boolean(editingMessageId === message.id || isSelected)}
                      className={`ml-auto transition-all ${
                        editingMessageId === message.id
                          ? 'ring-2 ring-primary/80 bg-primary/20 shadow-md'
                          : isSelected
                            ? 'ring-2 ring-primary bg-primary/20 shadow-md'
                            : ''
                      }`}
                    >
                      {message.content && (
                        <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-on-surface">
                          {message.content}
                        </p>
                      )}
                      <AiAnhangListe
                        anhaenge={anhaengeJeNachricht.get(message.id) ?? []}
                      />
                    </ChatBubbleSurface>
                    <ChatMessageMetaRow
                      align="end"
                      isStarred={isStarred}
                      starredLabel="Markiert"
                      onOpenMenu={!busy ? () => onOpenMessageMenu(message) : undefined}
                      menuLabel="Nachrichtenaktionen"
                      timestamp={message.created_at ? formatMessageTime(message.created_at) : null}
                      statusSlot={
                        <NachrichtStatus
                          status={message.deliveryStatus ?? (message.status === 'failed' ? 'failed' : 'read')}
                          empfaengerName={KI_NAME}
                          seite="ende"
                          lage="oben"
                        />
                      }
                    />
                  </article>
                )
              }

              return (
                <AiAntwortblase
                  key={entry.id}
                  message={message}
                  beantwortet={index < entries.length - 1}
                  busy={busy}
                  laufendeWerkzeuge={
                    message.status === 'streaming' ? laufendeWerkzeuge : KEINE_AUFRUFE
                  }
                  onAnswer={onAnswer}
                  isStarred={isStarred}
                  onOpenMenu={!busy ? onOpenMessageMenu : undefined}
                  selectionMode={auswahlModus}
                  isSelected={isSelected}
                  onToggleSelect={onToggleSelectMessage}
                />
              )
            })}
          </div>
          <div ref={bottomMarkerRef} className="h-0 w-0 pointer-events-none" aria-hidden="true" />
        </div>
      </div>
    </>
  )
}
