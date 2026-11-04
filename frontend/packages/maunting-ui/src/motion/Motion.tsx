import type { ReactNode } from 'react'
import { MotionConfig, motion } from 'motion/react'

/**
 * Bewegung, die der Mensch abschalten kann.
 *
 * `MotionConfig` liest `prefers-reduced-motion` und lässt alle Übergänge dann
 * aus. Die Dauer bleibt kurz: eine Seite soll sich setzen, nicht aufführen.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

const EASE = [0.22, 1, 0.36, 1] as const

export interface InhaltUebergangProps {
  children: ReactNode
  /** Wechselt dieser Wert, blendet der Inhalt neu ein. */
  kennung: string
  className?: string
}

/** Ein ruhiger Wechsel für den Inhalt eines Abschnitts oder einer Seite. */
export function InhaltUebergang({ children, kennung, className = '' }: InhaltUebergangProps) {
  return (
    <motion.div
      key={kennung}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
