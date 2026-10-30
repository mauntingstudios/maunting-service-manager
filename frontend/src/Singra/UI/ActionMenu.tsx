import { useZurueckSchliesst } from './useZurueckSchliesst'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cx } from '@/utils/classNames'
import { buttonClasses } from '@/components/ui/Button'
import { useAnkerLage } from './Ankerlage'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  destructive?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

interface ActionMenuProps {
  label: string
  items: ActionMenuItem[]
  icon?: ReactNode
  disabled?: boolean
  align?: 'start' | 'end'
  compact?: boolean
  /** Auslöser-Stil der DNA; Standard bleibt der sekundäre Knopf. */
  variant?: 'secondary' | 'ghost'
  /** Nur Icon zeigen; `label` wird dann zur zugänglichen Beschriftung. */
  iconOnly?: boolean
  ariaLabel?: string
  /**
   * `dna` gleicht die Fläche dem DNA-`Dropdown` an: gleiche Kante, gleicher
   * Schatten, kein Backdrop-Blur, festere Mindestbreite. Nur dort einsetzen,
   * wo die Oberfläche bewusst wie eine DNA-Auswahl aussehen soll.
   */
  surface?: 'default' | 'dna'
}

/** Compact action menu for dense operational toolbars. */
export function ActionMenu({
  label,
  items,
  icon,
  disabled = false,
  align = 'start',
  compact = false,
  variant = 'secondary',
  iconOnly = false,
  ariaLabel,
  surface = 'default',
}: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  useZurueckSchliesst(open, () => setOpen(false))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const lage = useAnkerLage(open, triggerRef, menuRef, {
    ausrichtung: align === 'end' ? 'ende' : 'start',
    mindestensAnkerbreite: true,
  })
  const initialFocusRef = useRef<'first' | 'last'>('first')
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    // Escape in der Capture-Phase: vor dem Dialog darunter, der dann
    // `defaultPrevented` sieht und offen bleibt.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const menuItems: HTMLButtonElement[] = menuRef.current
        ? Array.from<HTMLButtonElement>(menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)'))
        : []
      if (!menuItems.length) return
      event.preventDefault()
      const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? menuItems.length - 1
          : event.key === 'ArrowUp'
            ? (currentIndex - 1 + menuItems.length) % menuItems.length
            : (currentIndex + 1) % menuItems.length
      menuItems[nextIndex].focus()
    }
    const focusFrame = window.requestAnimationFrame(() => {
      const menuItems: HTMLButtonElement[] = menuRef.current
        ? Array.from<HTMLButtonElement>(menuRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)'))
        : []
      const initialItem = initialFocusRef.current === 'last' ? menuItems[menuItems.length - 1] : menuItems[0]
      initialItem?.focus()
    })
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keydown', onEscape, true)
      window.cancelAnimationFrame(focusFrame)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={iconOnly ? (ariaLabel ?? label) : undefined}
        onClick={() => {
          initialFocusRef.current = 'first'
          setOpen((value) => !value)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
          setOpen(true)
        }}
        className={cx(
          buttonClasses(variant, compact ? 'sm' : 'md', 'gap-1.5 disabled:cursor-not-allowed disabled:opacity-45'),
          // Auf dem Telefon bleibt der Auslöser ein Daumenziel; ab sm gilt die
          // Höhe des Knopfs daneben.
          compact
            ? surface === 'dna' ? 'h-11 sm:h-9' : 'h-11 sm:h-8'
            : 'h-11 sm:h-10',
          iconOnly && `w-11 justify-center px-0 ${surface === 'dna' ? 'sm:w-9' : 'sm:w-8'}`,
        )}
      >
        {icon}
        {!iconOnly && <span>{label}</span>}
        {!iconOnly && (
          <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        )}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              style={lage}
              className={
                surface === 'dna'
                  ? 'min-w-[200px] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-high p-1 shadow-panel'
                  : 'min-w-[190px] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-high/98 p-1.5 shadow-panel backdrop-blur-xl'
              }
            >
              {items.map((item) => (
                <div key={item.key} className={item.separatorBefore ? 'mt-1 border-t border-outline-variant pt-1' : ''}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect()
                      setOpen(false)
                    }}
                    className={cx(
                      'flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9',
                      item.destructive
                        ? 'text-status-destructive hover:bg-status-destructive/10'
                        : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface',
                    )}
                  >
                    <span
                      className={`flex shrink-0 items-center justify-center ${
                        surface === 'dna' ? 'h-5 w-5' : 'h-4 w-4'
                      }`}
                      aria-hidden
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
