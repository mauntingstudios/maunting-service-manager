import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  PasswordInput,
  Textarea,
} from '@maunting/ui'
import { generateSecurePassword } from './vaultCrypto'
import { getBrandIcon } from './brandCatalog'
import type { LeakCheckResult } from './leakChecker'
import type { VaultItem } from './vaultEintrag'

export interface VaultEntryModalProps {
  isOpen: boolean
  onClose: () => Promise<void> | void
  editingItem?: VaultItem
  isTeam: boolean
  modalService: string
  onServiceChange: (val: string) => void
  modalUsername: string
  onUsernameChange: (val: string) => void
  modalPassword: string
  onPasswordChange: (val: string) => void
  modalUrl: string
  modalTotpSecret: string
  onTotpSecretChange: (val: string) => void
  modalOrdner: string
  onOrdnerChange: (val: string) => void
  ordnerOptionen: { value: string; label: string }[]
  modalNotes: string
  onNotesChange: (val: string) => void
  leakCheckResult: LeakCheckResult | null
  onLeakCheck: (pw: string) => void
  onOpenQrScanner: () => void
  onSubmit: (e: React.FormEvent) => Promise<void> | void
  onTrashItem: (item: VaultItem) => Promise<void> | void
  onArchiveItem: (item: VaultItem, archived: boolean) => Promise<void> | void
  onTransferItem: (item: VaultItem) => void
}

/** Dialog zum Anlegen und Bearbeiten eines Tresor-Login-Eintrags. */
export function VaultEntryModal({
  isOpen,
  onClose,
  editingItem,
  isTeam,
  modalService,
  onServiceChange,
  modalUsername,
  onUsernameChange,
  modalPassword,
  onPasswordChange,
  modalUrl,
  modalTotpSecret,
  onTotpSecretChange,
  modalOrdner,
  onOrdnerChange,
  ordnerOptionen,
  modalNotes,
  onNotesChange,
  leakCheckResult,
  onLeakCheck,
  onOpenQrScanner,
  onSubmit,
  onTrashItem,
  onArchiveItem,
  onTransferItem,
}: VaultEntryModalProps) {
  const { t } = useTranslation()
  const ModalBrandIcon = getBrandIcon(modalService, modalUrl)

  return (
    <Dialog open={isOpen} onOpenChange={(offen) => !offen && void onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh]">
        <DialogHeader className="px-4 py-3 pr-14">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface border border-outline-variant/20 p-1">
              <ModalBrandIcon className="w-4 h-4" />
            </div>
            <DialogTitle className="text-sm">
              {editingItem ? t('common.edit') : t('mss.vault.neuerEintrag')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <Input
              id="tresor-dienst"
              label={t('mss.vault.dienstBezeichnung')}
              type="text"
              value={modalService}
              onChange={(e) => onServiceChange(e.target.value)}
              placeholder={t('mss.vault.dienstPlatzhalter')}
              autoFocus
              required
            />

            <Input
              id="tresor-benutzer"
              label={t('mss.vault.benutzernameBezeichnung')}
              type="text"
              value={modalUsername}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder={t('mss.vault.benutzernamePlatzhalter')}
              autoComplete="off"
            />

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="tresor-passwort" className="text-sm font-medium text-foreground">
                  {t('common.password')}
                </label>
                <Button
                  fingerziel
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newP = generateSecurePassword(20, true)
                    onPasswordChange(newP)
                    onLeakCheck(newP)
                  }}
                  className="text-primary"
                >
                  <Zap className="h-3 w-3" />
                  {t('mss.vault.generieren')}
                </Button>
              </div>

              <PasswordInput
                id="tresor-passwort"
                value={modalPassword}
                onChange={(e) => {
                  onPasswordChange(e.target.value)
                  onLeakCheck(e.target.value)
                }}
                placeholder={t('common.password')}
                autoComplete="new-password"
                className="font-mono"
                required
              />

              {leakCheckResult && leakCheckResult.checked && (
                <div className="mt-1" role="status">
                  {leakCheckResult.isLeaked ? (
                    <span className="flex items-center gap-1 text-label-sm text-status-destructive">
                      <ShieldAlert className="h-3 w-3" />
                      {t('mss.vault.leckGefunden', { count: leakCheckResult.count, anzahl: leakCheckResult.count.toLocaleString() })}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-label-sm text-status-success">
                      <ShieldCheck className="h-3 w-3" /> {t('mss.vault.keinLeck')}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="tresor-totp" className="text-sm font-medium text-foreground">
                  {t('mss.vault.zweifaktorBezeichnung')}
                </label>
                <Button
                  fingerziel
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onOpenQrScanner}
                  className="text-primary"
                >
                  <QrCode className="h-3 w-3" />
                  {t('mss.vault.qr.scannen')}
                </Button>
              </div>
              <Input
                id="tresor-totp"
                type="text"
                value={modalTotpSecret}
                onChange={(e) => onTotpSecretChange(e.target.value.toUpperCase())}
                placeholder={t('mss.vault.zweifaktorPlatzhalter')}
                autoComplete="off"
                className="font-mono"
              />
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-foreground">{t('mss.vault.dateien.ordner')}</span>
              <Dropdown
                value={modalOrdner}
                onChange={onOrdnerChange}
                options={ordnerOptionen}
                aria-label={t('mss.vault.dateien.ordner')}
                searchable={ordnerOptionen.length > 6}
              />
            </div>

            <Textarea
              id="tresor-notiz"
              label={t('mss.vault.notizBezeichnung')}
              rows={2}
              value={modalNotes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder={t('mss.vault.notizPlatzhalter')}
            />
          </div>

          <DialogFooter className="flex flex-col gap-3 bg-transparent border-t border-outline-variant/20 p-4 w-full">
            {editingItem ? (
              <div className="grid grid-cols-3 gap-2 w-full">
                <Button
                  fingerziel
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('mss.vault.inPapierkorb')}
                  onClick={() => void onTrashItem(editingItem)}
                  className="w-full justify-center text-status-destructive hover:bg-status-destructive/10 text-xs px-2"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0 mr-1" />
                  <span className="truncate">Papierkorb</span>
                </Button>
                <Button
                  fingerziel
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={editingItem.archivedAt ? t('mss.vault.ausArchiv') : t('mss.vault.archivieren')}
                  onClick={() => void onArchiveItem(editingItem, !editingItem.archivedAt)}
                  className="w-full justify-center text-on-surface-variant text-xs px-2"
                >
                  {editingItem.archivedAt ? (
                    <>
                      <ArchiveRestore className="h-3.5 w-3.5 shrink-0 mr-1" />
                      <span className="truncate">Aus Archiv</span>
                    </>
                  ) : (
                    <>
                      <Archive className="h-3.5 w-3.5 shrink-0 mr-1" />
                      <span className="truncate">Archivieren</span>
                    </>
                  )}
                </Button>
                {!isTeam ? (
                  <Button
                    fingerziel
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('teams.transferToTeam')}
                    onClick={() => onTransferItem(editingItem)}
                    className="w-full justify-center text-on-surface-variant hover:text-primary text-xs px-2"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 mr-1" />
                    <span className="truncate">Übertragen</span>
                  </Button>
                ) : (
                  <div />
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-between w-full pt-1">
              <Button type="button" variant="ghost" onClick={() => void onClose()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit">{t('common.save')}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
