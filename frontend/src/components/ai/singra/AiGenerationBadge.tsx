import { Check, Loader2 } from 'lucide-react'
import { useAiGenerationStore } from '@/stores/aiGenerationStore'

interface AiGenerationBadgeProps {
  conversationId: string
  className?: string
}

/**
 * Modulare Statusanzeige für Hintergrund-Generierungen je Unterhaltung.
 *
 * Zeigt einen animierten Ladekreis, solange die Antwort im Hintergrund generiert
 * wird, und ein grünes Häkchen, sobald sie fertiggestellt wurde.
 */
export function AiGenerationBadge({ conversationId, className = '' }: AiGenerationBadgeProps) {
  const info = useAiGenerationStore((s) => s.generations[conversationId])
  if (!info) return null

  if (info.status === 'generating') {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        title="Antwort wird im Hintergrund generiert …"
        aria-label="Antwort wird im Hintergrund generiert"
      >
        <span className="relative flex h-3.5 w-3.5 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40 opacity-75" />
          <Loader2 className="relative h-3 w-3 animate-spin text-primary" aria-hidden="true" />
        </span>
      </span>
    )
  }

  if (info.status === 'completed') {
    return (
      <span
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-status-success/20 text-status-success shadow-sm ${className}`}
        title="Antwort fertiggestellt"
        aria-label="Antwort fertiggestellt"
      >
        <Check className="h-2.5 w-2.5 stroke-[2.5]" aria-hidden="true" />
      </span>
    )
  }

  return null
}
