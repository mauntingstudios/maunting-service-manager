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
  Plus,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Blatteintrag, Blattmenue } from '@maunting/ui'
import type { VaultAnsicht } from './vaultAnsichten'

export interface TresorUntereLeisteProps {
  ansicht: VaultAnsicht
  onAnsicht: (ansicht: VaultAnsicht) => void
  onNeuerEintrag: () => void
  anzahlImPapierkorb: number
  onNotizen?: () => void
  onPasswortGenerieren?: () => void
  onSicherheitscheck?: () => void
  onImportExport?: () => void
  onHinweisVerwalten?: () => void
  onSperren?: () => void
}

const SYMBOL = 'h-5 w-5'

/** Untere Leiste am Telefon. „Freigaben“ gibt es nicht — der Tresor teilt nichts. */
export function TresorUntereLeiste({
  ansicht,
  onAnsicht,
  onNeuerEintrag,
  anzahlImPapierkorb,
  onNotizen,
  onPasswortGenerieren,
  onSicherheitscheck,
  onImportExport,
  onHinweisVerwalten,
  onSperren,
}: TresorUntereLeisteProps) {
  const { t } = useTranslation()
  const [mehrOffen, setMehrOffen] = useState(false)

  const reiter = (id: VaultAnsicht, labelKey: string, icon: ReactNode) => {
    const aktiv = ansicht === id
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={aktiv}
        onClick={() => onAnsicht(id)}
        className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.65rem] font-medium transition-colors ${
          aktiv ? 'text-primary' : 'text-on-surface-variant'
        }`}
      >
        {icon}
        <span className="max-w-full truncate">{t(labelKey)}</span>
      </button>
    )
  }

  const mehrAktiv = ansicht !== 'uebersicht' && ansicht !== 'tresor'
  const darfNeuAnlegen = ansicht === 'uebersicht' || ansicht === 'tresor'

  return (
    <>
      <div className="shrink-0 border-t border-outline-variant/20 bg-surface-container-low/95 pb-[var(--msm-unten-sicher)] backdrop-blur-xl md:hidden">
        <div
          role="tablist"
          aria-orientation="horizontal"
          aria-label={t('mss.vault.titelManager')}
          className="grid grid-cols-4 items-center px-2 py-1"
        >
          {reiter('uebersicht', 'mss.vault.dashboard.uebersicht', <LayoutGrid className={SYMBOL} />)}
          {reiter('tresor', 'mss.vault.ansicht.tresor', <Shield className={SYMBOL} />)}
          <button
            type="button"
            onClick={onNeuerEintrag}
            aria-label={
              darfNeuAnlegen
                ? t('mss.vault.neuerEintrag')
                : t('mss.vault.dashboard.neuKurz')
            }
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-primary shadow-md"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mehrAktiv}
            onClick={() => setMehrOffen(true)}
            className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.65rem] font-medium transition-colors ${
              mehrAktiv ? 'text-primary' : 'text-on-surface-variant'
            }`}
          >
            <MoreHorizontal className={SYMBOL} />
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
          icon={<FolderLock className={SYMBOL} />}
          label={t('mss.vault.ansicht.dateien')}
          onClick={() => {
            setMehrOffen(false)
            onAnsicht('dateien')
          }}
        />
        <Blatteintrag
          icon={<Images className={SYMBOL} />}
          label={t('mss.vault.ansicht.fotos')}
          onClick={() => {
            setMehrOffen(false)
            onAnsicht('fotos')
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
