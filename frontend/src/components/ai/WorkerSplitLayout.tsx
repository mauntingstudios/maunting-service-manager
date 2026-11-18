import { ReactNode, useEffect, useState } from 'react'
import { Bot, MessageSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@maunting/ui'
import { WorkerAnsicht } from './WorkerAnsicht'

interface WorkerSplitLayoutProps {
  children: ReactNode
  workerId: string | null
  onClose: () => void
}

type MobileTab = 'chat' | 'worker'

/**
 * Split-View-Layout für aktive Worker (Sub-Agenten) direkt neben dem Chat.
 *
 * Hält `children` (den Hauptchat) immer an derselben Stelle im Baum, damit
 * Scroll-Position, Eingabetext und laufende Streams beim Öffnen/Schließen
 * erhalten bleiben.
 */
export function WorkerSplitLayout({ children, workerId, onClose }: WorkerSplitLayoutProps) {
  const { t } = useTranslation()
  const [mobileTab, setMobileTab] = useState<MobileTab>('worker')

  useEffect(() => {
    if (workerId) {
      setMobileTab('worker')
    }
  }, [workerId])

  return (
    <div
      className={
        workerId
          ? 'flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden p-1 sm:p-2'
          : 'flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden'
      }
    >
      {workerId && (
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low/95 p-1 shadow-sm backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMobileTab('chat')}
              aria-pressed={mobileTab === 'chat'}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                mobileTab === 'chat'
                  ? 'bg-primary text-on-primary shadow-sm font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('ai.chat.title', 'Chat')}</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('worker')}
              aria-pressed={mobileTab === 'worker'}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                mobileTab === 'worker'
                  ? 'bg-primary text-on-primary shadow-sm font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('ai.worker.title', 'Worker')}</span>
            </button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('common.close', 'Schließen')}
            className="h-8 w-8 rounded-lg text-on-surface-variant hover:bg-status-destructive/10 hover:text-status-destructive"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      <div
        className={
          workerId
            ? 'flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden lg:flex-row'
            : 'flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden'
        }
      >
        <div
          className={
            workerId
              ? `isolate min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest ${
                  mobileTab === 'chat' ? 'flex' : 'hidden'
                } lg:flex`
              : 'flex h-full min-h-0 flex-1 flex-col overflow-hidden'
          }
        >
          {children}
        </div>

        {workerId && (
          <div
            className={`isolate min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl ${
              mobileTab === 'worker' ? 'flex flex-1' : 'hidden'
            } lg:flex lg:w-[400px] xl:w-[460px]`}
          >
            <WorkerAnsicht key={workerId} conversationId={workerId} compact onClose={onClose} />
          </div>
        )}
      </div>
    </div>
  )
}
