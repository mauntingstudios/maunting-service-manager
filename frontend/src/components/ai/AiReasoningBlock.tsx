import { useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Zieht eine aussagekraeftige Ueberschrift aus dem Denktext (Markdown-Heading
 * `# ...` oder alleinstehende fettgedruckte Zwischenzeile `**...**`).
 * Waehrend des Streamings erscheint die juengste Ueberschrift, nach Abschluss
 * die erste, damit der Block direkt einordnet, worueber nachgedacht wurde.
 */
export function extractReasoningHeading(content: string, streaming: boolean): string | null {
  if (!content) return null
  const headings: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let candidate = ''
    const mdMatch = /^#{1,6}\s+(.+)$/.exec(line)
    if (mdMatch) {
      candidate = mdMatch[1].trim()
    } else {
      const boldMatch = /^\*\*([^*]+?)\*\*:?$/.exec(line)
      if (boldMatch) {
        candidate = boldMatch[1].trim()
      }
    }
    candidate = candidate.replace(/^[*_`]+|[*_`:]+$/g, '').trim()
    if (candidate.length >= 3 && candidate.length <= 80) {
      headings.push(candidate)
    }
  }
  if (headings.length === 0) return null
  return streaming ? headings[headings.length - 1] : headings[0]
}

/**
 * Einklappbarer Denkschritt-Block.
 *
 * Standardmaessig zu: die Denkschritte sind eine Nebenausgabe, keine Antwort.
 * Waehrend das Modell noch denkt, ist der Block aber offen und laeuft mit.
 * Liefert der Denktext strukturierte Zwischenueberschriften, zeigt der Kopf
 * direkt diese aktuelle Ueberschrift als kompakten Orientierungspunkt.
 */
export function AiReasoningBlock({ content, streaming }: { content: string; streaming: boolean }) {
  const { t } = useTranslation()
  const [manuallyToggled, setManuallyToggled] = useState<boolean | null>(null)
  const open = manuallyToggled ?? streaming
  const heading = extractReasoningHeading(content, streaming)
  const label = heading ?? (streaming ? t('ai.chat.thinkingNow') : t('ai.chat.thought'))

  return (
    <div className="mb-2 rounded-lg border border-outline-variant/40 bg-surface-container-low/40">
      <button
        type="button"
        onClick={() => setManuallyToggled(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Brain className={`h-3.5 w-3.5 shrink-0 ${streaming ? 'animate-pulse text-primary' : ''}`} aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && content && (
        <p className="whitespace-pre-wrap break-words px-3 pb-3 text-xs leading-5 text-on-surface-variant">
          {content}
        </p>
      )}
    </div>
  )
}
