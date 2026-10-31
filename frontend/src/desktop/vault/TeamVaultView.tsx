/**
 * Team-Tresor (E2EE Zero-Knowledge für Teams / Familien).
 *
 * 1:1 Wiederverwendung der Tresor-Kryptographie, Design-DNA und UI-Muster.
 * Bietet geteilte Passwörter, Notizen, Dateien und Ordner mit separatem
 * Team-Master-Passwort, Revisions-Sync und Rotations-Warnung bei Mitglieder-Austritt.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Folder,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  Trash2,
  Unlock,
  Wand2,
} from 'lucide-react'

import type { TeamDetail } from '@/api/teams'
import { Button, Dialog, DialogContent, Dropdown, type DropdownOption, Input, Textarea } from '@/Singra/UI'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { toast } from '@/stores/toastStore'
import { useTeamVaultStore } from './teamVaultStore'
import { createDebouncedLeakChecker, type LeakCheckResult } from './leakChecker'
import { generateSecurePassword, MASTER_PASSWORT_MINDESTLAENGE } from './vaultCrypto'
import type { VaultItem } from './vaultEintrag'

interface TeamVaultViewProps {
  team: TeamDetail
}

type FilterKategorie = 'alle' | 'login' | 'secure_note' | 'datei' | 'ordner'

export function TeamVaultView({ team }: TeamVaultViewProps) {
  const { t } = useTranslation()
  const {
    isInitialized,
    isUnlocked,
    needsRotation,
    isOwner,
    items,
    syncStatus,
    error,
    loadStatus,
    setup,
    unlock,
    rotatePassword,
    lock,
    saveItem,
    deleteItem,
  } = useTeamVaultStore()

  // Setup / Unlock State
  const [masterPassword, setMasterPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [leakCheck, setLeakCheck] = useState<LeakCheckResult | null>(null)

  // Rotation Dialog
  const [rotationOpen, setRotationOpen] = useState(false)
  const [rotPassword, setRotPassword] = useState('')
  const [rotRepeat, setRotRepeat] = useState('')
  const [rotBusy, setRotBusy] = useState(false)
  const [rotLeakCheck, setRotLeakCheck] = useState<LeakCheckResult | null>(null)

  // Suche & Filter
  const [suche, setSuche] = useState('')
  const [kategorie, setKategorie] = useState<FilterKategorie>('alle')
  const [gewaehltesItem, setGewaehltesItem] = useState<VaultItem | null>(null)

  // Eintrag Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [formKat, setFormKat] = useState<string>('login')
  const [formService, setFormService] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formNotes, setFormNotes] = useState('')

  const checkMasterPasswordLeak = useMemo(() => createDebouncedLeakChecker(setLeakCheck), [])
  const checkRotPasswordLeak = useMemo(() => createDebouncedLeakChecker(setRotLeakCheck), [])

  useEffect(() => {
    void loadStatus(team.id)
  }, [team.id, loadStatus])

  const handlePasswordChange = (pw: string) => {
    setMasterPassword(pw)
    checkMasterPasswordLeak(pw)
  }

  const handleRotPasswordChange = (pw: string) => {
    setRotPassword(pw)
    checkRotPasswordLeak(pw)
  }

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (masterPassword.length < MASTER_PASSWORT_MINDESTLAENGE) {
      toast.error(t('mss.vault.mindestlaenge', { anzahl: MASTER_PASSWORT_MINDESTLAENGE }))
      return
    }
    if (masterPassword !== repeatPassword) {
      toast.error(t('mss.vault.stimmtNichtUeberein'))
      return
    }
    setBusy(true)
    try {
      const ok = await setup(team.id, masterPassword)
      if (ok) {
        toast.success(t('mss.vault.eingerichtet'))
        setMasterPassword('')
        setRepeatPassword('')
      } else {
        toast.error(error || t('mss.vault.speichernFehlgeschlagen'))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!masterPassword) return
    setBusy(true)
    try {
      const ok = await unlock(team.id, masterPassword)
      if (ok) {
        toast.success(t('mss.vault.entsperrt'))
        setMasterPassword('')
      } else {
        toast.error(error || t('teams.vaultWrongPassword'))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleRotate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rotPassword.length < MASTER_PASSWORT_MINDESTLAENGE) {
      toast.error(t('mss.vault.mindestlaenge', { anzahl: MASTER_PASSWORT_MINDESTLAENGE }))
      return
    }
    if (rotPassword !== rotRepeat) {
      toast.error(t('mss.vault.stimmtNichtUeberein'))
      return
    }
    setRotBusy(true)
    try {
      const ok = await rotatePassword(team.id, rotPassword)
      if (ok) {
        toast.success(t('teams.vaultPasswordRotated'))
        setRotationOpen(false)
        setRotPassword('')
        setRotRepeat('')
      } else {
        toast.error(error || t('mss.vault.speichernFehlgeschlagen'))
      }
    } finally {
      setRotBusy(false)
    }
  }

  const handleOpenAdd = () => {
    setEditId(null)
    setFormKat('login')
    setFormService('')
    setFormUsername('')
    setFormPassword('')
    setFormUrl('')
    setFormNotes('')
    setModalOpen(true)
  }

  const handleOpenEdit = (item: VaultItem) => {
    setEditId(item.id)
    setFormKat(item.category || 'login')
    setFormService(item.service)
    setFormUsername(item.username || '')
    setFormPassword(item.password || '')
    setFormUrl(item.url || '')
    setFormNotes(item.notes || '')
    setModalOpen(true)
  }

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formService.trim()) return
    setBusy(true)
    try {
      await saveItem({
        id: editId || undefined,
        service: formService.trim(),
        category: formKat,
        username: formUsername,
        password: formPassword,
        url: formUrl.trim() || undefined,
        notes: formNotes || undefined,
      })
      toast.success(t('mss.vault.gespeichert'))
      setModalOpen(false)
      if (gewaehltesItem && gewaehltesItem.id === editId) {
        setGewaehltesItem((prev) => (prev ? { ...prev, service: formService, username: formUsername, password: formPassword, url: formUrl, notes: formNotes } : null))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteItem = async (id: string) => {
    setBusy(true)
    try {
      await deleteItem(id)
      toast.success(t('mss.vault.geloescht'))
      if (gewaehltesItem?.id === id) setGewaehltesItem(null)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const kategorieOptionen: DropdownOption[] = [
    { value: 'login', label: t('teams.vaultCatLogin') },
    { value: 'secure_note', label: t('teams.vaultCatNote') },
    { value: 'ordner', label: t('teams.vaultCatFolder') },
  ]

  const gefilterteItems = useMemo(() => {
    return items.filter((item) => {
      if (item.trashedAt) return false
      if (kategorie !== 'alle' && item.category !== kategorie) return false
      if (suche.trim()) {
        const q = suche.toLowerCase()
        const matchService = item.service?.toLowerCase().includes(q)
        const matchUser = item.username?.toLowerCase().includes(q)
        const matchUrl = item.url?.toLowerCase().includes(q)
        if (!matchService && !matchUser && !matchUrl) return false
      }
      return true
    })
  }, [items, kategorie, suche])

  // FALL 1: Noch nicht eingerichtet
  if (!isInitialized) {
    if (!isOwner) {
      return (
        <div className="msm-card p-8 text-center space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold text-on-surface">{t('teams.vaultNotSetup')}</h2>
          <p className="text-sm text-on-surface-variant max-w-md mx-auto">{t('teams.vaultNotSetupDesc')}</p>
        </div>
      )
    }

    return (
      <div className="msm-card p-6 max-w-lg mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-on-surface">{t('teams.vaultSetup')}</h2>
            <p className="text-xs text-on-surface-variant">{t('teams.vaultSetupDesc')}</p>
          </div>
        </div>

        <form onSubmit={handleSetup} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-on-surface">{t('mss.vault.masterPasswort')}</label>
            <PasswordInput
              value={masterPassword}
              onChange={(e) => handlePasswordChange(e.target.value)}
              placeholder={t('mss.vault.masterPasswort')}
              required
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-on-surface">{t('teams.vaultRepeatPassword')}</label>
            <PasswordInput
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
              placeholder={t('teams.vaultRepeatPassword')}
              required
              disabled={busy}
            />
          </div>

          {leakCheck && leakCheck.checked && (
            <div className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${leakCheck.isLeaked ? 'bg-error/10 border-error/30 text-error' : 'bg-success/10 border-success/30 text-success'}`}>
              {leakCheck.isLeaked ? <ShieldAlert className="h-4 w-4 shrink-0" /> : <ShieldCheck className="h-4 w-4 shrink-0" />}
              <span>{leakCheck.isLeaked ? t('mss.vault.leckGefunden_other', { anzahl: leakCheck.count }) : t('mss.vault.keinLeck')}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const gen = generateSecurePassword(20, true)
                setMasterPassword(gen)
                setRepeatPassword(gen)
                checkMasterPasswordLeak(gen)
              }}
              disabled={busy}
            >
              <Wand2 className="h-4 w-4 mr-1.5" />
              {t('teams.vaultGeneratePassword')}
            </Button>
            <Button type="submit" disabled={busy || masterPassword.length < MASTER_PASSWORT_MINDESTLAENGE || masterPassword !== repeatPassword}>
              {busy ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
              {t('teams.vaultSetup')}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // FALL 2: Eingerichtet, aber gesperrt
  if (!isUnlocked) {
    return (
      <div className="msm-card p-6 max-w-md mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-on-surface">{t('teams.vaultUnlock')}</h2>
            <p className="text-xs text-on-surface-variant">{t('teams.vaultUnlockDesc')}</p>
          </div>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <PasswordInput
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            placeholder={t('mss.vault.masterPasswort')}
            required
            autoFocus
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !masterPassword}>
              {busy ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Unlock className="h-4 w-4 mr-1.5" />}
              {t('profile.dataExport.vaultUnlock')}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  // FALL 3: Entsperrt (Volle Funktionalität)
  return (
    <div className="space-y-4">
      {/* Rotations-Warnbanner bei Mitglieder-Entfernung */}
      {needsRotation && (
        <div className="p-4 rounded-2xl bg-warning/10 border border-warning/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-warning">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <h4 className="text-xs font-semibold text-on-surface">{t('teams.vaultRotationTitle')}</h4>
              <p className="text-xs text-on-surface-variant">{t('teams.vaultRotationNotice')}</p>
            </div>
          </div>
          {isOwner && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setRotPassword('')
                setRotRepeat('')
                setRotLeakCheck(null)
                setRotationOpen(true)
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {t('teams.vaultRotateBtn')}
            </Button>
          )}
        </div>
      )}

      {/* Kopf-Leiste: Suche, Filter, Aktionen */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <Input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={t('common.search')}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void useTeamVaultStore.getState().syncWithServer(team.id)} disabled={syncStatus === 'syncing'}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={handleOpenAdd}>
            <Plus className="h-4 w-4 mr-1.5" />
            {t('common.add')}
          </Button>
          <Button variant="ghost" size="sm" onClick={lock} aria-label={t('mss.vault.sperren')}>
            <Lock className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter-Kategorien */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {(['alle', 'login', 'secure_note', 'datei', 'ordner'] as const).map((k) => {
          const label =
            k === 'alle'
              ? t('mss.vault.alle')
              : k === 'login'
              ? t('teams.vaultCatLogin')
              : k === 'secure_note'
              ? t('teams.vaultCatNote')
              : k === 'datei'
              ? t('teams.vaultCatFile')
              : t('teams.vaultCatFolder')
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKategorie(k)}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
                kategorie === k
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-surface border-outline-variant/30 text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Liste der Einträge */}
      {gefilterteItems.length === 0 ? (
        <div className="msm-card p-8 text-center space-y-2">
          <p className="text-xs text-on-surface-variant">{t('mss.vault.leer')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {gefilterteItems.map((item) => (
            <div
              key={item.id}
              onClick={() => setGewaehltesItem(item)}
              className="msm-card p-3.5 hover:border-primary/50 transition-colors cursor-pointer flex items-start justify-between gap-3 group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-high border border-outline-variant/30 text-primary">
                  {item.category === 'ordner' ? (
                    <Folder className="h-4 w-4" />
                  ) : item.category === 'secure_note' ? (
                    <StickyNote className="h-4 w-4" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-on-surface truncate">{item.service}</h4>
                  <p className="text-xs text-on-surface-variant truncate">{item.username || item.category || '—'}</p>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-error hover:bg-error/10"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDeleteItem(item.id)
                  }}
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail-Modal für einen gewählten Eintrag */}
      <Dialog open={!!gewaehltesItem} onOpenChange={(open) => !open && setGewaehltesItem(null)}>
        <DialogContent className="max-w-md p-5 space-y-4">
          {gewaehltesItem && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-on-surface">{gewaehltesItem.service}</h3>
                    <p className="text-xs text-on-surface-variant">
                      {gewaehltesItem.category === 'ordner'
                        ? t('teams.vaultCatFolder')
                        : gewaehltesItem.category === 'secure_note'
                        ? t('teams.vaultCatNote')
                        : gewaehltesItem.category === 'datei'
                        ? t('teams.vaultCatFile')
                        : t('teams.vaultCatLogin')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-outline-variant/20 text-xs">
                {gewaehltesItem.username && (
                  <div>
                    <span className="text-on-surface-variant block mb-1">{t('mss.vault.benutzernameBezeichnung')}</span>
                    <div className="flex items-center justify-between p-2 rounded-xl bg-surface-container-high border border-outline-variant/30">
                      <span className="font-mono text-on-surface select-all">{gewaehltesItem.username}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          void navigator.clipboard.writeText(gewaehltesItem.username)
                          toast.success(t('mss.vault.kopiert'))
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {gewaehltesItem.password && (
                  <div>
                    <span className="text-on-surface-variant block mb-1">{t('mss.vault.passwort')}</span>
                    <div className="flex items-center justify-between p-2 rounded-xl bg-surface-container-high border border-outline-variant/30">
                      <span className="font-mono text-on-surface">••••••••••••</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          void navigator.clipboard.writeText(gewaehltesItem.password)
                          toast.success(t('mss.vault.kopiert'))
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {gewaehltesItem.url && (
                  <div>
                    <span className="text-on-surface-variant block mb-1">URL</span>
                    <a
                      href={gewaehltesItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline block truncate"
                    >
                      {gewaehltesItem.url}
                    </a>
                  </div>
                )}

                {gewaehltesItem.notes && (
                  <div>
                    <span className="text-on-surface-variant block mb-1">{t('mss.vault.notizBezeichnung')}</span>
                    <div className="p-2.5 rounded-xl bg-surface-container-high border border-outline-variant/30 whitespace-pre-wrap">
                      {gewaehltesItem.notes}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
                <Button variant="secondary" size="sm" onClick={() => handleOpenEdit(gewaehltesItem)}>
                  {t('common.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setGewaehltesItem(null)}>
                  {t('common.close')}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Anlegen / Bearbeiten Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md p-5 space-y-4">
          <h3 className="text-sm font-semibold text-on-surface">
            {editId ? t('mss.vault.eintragBearbeiten') : t('mss.vault.neuerEintrag')}
          </h3>
          <form onSubmit={handleSaveModal} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-on-surface">{t('teams.vaultCategory')}</label>
              <Dropdown options={kategorieOptionen} value={formKat} onChange={setFormKat} />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-on-surface">{t('teams.vaultItemName')}</label>
              <Input
                value={formService}
                onChange={(e) => setFormService(e.target.value)}
                placeholder="z. B. WLAN-Schlüssel, GitHub, Server"
                required
              />
            </div>

            {formKat === 'login' && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-on-surface">{t('mss.vault.benutzernameBezeichnung')}</label>
                  <Input
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="Benutzername oder E-Mail"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-on-surface">{t('mss.vault.passwort')}</label>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setFormPassword(generateSecurePassword(20, true))}
                    >
                      {t('teams.vaultGeneratePassword')}
                    </button>
                  </div>
                  <PasswordInput
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Passwort"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-on-surface">URL</label>
                  <Input
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="https://example.com"
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-on-surface">{t('mss.vault.notizBezeichnung')}</label>
              <Textarea
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optionale Notizen..."
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !formService.trim()}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rotations-Dialog (1:1 wie Einrichten) */}
      <Dialog open={rotationOpen} onOpenChange={setRotationOpen}>
        <DialogContent className="max-w-md p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10 text-warning">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-on-surface">{t('teams.vaultRotateBtn')}</h3>
              <p className="text-xs text-on-surface-variant">{t('teams.vaultRotationNotice')}</p>
            </div>
          </div>

          <form onSubmit={handleRotate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-on-surface">{t('mss.vault.masterPasswort')}</label>
              <PasswordInput
                value={rotPassword}
                onChange={(e) => handleRotPasswordChange(e.target.value)}
                placeholder={t('mss.vault.masterPasswort')}
                required
                disabled={rotBusy}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-on-surface">{t('teams.vaultRepeatPassword')}</label>
              <PasswordInput
                value={rotRepeat}
                onChange={(e) => setRotRepeat(e.target.value)}
                placeholder={t('teams.vaultRepeatPassword')}
                required
                disabled={rotBusy}
              />
            </div>

            {rotLeakCheck && rotLeakCheck.checked && (
              <div className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${rotLeakCheck.isLeaked ? 'bg-error/10 border-error/30 text-error' : 'bg-success/10 border-success/30 text-success'}`}>
                {rotLeakCheck.isLeaked ? <ShieldAlert className="h-4 w-4 shrink-0" /> : <ShieldCheck className="h-4 w-4 shrink-0" />}
                <span>{rotLeakCheck.isLeaked ? t('mss.vault.leckGefunden_other', { anzahl: rotLeakCheck.count }) : t('mss.vault.keinLeck')}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  const gen = generateSecurePassword(20, true)
                  setRotPassword(gen)
                  setRotRepeat(gen)
                  checkRotPasswordLeak(gen)
                }}
                disabled={rotBusy}
              >
                <Wand2 className="h-4 w-4 mr-1.5" />
                {t('teams.vaultGeneratePassword')}
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => setRotationOpen(false)} disabled={rotBusy}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={rotBusy || rotPassword.length < MASTER_PASSWORT_MINDESTLAENGE || rotPassword !== rotRepeat}>
                  {rotBusy ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
                  {t('teams.vaultRotateBtn')}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
