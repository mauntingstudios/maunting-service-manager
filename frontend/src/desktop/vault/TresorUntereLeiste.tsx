import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArrowUpDown,
  CreditCard,
  FileText,
  FolderLock,
  Images,
  KeyRound,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  QrCode,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Blatteintrag, Blattmenue } from '@maunting/ui'
import type { VaultAnsicht } from './vaultAnsichten'

export interface TresorUntereLeisteProps {
  ansicht: VaultAnsicht
  onAnsicht: (ansicht: VaultAnsicht) => void
  anzahlImPapierkorb: number
  notizenAktiv?: boolean
  onNotizen?: () => void
  onWallet?: () => void
  onPasswortGenerieren?: () => void
  onSicherheitscheck?: () => void
  onImportExport?: () => void
  onHinweisVerwalten?: () => void
  onSperren?: () => void
}

const SYMBOL = 'h-5 w-5'

/** Untere Leiste am Telefon: 5 Hauptziele, Nebensachen im „Mehr“-Blatt. */
export function TresorUntereLeiste({
  ansicht,
  onAnsicht,
  anzahlImPapierkorb,
  notizenAktiv = false,
  onNotizen,
  onWallet,
  onPasswortGenerieren,
  onSicherheitscheck,
  onImportExport,
  onHinweisVerwalten,
  onSperren,
}: TresorUntereLeisteProps) {
  const { t } = useTranslation()
  const [mehrOffen, setMehrOffen] = useState(false)

  const reiter = (id: string, aktiv: boolean, labelKey: string, icon: ReactNode, onClick: () => void) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={aktiv}
      onClick={onClick}
      className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.65rem] font-medium transition-colors ${
        aktiv ? 'text-primary' : 'text-on-surface-variant'
      }`}
    >
      {icon}
      <span className="max-w-full truncate">{t(labelKey)}</span>
    </button>
  )

  const mehrAktiv =
    ansicht === 'zahlung' || ansicht === 'archiv' || ansicht === 'papierkorb' || Boolean(notizenAktiv)

  return (
    <>
      <div className="shrink-0 border-t border-outline-variant/20 bg-surface-container-low/95 pb-[var(--msm-unten-sicher)] backdrop-blur-xl md:hidden">
        <div
          role="tablist"
          aria-orientation="horizontal"
          aria-label={t('mss.vault.titelManager')}
          className="grid grid-cols-5 items-center px-1.5 py-1"
        >
          {reiter(
            'uebersicht',
            ansicht === 'uebersicht',
            'mss.vault.dashboard.uebersicht',
            <LayoutGrid className={SYMBOL} aria-hidden="true" />,
            () => onAnsicht('uebersicht'),
          )}
          {reiter(
            'tresor',
            ansicht === 'tresor' && !notizenAktiv,
            'mss.vault.ansicht.tresor',
            <KeyRound className={SYMBOL} aria-hidden="true" />,
            () => onAnsicht('tresor'),
          )}
          {reiter(
            'dateien',
            ansicht === 'dateien',
            'mss.vault.ansicht.dateien',
            <FolderLock className={SYMBOL} aria-hidden="true" />,
            () => onAnsicht('dateien'),
          )}
          {reiter(
            'fotos',
            ansicht === 'fotos',
            'mss.vault.ansicht.fotos',
            <Images className={SYMBOL} aria-hidden="true" />,
            () => onAnsicht('fotos'),
          )}
          <button
            type="button"
            role="tab"
            aria-selected={mehrAktiv}
            onClick={() => setMehrOffen(true)}
            className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.65rem] font-medium transition-colors ${
              mehrAktiv ? 'text-primary' : 'text-on-surface-variant'
            }`}
          >
            <MoreHorizontal className={SYMBOL} aria-hidden="true" />
            <span>{t('mss.vault.dashboard.mehr')}</span>
          </button>
        </div>
      </div>

      <Blattmenue offen={mehrOffen} onSchliessen={() => setMehrOffen(false)} titel={t('mss.vault.dashboard.mehr')}>
        {onNotizen && (
          <Blatteintrag
            icon={<FileText className={SYMBOL} />}
            label={t('mss.vault.dashboard.filterNotizen')}
            onClick={() => {
              setMehrOffen(false)
              onNotizen()
            }}
          />
        )}
        <Blatteintrag
          icon={<CreditCard className={SYMBOL} />}
          label={t('mss.vault.ansicht.zahlung')}
          onClick={() => {
            setMehrOffen(false)
            onAnsicht('zahlung')
          }}
        />
        <Blatteintrag
          icon={<Archive className={SYMBOL} />}
          label={t('mss.vault.ansicht.archiv')}
          onClick={() => {
            setMehrOffen(false)
            onAnsicht('archiv')
          }}
        />
        <Blatteintrag
          icon={<Trash2 className={SYMBOL} />}
          label={
            anzahlImPapierkorb > 0
              ? `${t('mss.vault.ansicht.papierkorb')} (${anzahlImPapierkorb})`
              : t('mss.vault.ansicht.papierkorb')
          }
          onClick={() => {
            setMehrOffen(false)
            onAnsicht('papierkorb')
          }}
        />
        {onWallet && (
          <Blatteintrag
            icon={<QrCode className={SYMBOL} />}
            label={t('mss.vault.walletModus', 'Smartcard-Wallet')}
            onClick={() => {
              setMehrOffen(false)
              onWallet()
            }}
          />
        )}
        {onPasswortGenerieren && (
          <Blatteintrag
            icon={<Sparkles className={SYMBOL} />}
            label={t('mss.vault.dashboard.passwortGenerieren')}
            onClick={() => {
              setMehrOffen(false)
              onPasswortGenerieren()
            }}
          />
        )}
        {onSicherheitscheck && (
          <Blatteintrag
            icon={<ShieldCheck className={SYMBOL} />}
            label={t('mss.vault.dashboard.sicherheitscheck')}
            onClick={() => {
              setMehrOffen(false)
              onSicherheitscheck()
            }}
          />
        )}
        {onImportExport && (
          <Blatteintrag
            icon={<ArrowUpDown className={SYMBOL} />}
            label={t('mss.vault.dashboard.importExport')}
            onClick={() => {
              setMehrOffen(false)
              onImportExport()
            }}
          />
        )}
        {onHinweisVerwalten && (
          <Blatteintrag
            icon={<KeyRound className={SYMBOL} />}
            label={t('mss.vault.hinweisVerwalten')}
            onClick={() => {
              setMehrOffen(false)
              onHinweisVerwalten()
            }}
          />
        )}
        {onSperren && (
          <Blatteintrag
            icon={<Lock className={SYMBOL} />}
            label={t('mss.vault.sperren')}
            gefahr
            onClick={() => {
              setMehrOffen(false)
              onSperren()
            }}
          />
        )}
      </Blattmenue>
    </>
  )
}
