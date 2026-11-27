import { useTranslation } from 'react-i18next'
import {
  ArchiveRestore,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react'
import { Button } from '@maunting/ui'
import { verdeckt } from './zahlung'
import { TresorVorschau } from './TresorVorschau'
import { formatBytes } from '@/lib/format'
import {
  PAPIERKORB_TAGE,
  formatTransferBadge,
  istPasswortKategorie,
  type VaultItem,
} from './vaultEintrag'
import type { VaultAnsicht } from './vaultAnsichten'

const TAG_MS = 24 * 60 * 60 * 1000

/** Ganze Tage, bis ein Eintrag im Papierkorb endgültig gelöscht wird (mindestens 0). */
export function restTageImPapierkorb(trashedAt: number, jetzt = Date.now()): number {
  return Math.max(0, Math.ceil((trashedAt + PAPIERKORB_TAGE * TAG_MS - jetzt) / TAG_MS))
}

/** Miniatur einer Datei im Archiv oder Papierkorb, sonst das Marken-/Kategoriesymbol. */
function ZeilenBild({ item }: { item: VaultItem }) {
  return <TresorVorschau item={item} />
}

export interface VaultItemRowProps {
  item: VaultItem
  ansicht: VaultAnsicht
  isRevealed: boolean
  totpCode?: string
  totpRemaining: number
  copiedIdField: string | null
  onCopy: (text: string, fieldKey: string, itemId?: string) => Promise<void> | void
  onToggleRevealPassword: (itemId: string) => void
  onRestore: (item: VaultItem) => Promise<void> | void
  onDelete: (item: VaultItem) => Promise<void> | void
  onArchive: (item: VaultItem, archive: boolean) => Promise<void> | void
  onToggleFavorite: (itemId: string) => Promise<void> | void
  onEdit: (item: VaultItem) => void
  /** Öffnet Dateien/Medien/Ordner/Notizen direkt in ihrer Ansicht. */
  onOpen?: (item: VaultItem) => void
}

/** Einzelzeile eines Tresor-Eintrags in Liste, Archiv oder Papierkorb. */
export function VaultItemRow({
  item,
  ansicht,
  isRevealed,
  totpCode,
  totpRemaining,
  copiedIdField,
  onCopy,
  onToggleRevealPassword,
  onRestore,
  onDelete,
  onArchive,
  onToggleFavorite,
  onEdit,
  onOpen,
}: VaultItemRowProps) {
  const { t } = useTranslation()
  const istDatei = !istPasswortKategorie(item.category)
  const kannDirektOeffnen = Boolean(
    onOpen &&
      (item.datei ||
        item.category === 'ordner' ||
        item.category === 'album' ||
        item.category === 'secure_note' ||
        item.zahlung),
  )

  const zeilenUntertitel = istDatei ? (
    <div className="mt-0.5 text-label-sm text-on-surface-variant">
      {item.zahlung
        ? verdeckt(item.zahlung)
        : item.category === 'ordner'
          ? t('mss.vault.dateien.ordner')
          : item.album
            ? t('mss.vault.fotos.album', { count: item.album.eintraege.length })
            : item.datei
              ? formatBytes(item.datei.original.echt)
              : ''}
    </div>
  ) : (
    <div className="flex items-center gap-1.5 mt-0.5">
      <span className="text-label-sm text-on-surface-variant truncate font-mono">
        {item.username || '—'}
      </span>
      {item.username && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          fingerziel
          onClick={() => void onCopy(item.username, `user-${item.id}`, item.id)}
          className="text-on-surface-variant hover:text-on-surface"
          aria-label={t('mss.vault.benutzernameKopieren')}
        >
          {copiedIdField === `user-${item.id}` ? (
            <Check className="h-4 w-4 shrink-0 text-status-success" />
          ) : (
            <Copy className="h-4 w-4 shrink-0" />
          )}
        </Button>
      )}
    </div>
  )

  return (
    <div className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-surface-container hover:bg-surface-container-high border border-outline-variant/20 transition-all shadow-sm">
      {/* Logo, Dienst, Benutzer */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {kannDirektOeffnen && onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:min-h-9"
          >
            <ZeilenBild item={item} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-on-surface truncate">
                  {item.service}
                </span>
                {formatTransferBadge(item) && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-label-sm font-medium rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                    {formatTransferBadge(item)}
                  </span>
                )}
              </div>
              {zeilenUntertitel}
            </div>
          </button>
        ) : (
          <>
            <ZeilenBild item={item} />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-on-surface truncate">
                  {item.service}
                </span>
                {item.url && (
                  <a
                    href={item.url.startsWith('http') ? item.url : `https://${item.url}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('mss.vault.seiteOeffnen', { name: item.service })}
                    className="text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                )}
                {formatTransferBadge(item) && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-label-sm font-medium rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                    {formatTransferBadge(item)}
                  </span>
                )}
              </div>

              {zeilenUntertitel}
            </div>
          </>
        )}
      </div>

      {/* Schnell-Aktionen (Passwort & 2FA) */}
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {item.password && (
          <div className="flex items-center rounded-lg bg-surface-container-low border border-outline-variant/20 px-2 py-0.5 gap-1 font-mono text-xs">
            <span className="text-on-surface select-none">
              {isRevealed ? item.password : '••••••••'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              fingerziel
              onClick={() => onToggleRevealPassword(item.id)}
              aria-label={t(isRevealed ? 'common.hidePassword' : 'common.showPassword')}
              aria-pressed={isRevealed}
              className="text-on-surface-variant hover:text-on-surface"
            >
              {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              fingerziel
              onClick={() => void onCopy(item.password, `pwd-${item.id}`, item.id)}
              className="text-primary hover:text-primary-hover"
              aria-label={t('mss.vault.passwortKopieren')}
            >
              {copiedIdField === `pwd-${item.id}` ? (
                <Check className="h-3.5 w-3.5 text-status-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        )}

        {item.totpSecret && totpCode && (
          totpCode === 'FEHLER' ? (
            <div className="flex items-center rounded-lg bg-status-destructive/10 border border-status-destructive/20 px-2 py-0.5 gap-1 font-mono text-xs">
              <span className="text-label-sm text-status-destructive font-semibold">2FA</span>
              <span className="text-status-destructive font-medium text-label-sm">{t('mss.vault.ungueltigesSecret')}</span>
            </div>
          ) : (
            <div className="flex items-center rounded-lg bg-status-success/10 border border-status-success/20 px-2 py-0.5 gap-1 font-mono text-xs">
              <span className="text-label-sm text-status-success font-semibold">2FA</span>
              <span className="text-status-success font-bold tracking-wider">
                {totpCode.length === 6 ? `${totpCode.slice(0, 3)} ${totpCode.slice(3)}` : totpCode}
              </span>
              <span className="text-label-sm text-status-success/70">({totpRemaining}s)</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                fingerziel
                onClick={() => void onCopy(totpCode, `totp-${item.id}`, item.id)}
                className="text-status-success hover:text-status-success/80"
                aria-label={t('mss.vault.codeKopieren')}
              >
                {copiedIdField === `totp-${item.id}` ? (
                  <Check className="h-3.5 w-3.5 text-status-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          )
        )}

        {ansicht === 'papierkorb' ? (
          <div className="flex items-center gap-1 border-l border-outline-variant/20 pl-1.5">
            {item.trashedAt && (
              <span className="text-label-sm text-on-surface-variant">
                {t('mss.vault.nochTage', { count: restTageImPapierkorb(item.trashedAt) })}
              </span>
            )}
            <Button
              fingerziel
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void onRestore(item)}
              className="text-xs px-2 py-1 text-primary"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              {t('mss.vault.wiederherstellen')}
            </Button>
            <Button
              fingerziel
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void onDelete(item)}
              className="text-xs px-2 py-1 text-status-destructive hover:bg-status-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t('mss.vault.endgueltigLoeschen')}
            </Button>
          </div>
        ) : (
          /* Favorit & Edit */
          <div className="flex items-center gap-0.5 border-l border-outline-variant/20 pl-1.5">
            {ansicht === 'archiv' && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                fingerziel
                onClick={() => void onArchive(item, false)}
                aria-label={t('mss.vault.ausArchiv')}
                className="text-on-surface-variant hover:text-primary"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
              </Button>
            )}
            {!istDatei && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                fingerziel
                onClick={() => void onToggleFavorite(item.id)}
                aria-label={t(item.isFavorite ? 'mss.vault.favoritEntfernen' : 'mss.vault.favoritSetzen', { name: item.service })}
                aria-pressed={!!item.isFavorite}
                className={`${
                  item.isFavorite
                    ? 'text-status-warning hover:text-status-warning/80'
                    : 'text-on-surface-variant hover:text-status-warning'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${item.isFavorite ? 'fill-current' : ''}`} />
              </Button>
            )}
            {!istDatei && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                fingerziel
                onClick={() => onEdit(item)}
                aria-label={t('mss.vault.eintragBearbeiten', { name: item.service })}
                className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
