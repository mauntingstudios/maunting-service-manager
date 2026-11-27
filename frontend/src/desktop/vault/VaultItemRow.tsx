import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArchiveRestore,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react'
import { Blattmenue, Blatteintrag, Button } from '@maunting/ui'
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
  const [blattOffen, setBlattOffen] = useState(false)
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
    <div className="mt-0.5 flex items-center gap-1.5">
      <span className="truncate font-mono text-label-sm text-on-surface-variant">
        {item.username || '—'}
      </span>
      {item.username && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          fingerziel
          onClick={() => void onCopy(item.username, `user-${item.id}`, item.id)}
          className="hidden text-on-surface-variant hover:text-on-surface sm:inline-flex"
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
    <div className="group flex items-center justify-between gap-2.5 rounded-xl border border-outline-variant/20 bg-surface-container p-2.5 shadow-sm transition-all hover:bg-surface-container-high sm:p-3">
      {/* Logo, Dienst, Benutzer */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {kannDirektOeffnen && onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:min-h-9"
          >
            <ZeilenBild item={item} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-xs font-semibold text-on-surface">
                  {item.service}
                </span>
                {formatTransferBadge(item) && (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-label-sm font-medium text-primary">
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
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-xs font-semibold text-on-surface">
                  {item.service}
                </span>
                {item.url && (
                  <a
                    href={item.url.startsWith('http') ? item.url : `https://${item.url}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('mss.vault.seiteOeffnen', { name: item.service })}
                    className="hidden text-on-surface-variant transition-colors hover:text-primary sm:inline-flex"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                )}
                {formatTransferBadge(item) && (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-label-sm font-medium text-primary">
                    {formatTransferBadge(item)}
                  </span>
                )}
              </div>

              {zeilenUntertitel}
            </div>
          </>
        )}
      </div>

      {/* Aktionen: am Handy 1x Kopieren / Wiederherstellen + Blattmenü; am Desktop vollständige Leiste */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {item.password && (
          <div
            className={`items-center gap-1 font-mono text-xs sm:rounded-lg sm:border sm:border-outline-variant/20 sm:bg-surface-container-low sm:px-2 sm:py-0.5 ${
              ansicht === 'papierkorb' ? 'hidden sm:flex' : 'flex'
            }`}
          >
            <span className="hidden select-none text-on-surface sm:inline">
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
              className="hidden text-on-surface-variant hover:text-on-surface sm:inline-flex"
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
            <div className="hidden items-center gap-1 rounded-lg border border-status-destructive/20 bg-status-destructive/10 px-2 py-0.5 font-mono text-xs sm:flex">
              <span className="text-label-sm font-semibold text-status-destructive">2FA</span>
              <span className="text-label-sm font-medium text-status-destructive">{t('mss.vault.ungueltigesSecret')}</span>
            </div>
          ) : (
            <div
              className={`items-center gap-1 rounded-lg border border-status-success/20 bg-status-success/10 px-1.5 py-0.5 font-mono text-xs sm:px-2 ${
                ansicht === 'papierkorb' ? 'hidden sm:flex' : 'flex'
              }`}
            >
              <span className="hidden text-label-sm font-semibold text-status-success sm:inline">2FA</span>
              <span className="font-bold tracking-wider text-status-success">
                {totpCode.length === 6 ? `${totpCode.slice(0, 3)} ${totpCode.slice(3)}` : totpCode}
              </span>
              <span className="hidden text-label-sm text-status-success/70 sm:inline">({totpRemaining}s)</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                fingerziel
                onClick={() => void onCopy(totpCode, `totp-${item.id}`, item.id)}
                className="hidden text-status-success hover:text-status-success/80 sm:inline-flex"
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

        <Button
          fingerziel
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setBlattOffen(true)}
          aria-label={t('mss.vault.dashboard.mehr')}
          className="text-on-surface-variant hover:text-on-surface sm:hidden"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>

        {ansicht === 'papierkorb' ? (
          <div className="flex items-center gap-1 sm:border-l sm:border-outline-variant/20 sm:pl-1.5">
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
              aria-label={t('mss.vault.wiederherstellen')}
              className="px-2 py-1 text-xs text-primary"
            >
              <RotateCcw className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
              <span className="hidden sm:inline">{t('mss.vault.wiederherstellen')}</span>
            </Button>
            <Button
              fingerziel
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void onDelete(item)}
              className="hidden px-2 py-1 text-xs text-status-destructive hover:bg-status-destructive/10 sm:inline-flex"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t('mss.vault.endgueltigLoeschen')}
            </Button>
          </div>
        ) : (
          /* Desktop: Archiv wiederherstellen, Favorit & Bearbeiten */
          <div className="hidden items-center gap-0.5 border-l border-outline-variant/20 pl-1.5 sm:flex">
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
                className="text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Mobiles Aktionsblatt für Passwort-Details & Aktionen */}
      <Blattmenue offen={blattOffen} onSchliessen={() => setBlattOffen(false)} titel={item.service}>
        {ansicht === 'papierkorb' ? (
          <>
            <Blatteintrag
              icon={<RotateCcw className="h-4 w-4" />}
              label={t('mss.vault.wiederherstellen')}
              onClick={() => {
                setBlattOffen(false)
                void onRestore(item)
              }}
            />
            <Blatteintrag
              icon={<Trash2 className="h-4 w-4" />}
              label={t('mss.vault.endgueltigLoeschen')}
              gefahr
              onClick={() => {
                setBlattOffen(false)
                void onDelete(item)
              }}
            />
          </>
        ) : (
          <>
            {item.username && (
              <Blatteintrag
                icon={<Copy className="h-4 w-4" />}
                label={t('mss.vault.benutzernameKopieren')}
                hinweis={item.username}
                onClick={() => {
                  void onCopy(item.username, `user-${item.id}`, item.id)
                  setBlattOffen(false)
                }}
              />
            )}
            {item.password && (
              <>
                <Blatteintrag
                  icon={<Copy className="h-4 w-4" />}
                  label={t('mss.vault.passwortKopieren')}
                  hinweis={isRevealed ? item.password : '••••••••'}
                  onClick={() => {
                    void onCopy(item.password, `pwd-${item.id}`, item.id)
                    setBlattOffen(false)
                  }}
                />
                <Blatteintrag
                  icon={isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  label={t(isRevealed ? 'common.hidePassword' : 'common.showPassword')}
                  onClick={() => onToggleRevealPassword(item.id)}
                />
              </>
            )}
            {item.totpSecret && totpCode && totpCode !== 'FEHLER' && (
              <Blatteintrag
                icon={<Copy className="h-4 w-4" />}
                label={t('mss.vault.codeKopieren')}
                hinweis={`${totpCode} (${totpRemaining}s)`}
                onClick={() => {
                  void onCopy(totpCode, `totp-${item.id}`, item.id)
                  setBlattOffen(false)
                }}
              />
            )}
            {ansicht === 'archiv' && (
              <Blatteintrag
                icon={<ArchiveRestore className="h-4 w-4" />}
                label={t('mss.vault.ausArchiv')}
                onClick={() => {
                  setBlattOffen(false)
                  void onArchive(item, false)
                }}
              />
            )}
            {!istDatei && (
              <>
                <Blatteintrag
                  icon={<Star className={`h-4 w-4 ${item.isFavorite ? 'fill-current text-status-warning' : ''}`} />}
                  label={t(item.isFavorite ? 'mss.vault.favoritEntfernen' : 'mss.vault.favoritSetzen', { name: item.service })}
                  onClick={() => {
                    setBlattOffen(false)
                    void onToggleFavorite(item.id)
                  }}
                />
                <Blatteintrag
                  icon={<Edit2 className="h-4 w-4" />}
                  label={t('mss.vault.eintragBearbeiten', { name: item.service })}
                  onClick={() => {
                    setBlattOffen(false)
                    onEdit(item)
                  }}
                />
              </>
            )}
          </>
        )}
      </Blattmenue>
    </div>
  )
}
