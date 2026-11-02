import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Logo } from '@/components/Logo'
import { CreditCard, Menu } from 'lucide-react'

interface TopbarProps {
  onOpenNavigation?: () => void
  menuButtonRef?: RefObject<HTMLButtonElement>
  onOpenWallet?: () => void
}

export function Topbar({ onOpenNavigation, menuButtonRef, onOpenWallet }: TopbarProps) {
  const { t } = useTranslation()

  return (
    <header className="lg:hidden h-12 flex items-center justify-between px-3 border-b border-outline-variant/30 bg-surface-container-low/95 backdrop-blur-md sticky top-0 z-30 shrink-0">
      <div className="flex items-center gap-2.5">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenNavigation}
          className="grid min-h-10 min-w-10 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
          aria-label={t('shell.openNavigation')}
          aria-haspopup="dialog"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Logo size="sm" />
          <span className="font-headline text-sm font-bold text-primary">MSM</span>
        </div>
      </div>

      {onOpenWallet && (
        <button
          type="button"
          onClick={onOpenWallet}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/25 transition-all active:scale-95 text-xs font-semibold shadow-xs"
          aria-label="Smartcard Wallet"
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Wallet</span>
        </button>
      )}
    </header>
  )
}

