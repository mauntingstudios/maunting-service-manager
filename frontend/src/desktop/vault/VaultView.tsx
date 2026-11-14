import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock,
  CreditCard,
  KeyRound,
  Plus,
  SearchX,
  Star,
  Trash2,
} from 'lucide-react'
import type { TeamDetail } from '@/api/teams'
import { getE2eeGeraete } from '@/api/social'
import { useTeamVaultStore } from './teamVaultStore'
import {
  Button,
  Zustandsflaeche,
} from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { prompt } from '@/stores/promptStore'
import { useAuthStore } from '@/stores/authStore'
import { generateTotpCode, getTotpSecondsRemaining } from './totpEngine'
import { generateSecurePassword } from './vaultCrypto'
import { createDebouncedLeakChecker, type LeakCheckResult } from './leakChecker'
import { QrScannerModal } from './QrScannerModal'
import { TresorDateiBereich } from './TresorDateiBereich'
import { TresorGalerie } from './TresorGalerie'
import { TresorZahlung } from './TresorZahlung'
import { blobBasisSetzen } from './tresorBlobApi'
import { inhaltVon, pfadVon, zielOrdner } from './tresorOrdner'
import { still } from '@/lib/still'
import { begruessungSchluessel } from '@/lib/tageszeit'
import { setzeTresorSchutz } from '../tauri'
import { useShallow } from 'zustand/react/shallow'
import { useMedienabfrage } from '@/hooks/useMedienabfrage'
import { getLocalVaultSalt, useVaultStore } from './vaultStore'
import { PAPIERKORB_TAGE, istBekannteKategorie, type VaultItem } from './vaultEintrag'
import { fehlerText } from './tresorFehler'
import { TransferToTeamVaultModal } from './TransferToTeamVaultModal'
import type { VaultAnsicht } from './vaultAnsichten'
import {
  passtZumFilter,
  sichtbareEintraege,
  zaehleEintraege,
  type Sammlung,
  type StandardKategorieDef,
  type TresorFilter,
} from './vaultKennzahlen'
import { VaultDashboard, type SicherheitscheckStand } from './VaultDashboard'
import { VaultSidebar } from './VaultSidebar'
import { TresorUntereLeiste } from './TresorUntereLeiste'
import { PasswortGeneratorDialog } from './PasswortGeneratorDialog'
import { SicherheitscheckDialog } from './SicherheitscheckDialog'
import {
  TresorNotizDialog,
  TresorNotizKarte,
  umschaltenChecklistenEintrag,
  type TresorNotizDaten,
} from './TresorNotizDialog'
import { TresorKategorieBildDialog } from './TresorKategorieBildDialog'
import { TresorImportExportDialog, type ImportierterEintrag } from './TresorImportExportDialog'
import { VaultGateScreen } from './VaultGateScreen'
import { VaultItemRow, restTageImPapierkorb } from './VaultItemRow'
import { VaultHeaderBereich } from './VaultHeaderBereich'
import { VaultEntryModal } from './VaultEntryModal'
import { VaultHintModal, VaultTeamRotationModal } from './VaultExtraModals'

export { restTageImPapierkorb }

type Ansicht = VaultAnsicht

const STANDARD_BILDER_SPEICHER = 'msm-vault-kategorie-bilder-v1'
const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

export interface VaultViewProps {
  mode?: 'personal' | 'team'
  team?: TeamDetail
}

export function VaultView({ mode = 'personal', team }: VaultViewProps = {}) {
  const isTeam = mode === 'team'
  const { t } = useTranslation()
  const angemeldeterName = useAuthStore((s) => s.user?.username)
  const angemeldeteId = useAuthStore((s) => s.user?.id)

  const personalStore = useVaultStore(
    // Nur diese Felder: `lastActivityTime` ändert sich bei jeder Mausbewegung.
    useShallow((s) => ({
      isInitialized: s.isInitialized,
      isUnlocked: s.isUnlocked,
      isDeviceAuthorized: s.isDeviceAuthorized,
      isUnlocking: s.isUnlocking,
      unlockError: s.unlockError,
      isBiometricsEnabled: s.isBiometricsEnabled,
      isBiometricsSupported: s.isBiometricsSupported,
      items: s.items,
      searchQuery: s.searchQuery,
      syncStatus: s.syncStatus,
      zurueckgesetzt: s.zurueckgesetzt,
      initializeVault: s.initializeVault,
      unlock: s.unlock,
      unlockWithBiometrics: s.unlockWithBiometrics,
      lock: s.lock,
      setSearchQuery: s.setSearchQuery,
      saveItem: s.saveItem,
      aendern: s.aendern,
      ordnerAnlegen: s.ordnerAnlegen,
      dateiHinzufuegen: s.dateiHinzufuegen,
      trashItem: s.trashItem,
      restoreItem: s.restoreItem,
      setArchived: s.setArchived,
      deleteItem: s.deleteItem,
      emptyTrash: s.emptyTrash,
      toggleFavorite: s.toggleFavorite,
      markUsed: s.markUsed,
      syncWithServer: s.syncWithServer,
      saveHint: s.saveHint,
      requestHintEmail: s.requestHintEmail,
      checkBiometricsSupport: s.checkBiometricsSupport,
      fetchVaultSalt: s.fetchVaultSalt,
      checkHintStatus: s.checkHintStatus,
      hasHint: s.hasHint,
    })),
  )

  const teamStore = useTeamVaultStore(
    useShallow((s) => ({
      teamId: s.teamId,
      isInitialized: s.isInitialized,
      isUnlocked: s.isUnlocked,
      isOwner: s.isOwner,
      canAccessVault: s.canAccessVault,
      items: s.items,
      syncStatus: s.syncStatus,
      error: s.error,
      needsSlot: s.needsSlot,
      keyVersion: s.keyVersion,
      loadStatus: s.loadStatus,
      setup: s.setup,
      unlock: s.unlock,
      rotateVault: s.rotateVault,
      rotationState: s.rotationState,
      abortRotation: s.abortRotation,
      lock: s.lock,
      syncWithServer: s.syncWithServer,
      saveItem: s.saveItem,
      ordnerAnlegen: s.ordnerAnlegen,
      dateiHinzufuegen: s.dateiHinzufuegen,
      trashItem: s.trashItem,
      restoreItem: s.restoreItem,
      setArchived: s.setArchived,
      deleteItem: s.deleteItem,
      emptyTrash: s.emptyTrash,
      toggleFavorite: s.toggleFavorite,
      markUsed: s.markUsed,
    })),
  )

  // Status des Team-Tresors laden
  useEffect(() => {
    if (isTeam && team?.id) {
      void teamStore.loadStatus(team.id)
    }
  }, [isTeam, team?.id, teamStore.loadStatus])

  // Blob-Basis für Dateiuploads/-downloads anpassen (Team vs. Privat)
  useEffect(() => {
    if (isTeam && team?.id) {
      blobBasisSetzen(team.id)
    } else {
      blobBasisSetzen(null)
    }
    return () => {
      blobBasisSetzen(null)
    }
  }, [isTeam, team?.id])

  // Beim Laden Server-Status und Salt nur prüfen, falls lokal noch kein Salt vorliegt (Leck-2-Schutz)
  useEffect(() => {
    if (!isTeam) {
      if (!getLocalVaultSalt() && !personalStore.isUnlocked) {
        void personalStore.fetchVaultSalt()
      } else {
        void personalStore.checkHintStatus()
      }
    }
  }, [isTeam, personalStore.isUnlocked, personalStore.fetchVaultSalt, personalStore.checkHintStatus])

  // Biometrie-Verfügbarkeit (Windows Hello / Fingerabdruck) beim Laden abfragen.
  // Eine Anmeldung für beide Tresore: Der Team-Tresor nutzt die des privaten.
  useEffect(() => {
    void personalStore.checkBiometricsSupport()
  }, [personalStore.checkBiometricsSupport])

  // Kennzahl „Geräte“: freigegebene E2EE-Geräte des Kontos. Bleibt der Abruf
  // aus, zeigt die Übersicht „Nicht ermittelbar“ statt einer erfundenen Zahl.
  useEffect(() => {
    if (isTeam || !angemeldeteId) return
    let abgebrochen = false
    getE2eeGeraete(angemeldeteId, true)
      .then((liste) => {
        if (!abgebrochen) setGeraete(liste.filter((geraet) => geraet.is_approved !== false).length)
      })
      .catch(() => {
        if (!abgebrochen) setGeraete(null)
      })
    return () => {
      abgebrochen = true
    }
  }, [isTeam, angemeldeteId])

  // Hardware- und Software-Schutz vor Windows Computer-Use KI-Screenshots
  useEffect(() => {
    const unlocked = isTeam ? teamStore.isUnlocked : personalStore.isUnlocked
    void setzeTresorSchutz(unlocked)
    return () => {
      void setzeTresorSchutz(false)
    }
  }, [isTeam, teamStore.isUnlocked, personalStore.isUnlocked])

  const [teamBusy, setTeamBusy] = useState(false)
  const [teamSearchQuery, setTeamSearchQuery] = useState('')

  const isInitialized = isTeam ? teamStore.isInitialized : personalStore.isInitialized
  const isUnlocked = isTeam ? teamStore.isUnlocked : personalStore.isUnlocked
  const isUnlocking = isTeam ? teamBusy : personalStore.isUnlocking
  const unlockError = isTeam ? teamStore.error : personalStore.unlockError
  const items = isTeam ? teamStore.items : personalStore.items
  const searchQuery = isTeam ? teamSearchQuery : personalStore.searchQuery
  const setSearchQuery = isTeam ? setTeamSearchQuery : personalStore.setSearchQuery
  const syncStatus = isTeam ? teamStore.syncStatus : personalStore.syncStatus
  const isOwner = isTeam ? (teamStore.isOwner ?? team?.is_owner ?? false) : true
  const zurueckgesetzt = isTeam ? false : personalStore.zurueckgesetzt
  const isBiometricsEnabled = personalStore.isBiometricsEnabled
  const isBiometricsSupported = personalStore.isBiometricsSupported
  const isDeviceAuthorized = personalStore.isDeviceAuthorized

  // Team-Tresor angleichen: Schlüsselstand überholt (Rotation lief anderswo)?
  // Dann lautlos mit der neuen Hülle neu öffnen. Der Gründer rotiert bei
  // Rotations-Bedarf automatisch — einmal je Schlüsselstand, bei Fehlschlag
  // erneut beim nächsten Öffnen. Einen Hinweis gibt es nicht mehr.
  const autoRotiertFuer = useRef<string | null>(null)
  useEffect(() => {
    if (!isTeam || !team?.id || !isUnlocked) return
    const tid = team.id
    let abgebrochen = false
    const angleichen = async () => {
      const stand = useTeamVaultStore.getState()
      if (!stand.isUnlocked || stand.teamId !== tid || stand.isUnlocking) return
      const status = await stand.loadStatus(tid)
      if (abgebrochen || !status) return
      const neu = useTeamVaultStore.getState()
      if (!neu.isUnlocked || neu.teamId !== tid || neu.isUnlocking) return
      if (
        neu.keyVersion != null &&
        status.key_version != null &&
        status.key_version !== neu.keyVersion
      ) {
        await useTeamVaultStore.getState().unlock(tid)
        return
      }
      const marke = `${tid}:${status.key_version ?? '?'}`
      if (neu.needsRotation && neu.isOwner && autoRotiertFuer.current !== marke) {
        autoRotiertFuer.current = marke
        const ok = await useTeamVaultStore.getState().rotateVault(tid)
        if (abgebrochen) return
        if (ok) {
          toast.success(t('teams.vaultKeyRotated'))
        } else {
          // Freigeben, damit das nächste Öffnen es erneut versucht — sonst
          // bliebe der Bedarf ohne Banner für immer unerledigt liegen.
          autoRotiertFuer.current = null
          const fehler = useTeamVaultStore.getState().error
          if (fehler) toast.error(fehler)
        }
      }
    }
    void angleichen()
    window.addEventListener('focus', angleichen)
    return () => {
      abgebrochen = true
      window.removeEventListener('focus', angleichen)
    }
  }, [isTeam, team?.id, isUnlocked, t])

  // Team-Tresor: richtet sich beim Gründer von selbst ein — einen
  // Einrichtungs-Klick gibt es nicht mehr. Einzige Voraussetzung ist die
  // steckende Karte; der frische Status entscheidet, nie ein alter Stand.
  const [setupVersuch, setSetupVersuch] = useState(0)
  const autoSetupFuer = useRef<string | null>(null)
  useEffect(() => {
    if (!isTeam || !team?.id || !isOwner) return
    if (!personalStore.isUnlocked) return
    const marke = `${team.id}:${setupVersuch}`
    if (autoSetupFuer.current === marke) return
    autoSetupFuer.current = marke
    const tid = team.id
    let abgebrochen = false
    const starten = async () => {
      setTeamBusy(true)
      try {
        const status = await useTeamVaultStore.getState().loadStatus(tid)
        if (abgebrochen) return
        const stand = useTeamVaultStore.getState()
        if (stand.teamId !== tid || stand.isUnlocked || stand.isUnlocking) return
        if (!status || status.is_setup || !stand.isOwner) return
        const ok = await useTeamVaultStore.getState().setup(tid)
        if (abgebrochen) return
        if (ok) {
          toast.success(t('mss.vault.eingerichtet'))
        }
        // Fehlschlag: Die Ansicht zeigt den Fehler mit Wiederholen-Knopf.
      } finally {
        if (!abgebrochen) setTeamBusy(false)
      }
    }
    void starten()
    return () => {
      abgebrochen = true
    }
  }, [isTeam, team?.id, isOwner, personalStore.isUnlocked, setupVersuch, t])

  // Team-Rotation: ein Klick, kein Formular — der neue Schlüssel ist Zufall.
  const [rotationOpen, setRotationOpen] = useState(false)
  const [rotBusy, setRotBusy] = useState(false)

  const activeUnlock = async (pw: string) => {
    if (isTeam) {
      if (!team?.id) return false
      setTeamBusy(true)
      try {
        // Die Karten-PIN beweist die Karte: Erst der private Tresor auf, dann
        // öffnet die eigene Schlüsselhülle den Team-Tresor — ohne zweites Passwort.
        if (!personalStore.isUnlocked) {
          const okPersoenlich = await personalStore.unlock(pw)
          if (!okPersoenlich) return false
        }
        return await teamStore.unlock(team.id)
      } finally {
        setTeamBusy(false)
      }
    }
    return await personalStore.unlock(pw)
  }

  const activeLock = () => {
    if (isTeam) {
      teamStore.lock()
    } else {
      personalStore.lock()
    }
  }

  const activeSaveItem = isTeam ? teamStore.saveItem : personalStore.saveItem
  const activeTrashItem = isTeam ? teamStore.trashItem : personalStore.trashItem
  const activeRestoreItem = isTeam ? teamStore.restoreItem : personalStore.restoreItem
  const activeSetArchived = isTeam ? teamStore.setArchived : personalStore.setArchived
  const activeDeleteItem = isTeam ? teamStore.deleteItem : personalStore.deleteItem
  const activeEmptyTrash = isTeam ? teamStore.emptyTrash : personalStore.emptyTrash
  const activeToggleFavorite = isTeam ? teamStore.toggleFavorite : personalStore.toggleFavorite
  const activeMarkUsed = isTeam ? teamStore.markUsed : personalStore.markUsed
  const activeOrdnerAnlegen = isTeam ? teamStore.ordnerAnlegen : personalStore.ordnerAnlegen
  const activeDateiHinzufuegen = isTeam ? teamStore.dateiHinzufuegen : personalStore.dateiHinzufuegen

  const activeSyncWithServer = async () => {
    if (isTeam) {
      if (team?.id) await teamStore.syncWithServer(team.id)
    } else {
      await personalStore.syncWithServer()
    }
  }

  const handleTeamRotate = async () => {
    if (!team?.id || rotBusy) return
    setRotBusy(true)
    try {
      const ok = await teamStore.rotateVault(team.id)
      if (ok) {
        toast.success(t('teams.vaultKeyRotated'))
        setRotationOpen(false)
      } else {
        toast.error(teamStore.error || t('mss.vault.speichernFehlgeschlagen'))
      }
    } finally {
      setRotBusy(false)
    }
  }

  // Die Sperre beim Fensterwechsel meldet `DesktopApp` einmal für die ganze
  // App an (`useAutoSperre`). Hier stand bis 09/2026 dieselbe Anmeldung ein
  // zweites Mal — sie tat nichts, was die andere nicht auch tat, und wäre bei
  // der nächsten Änderung die Fassung gewesen, die jemand vergisst.

  const personalHasHint = useVaultStore((s) => s.hasHint)
  const personalCheckHintStatus = useVaultStore((s) => s.checkHintStatus)

  // Hinweise gibt es nur privat: Der Team-Tresor hat kein Passwort, also auch keins zu vergessen.
  const activeHasHint = personalHasHint
  const activeCheckHintStatus = async () => {
    return await personalCheckHintStatus()
  }

  const activeSaveHint = async (hintText: string) => {
    await personalStore.saveHint(hintText)
  }

  const [ansicht, setAnsicht] = useState<Ansicht>('uebersicht')
  const [filter, setFilter] = useState<TresorFilter>('alle')
  const [ordnerFilter, setOrdnerFilter] = useState<string | null>(null)
  const [generatorOffen, setGeneratorOffen] = useState(false)
  const [checkOffen, setCheckOffen] = useState(false)
  const [notizDialogOffen, setNotizDialogOffen] = useState(false)
  const [notizBearbeitet, setNotizBearbeitet] = useState<VaultItem | null>(null)
  const [notizBusy, setNotizBusy] = useState(false)
  const [importExportOffen, setImportExportOffen] = useState(false)
  const [kategorieBildZiel, setKategorieBildZiel] = useState<{
    typ: 'sammlung' | 'standard'
    id: string
    name: string
    aktuellesBild?: string
    standardSchluessel?: StandardKategorieDef['schluessel']
  } | null>(null)
  const [standardKategorieBilder, setStandardKategorieBilder] = useState<
    Partial<Record<StandardKategorieDef['schluessel'], string>>
  >(() => {
    try {
      const roh = localStorage.getItem(STANDARD_BILDER_SPEICHER)
      return roh ? (JSON.parse(roh) as Partial<Record<StandardKategorieDef['schluessel'], string>>) : {}
    } catch (err) {
      still(err, 'VaultView.standardKategorieBilder.laden')
      return {}
    }
  })
  const [checkStand, setCheckStand] = useState<SicherheitscheckStand>({
    laeuft: false,
    geprueft: 0,
    gesamt: 0,
    gefunden: 0,
    abgeschlossen: false,
  })
  const [geraete, setGeraete] = useState<number | null>(null)
  const [uploadBusy, setUploadBusy] = useState(0)
  const istSchmal = useMedienabfrage('(max-width: 767.98px)')
  const begruessungsZufall = useRef(Math.random() * 5)

  // Nachträglicher Hinweis-Modal & Banner
  const [isHintModalOpen, setIsHintModalOpen] = useState(false)
  const [editHintInput, setEditHintInput] = useState('')
  const [isSavingHint, setIsSavingHint] = useState(false)
  const [dismissedHintReminder, setDismissedHintReminder] = useState(false)

  // UI-Zustände für Sperre & Ersteinrichtung
  const [isSetupMode, setIsSetupMode] = useState(!isInitialized)

  useEffect(() => {
    if (isInitialized) {
      setIsSetupMode(false)
    }
  }, [isInitialized])
  const [isRequestingHint, setIsRequestingHint] = useState(false)

  // Feedback für kopierte Felder
  const [copiedIdField, setCopiedIdField] = useState<string | null>(null)
  const [revealedPasswordId, setRevealedPasswordId] = useState<string | null>(null)

  // Live TOTP Takt (Sekunden-Ticker für 2FA)
  const [totpRemaining, setTotpRemaining] = useState<number>(30)
  const [totpCodes, setTotpCodes] = useState<Record<string, string>>({})

  // Modal: Bearbeiten / Neu erstellen
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [modalService, setModalService] = useState('')
  const [modalUsername, setModalUsername] = useState('')
  const [modalPassword, setModalPassword] = useState('')
  const [modalUrl, setModalUrl] = useState('')
  const [modalNotes, setModalNotes] = useState('')
  const [modalTotpSecret, setModalTotpSecret] = useState('')
  const [modalOrdner, setModalOrdner] = useState('')
  const [showQrScanner, setShowQrScanner] = useState(false)
  // Stand beim Öffnen: Schließen per Tippen daneben oder Zurück fragt nur, wenn
  // seither etwas getippt wurde. Vorher war das Getippte dann kommentarlos weg.
  const [modalAnfang, setModalAnfang] = useState('')
  const modalStand = JSON.stringify([modalService, modalUsername, modalPassword, modalUrl, modalNotes, modalTotpSecret, modalOrdner])
  const [leakCheckResult, setLeakCheckResult] = useState<LeakCheckResult | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferItem, setTransferItem] = useState<VaultItem | null>(null)

  // TOTP-Ticker für alle Einträge mit 2FA-Secret
  useEffect(() => {
    if (!isUnlocked) return

    let isMounted = true
    const updateTotp = async () => {
      const remaining = getTotpSecondsRemaining(30)
      if (isMounted) setTotpRemaining(remaining)

      const newCodes: Record<string, string> = {}
      for (const item of items) {
        if (item.totpSecret) {
          try {
            const code = await generateTotpCode(item.totpSecret, 30)
            newCodes[item.id] = code
          } catch {
            newCodes[item.id] = 'FEHLER'
          }
        }
      }
      if (isMounted) setTotpCodes(newCodes)
    }

    void updateTotp()
    const interval = setInterval(() => void updateTotp(), 1000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [items, isUnlocked])

  // Kopieren mit sofortigem Feedback
  const handleCopy = async (text: string, fieldKey: string, itemId?: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdField(fieldKey)
      toast.success(t('mss.vault.kopiert'))
      setTimeout(() => setCopiedIdField(null), 1500)

      if (itemId) {
        void activeMarkUsed(itemId)
      }
    } catch {
      toast.error(t('mss.vault.kopierenFehlgeschlagen'))
    }
  }

  // Passwort kurz aufdecken
  const handleToggleRevealPassword = (itemId: string) => {
    if (revealedPasswordId === itemId) {
      setRevealedPasswordId(null)
    } else {
      setRevealedPasswordId(itemId)
      setTimeout(() => {
        setRevealedPasswordId((cur) => (cur === itemId ? null : cur))
      }, 5000)
    }
  }

  // Gedebounceter Leak-Check im Modal (mind. 400ms & >=6 Zeichen, SEC-10)
  const debouncedLeakCheck = useMemo(() => {
    return createDebouncedLeakChecker((res) => {
      setLeakCheckResult(res)
    }, 400)
  }, [])

  // Modal öffnen für neuen Eintrag
  const openNewEntryModal = (vorgabe?: string) => {
    setEditingItemId(null)
    setModalService('')
    setModalUsername('')
    const newPwd = vorgabe ?? generateSecurePassword(20, true)
    setModalPassword(newPwd)
    setModalUrl('')
    setModalNotes('')
    setModalTotpSecret('')
    setModalOrdner(ordnerFilter ?? '')
    setModalAnfang(JSON.stringify(['', '', newPwd, '', '', '', ordnerFilter ?? '']))
    setLeakCheckResult(null)
    setIsModalOpen(true)
    debouncedLeakCheck(newPwd)
  }

  // Modal öffnen für bestehenden Eintrag
  const openEditEntryModal = (item: VaultItem) => {
    setEditingItemId(item.id)
    setModalService(item.service)
    setModalUsername(item.username)
    setModalPassword(item.password)
    setModalUrl(item.url || '')
    setModalNotes(item.notes || '')
    setModalTotpSecret(item.totpSecret || '')
    setModalOrdner(item.ordner ?? '')
    setModalAnfang(
      JSON.stringify([item.service, item.username, item.password, item.url || '', item.notes || '', item.totpSecret || '', item.ordner ?? '']),
    )
    setLeakCheckResult(null)
    setIsModalOpen(true)
    if (item.password) {
      debouncedLeakCheck(item.password)
    }
  }

  const modalSchliessen = async () => {
    if (modalStand !== modalAnfang) {
      const verwerfen = await confirm({
        message: t('mss.vault.verwerfenFrage'),
        confirmText: t('mss.vault.verwerfen'),
        cancelText: t('mss.vault.weiterBearbeiten'),
        danger: true,
      })
      if (!verwerfen) return
    }
    setIsModalOpen(false)
  }

  const hinweisModalSchliessen = async () => {
    if (editHintInput.trim()) {
      const verwerfen = await confirm({
        message: t('mss.vault.verwerfenFrage'),
        confirmText: t('mss.vault.verwerfen'),
        cancelText: t('mss.vault.weiterBearbeiten'),
        danger: true,
      })
      if (!verwerfen) return
    }
    setIsHintModalOpen(false)
  }

  // Speichern im Modal
  const handleModalSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modalService.trim()) {
      toast.error(t('mss.vault.dienstnamePflicht'))
      return
    }

    try {
      await activeSaveItem({
        id: editingItemId || undefined,
        service: modalService.trim(),
        username: modalUsername.trim(),
        password: modalPassword,
        url: modalUrl.trim(),
        notes: modalNotes.trim(),
        totpSecret: modalTotpSecret.trim().toUpperCase(),
        ordner: modalOrdner || undefined,
      })
      setIsModalOpen(false)
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    }
  }

  // Löschen legt in den Papierkorb; das lässt sich zurücknehmen und fragt deshalb nicht.
  const handleTrashItem = async (item: VaultItem) => {
    try {
      await activeTrashItem(item.id)
      if (isModalOpen && editingItemId === item.id) {
        setIsModalOpen(false)
      }
      toast.success(t('mss.vault.inPapierkorbGelegt'), {
        label: t('common.undo'),
        ausfuehren: () => void handleRestoreItem(item),
      })
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.loeschenFehlgeschlagen')))
    }
  }

  const handleArchiv = async (item: VaultItem, archiviert: boolean) => {
    try {
      await activeSetArchived(item.id, archiviert)
      if (isModalOpen && editingItemId === item.id) {
        setIsModalOpen(false)
      }
      toast.success(t(archiviert ? 'mss.vault.archiviert' : 'mss.vault.ausArchivGeholt'), {
        label: t('common.undo'),
        ausfuehren: () => void handleArchiv(item, !archiviert),
      })
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    }
  }

  const handleRestoreItem = async (item: VaultItem) => {
    try {
      await activeRestoreItem(item.id)
      toast.success(t('mss.vault.wiederhergestellt'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    }
  }

  // Endgültig löschen gibt es nur im Papierkorb, und nur nach Rückfrage.
  const handleDeleteItem = async (item: VaultItem) => {
    const inhalt = item.category === 'ordner' ? inhaltVon(item.id, items).length : 0
    const ok = await confirm({
      title: t('mss.vault.loeschenTitel'),
      // Ein Ordner nimmt seinen Inhalt mit; das muss vor dem Klick dastehen.
      message: inhalt
        ? t('mss.vault.loeschenFrageOrdner', { name: item.service, count: inhalt })
        : t('mss.vault.loeschenFrage', { name: item.service }),
      confirmText: t('mss.vault.endgueltigLoeschen'),
      cancelText: t('common.cancel'),
      danger: true,
    })
    if (!ok) return
    try {
      await activeDeleteItem(item.id)
      toast.success(t('mss.vault.geloescht'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.loeschenFehlgeschlagen')))
    }
  }

  const handleEmptyTrash = async () => {
    const ok = await confirm({
      title: t('mss.vault.papierkorbLeeren'),
      message: t('mss.vault.papierkorbLeerenFrage'),
      confirmText: t('mss.vault.papierkorbLeeren'),
      cancelText: t('common.cancel'),
      danger: true,
    })
    if (!ok) return
    try {
      await activeEmptyTrash()
      toast.success(t('mss.vault.papierkorbGeleert'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.loeschenFehlgeschlagen')))
    }
  }

  const handleNeueSammlung = async () => {
    const name = await prompt({
      message: t('mss.vault.dashboard.sammlungName'),
      confirmText: t('mss.vault.dashboard.sammlungAnlegen'),
    })
    if (!name?.trim()) return
    try {
      const id = await activeOrdnerAnlegen(name.trim())
      toast.success(t('common.saved'))
      setAnsicht('tresor')
      setFilter('alle')
      setOrdnerFilter(id)
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    }
  }

  const handleSammlungUmbenennen = async (sammlung: Sammlung) => {
    const name = await prompt({
      message: t('mss.vault.dateien.neuerName'),
      defaultValue: sammlung.name,
      confirmText: t('mss.vault.dateien.umbenennen'),
    })
    if (!name?.trim() || name.trim() === sammlung.name) return
    try {
      if (isTeam) {
        const eintrag = teamStore.items.find((item) => item.id === sammlung.id)
        if (eintrag) await teamStore.saveItem({ ...eintrag, service: name.trim() })
      } else {
        await personalStore.aendern(sammlung.id, { service: name.trim() })
      }
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.dateien.umbenennenFehler')))
    }
  }

  const handleDateiHochladen = async (datei: File) => {
    setUploadBusy((zahl) => zahl + 1)
    try {
      await activeDateiHinzufuegen(datei)
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.dateien.hochladenFehler')))
    } finally {
      setUploadBusy((zahl) => Math.max(0, zahl - 1))
    }
  }

  const handleDashboardEintrag = (item: VaultItem) => {
    if (item.zahlung) {
      setAnsicht('zahlung')
      return
    }
    if (item.category === 'secure_note') {
      setNotizBearbeitet(item)
      setNotizDialogOffen(true)
      return
    }
    if (item.category === 'ordner' || item.datei || item.category === 'album') {
      setAnsicht(item.category === 'album' || item.datei?.typ.startsWith('image/') ? 'fotos' : 'dateien')
      return
    }
    openEditEntryModal(item)
  }

  const handleNotizSpeichern = async (daten: TresorNotizDaten) => {
    setNotizBusy(true)
    try {
      const bestehend = notizBearbeitet
      await activeSaveItem({
        ...(bestehend ? { id: bestehend.id } : {}),
        service: daten.titel,
        username: '',
        password: '',
        notes: daten.inhalt,
        category: 'secure_note',
        ordner: daten.ordner,
        isFavorite: daten.angepinnt,
        extra: {
          ...(bestehend?.extra ?? {}),
          noteCategory: daten.notizKategorie,
          color: daten.farbe,
        },
      })
      toast.success(t('common.saved'))
      setNotizDialogOffen(false)
      setNotizBearbeitet(null)
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    } finally {
      setNotizBusy(false)
    }
  }

  const handleNotizChecklisteUmschalten = async (item: VaultItem, itemIndex: number) => {
    const aktualisiert = umschaltenChecklistenEintrag(item.notes || '', itemIndex)
    try {
      if (isTeam) {
        await teamStore.saveItem({ ...item, notes: aktualisiert })
      } else {
        await personalStore.aendern(item.id, { notes: aktualisiert })
      }
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    }
  }

  const handleKategorieBildSpeichern = async (bildQuelle: string) => {
    if (!kategorieBildZiel) return
    if (kategorieBildZiel.typ === 'standard' && kategorieBildZiel.standardSchluessel) {
      const schluessel = kategorieBildZiel.standardSchluessel
      setStandardKategorieBilder((aktuell) => {
        const naechste = { ...aktuell, [schluessel]: bildQuelle }
        try {
          localStorage.setItem(STANDARD_BILDER_SPEICHER, JSON.stringify(naechste))
        } catch (err) {
          still(err, 'VaultView.standardKategorieBilder.speichern')
        }
        return naechste
      })
      toast.success(t('common.saved'))
      return
    }
    try {
      const ordnerEintrag = items.find((item) => item.id === kategorieBildZiel.id)
      if (!ordnerEintrag) return
      const neuesExtra = { ...(ordnerEintrag.extra ?? {}), titelbild: bildQuelle }
      if (isTeam) {
        await teamStore.saveItem({ ...ordnerEintrag, extra: neuesExtra })
      } else {
        await personalStore.aendern(ordnerEintrag.id, { extra: neuesExtra })
      }
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    }
  }

  const handleStandardKategorieBildZuruecksetzen = async () => {
    if (!kategorieBildZiel) return
    if (kategorieBildZiel.typ === 'standard' && kategorieBildZiel.standardSchluessel) {
      const schluessel = kategorieBildZiel.standardSchluessel
      setStandardKategorieBilder((aktuell) => {
        const naechste = { ...aktuell }
        delete naechste[schluessel]
        try {
          localStorage.setItem(STANDARD_BILDER_SPEICHER, JSON.stringify(naechste))
        } catch (err) {
          still(err, 'VaultView.standardKategorieBilder.zuruecksetzen')
        }
        return naechste
      })
      return
    }
    try {
      const ordnerEintrag = items.find((item) => item.id === kategorieBildZiel.id)
      if (!ordnerEintrag) return
      const neuesExtra = { ...(ordnerEintrag.extra ?? {}), titelbild: '' }
      if (isTeam) {
        await teamStore.saveItem({ ...ordnerEintrag, extra: neuesExtra })
      } else {
        await personalStore.aendern(ordnerEintrag.id, { extra: neuesExtra })
      }
      toast.success(t('common.saved'))
    } catch (err) {
      toast.error(fehlerText(err, t('mss.vault.speichernFehlgeschlagen')))
    }
  }

  const handleImportEintraege = async (eintraege: ImportierterEintrag[]) => {
    let importiert = 0
    for (const satz of eintraege) {
      await activeSaveItem({
        service: satz.service,
        username: satz.username,
        password: satz.password,
        url: satz.url,
        notes: satz.notes,
        category: satz.category ?? 'login',
      })
      importiert++
    }
    return importiert
  }

  const sidebarZaehler = useMemo(() => {
    const sichtbar = sichtbareEintraege(items)
    const archiviert = items.filter(
      (item) => istBekannteKategorie(item.category) && !item.trashedAt && Boolean(item.archivedAt),
    ).length
    return {
      passwoerter: sichtbar.filter((i) => (i.category ?? 'login') === 'login' || i.category === 'authenticator').length,
      karten: sichtbar.filter((i) => i.category === 'zahlung').length,
      dateien: sichtbar.filter((i) => i.category === 'datei' && !i.datei?.typ.startsWith('image/') && !i.datei?.typ.startsWith('video/')).length,
      notizen: sichtbar.filter((i) => i.category === 'secure_note').length,
      fotos: sichtbar.filter((i) => i.category === 'datei' && (i.datei?.typ.startsWith('image/') || i.datei?.typ.startsWith('video/'))).length,
      archiv: archiviert,
    }
  }, [items])

  const pruefKandidaten = useMemo(
    () => sichtbareEintraege(items).filter((item) => (item.category ?? 'login') === 'login' && item.password),
    [items],
  )

  // QR-Code Scan Ergebnis übernehmen
  const handleQrDetected = (payload: { secret: string; issuer?: string; account?: string }) => {
    setModalTotpSecret(payload.secret)
    if (payload.issuer && !modalService) {
      setModalService(payload.issuer)
    }
    if (payload.account && !modalUsername) {
      setModalUsername(payload.account)
    }
    toast.success(t('mss.vault.codeUebernommen'))
  }

  // Hinweis per E-Mail anfordern (max. 1x alle 10 Minuten) — nur privat.
  const handleRequestHint = async () => {
    if (isRequestingHint) return
    setIsRequestingHint(true)
    try {
      const res = await personalStore.requestHintEmail()
      if (res.ok) {
        toast.success(res.message)
      } else if (res.message) {
        toast.error(res.message)
      }
    } finally {
      setIsRequestingHint(false)
    }
  }

  const ordnerListe = useMemo(
    () => items.filter((item) => item.category === 'ordner' && !item.trashedAt && !item.archivedAt),
    [items],
  )

  // Einträge unbekannter Art (von einer neueren App) bleiben unsichtbar.
  const ansichtsItems = useMemo(() => {
    const bekannt = items.filter((item) => istBekannteKategorie(item.category))
    if (ansicht === 'papierkorb') {
      return bekannt.filter((item) => item.trashedAt).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0))
    }
    if (ansicht === 'archiv') {
      return bekannt
        .filter((item) => !item.trashedAt && item.archivedAt)
        .sort((a, b) => a.service.localeCompare(b.service))
    }
    const sichtbar = bekannt.filter((item) => !item.trashedAt && !item.archivedAt)
    const gefiltert = sichtbar.filter((item) => passtZumFilter(item, filter))
    if (ordnerFilter) {
      return gefiltert
        .filter((item) => item.id !== ordnerFilter && pfadVon(item.ordner, ordnerListe).some((ordner) => ordner.id === ordnerFilter))
        .sort((a, b) => a.service.localeCompare(b.service))
    }
    // In der Übersicht der Sammlungen liegen die Inhalte im Ordner; die Liste
    // zeigt die oberste Ebene, sonst stünde alles doppelt.
    return gefiltert.filter((item) => !item.ordner)
  }, [items, ansicht, filter, ordnerFilter, ordnerListe])

  const anzahlImPapierkorb = useMemo(
    () => items.filter((item) => item.trashedAt && istBekannteKategorie(item.category)).length,
    [items],
  )

  // Filterung nach Suchbegriff
  const searchedItems = useMemo(() => {
    if (!searchQuery.trim()) return ansichtsItems
    const q = searchQuery.toLowerCase()
    return ansichtsItems.filter(
      (item) =>
        item.service.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q) ||
        (item.url && item.url.toLowerCase().includes(q)) ||
        (item.notes && item.notes.toLowerCase().includes(q))
    )
  }, [ansichtsItems, searchQuery])

  // 1. Favoriten (nur in der Tresor-Ansicht; Archiv und Papierkorb sind schlichte Listen)
  const favoriteItems = useMemo(() => {
    if (ansicht !== 'tresor') return []
    return searchedItems.filter((item) => item.isFavorite)
  }, [searchedItems, ansicht])

  // 2. Zuletzt verwendet
  const recentItems = useMemo(() => {
    if (ansicht !== 'tresor') return []
    return searchedItems
      .filter((item) => !item.isFavorite && typeof item.lastUsedAt === 'number' && item.lastUsedAt > 0)
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      .slice(0, 5)
  }, [searchedItems, ansicht])

  // 3. Alle anderen Einträge
  const otherItems = useMemo(() => {
    if (ansicht !== 'tresor') return searchedItems
    const favoriteIds = new Set(favoriteItems.map((i) => i.id))
    const recentIds = new Set(recentItems.map((i) => i.id))
    return searchedItems
      .filter((item) => !favoriteIds.has(item.id) && !recentIds.has(item.id))
      .sort((a, b) => a.service.localeCompare(b.service))
  }, [searchedItems, favoriteItems, recentItems, ansicht])

  const ansichtsTitel =
    ansicht === 'uebersicht'
      ? t('mss.vault.dashboard.uebersicht')
      : ansicht === 'tresor'
        ? t('mss.vault.ansicht.tresor')
        : ansicht === 'fotos'
          ? t('mss.vault.ansicht.fotos')
          : ansicht === 'dateien'
            ? t('mss.vault.ansicht.dateien')
            : ansicht === 'zahlung'
              ? t('mss.vault.ansicht.zahlung')
              : ansicht === 'archiv'
                ? t('mss.vault.ansicht.archiv')
                : t('mss.vault.ansicht.papierkorb')

  const begruessung = angemeldeterName
    ? t(begruessungSchluessel(new Date().getHours(), istSchmal, begruessungsZufall.current), { name: angemeldeterName })
    : t('common.begruessung.ohneName')

  const ordnerFilterName = ordnerFilter ? items.find((item) => item.id === ordnerFilter)?.service : undefined
  const ordnerOptionen = [
    { value: '', label: t('mss.vault.dateien.obersteEbene') },
    ...zielOrdner([], ordnerListe),
  ]

  const filterLabels: Record<TresorFilter, string> = {
    alle: t('mss.vault.dashboard.filterAlle'),
    passwoerter: t('mss.vault.dashboard.filterPasswoerter'),
    notizen: t('mss.vault.dashboard.filterNotizen'),
    karten: t('mss.vault.dashboard.filterKarten'),
    dateien: t('mss.vault.dashboard.filterDateien'),
  }

  const hasVaultAccess = !isTeam || (team?.can_access_vault !== false && teamStore.canAccessVault !== false)
  if ((isTeam && !hasVaultAccess) || (isTeam && !isInitialized) || !isUnlocked) {
    return (
      <VaultGateScreen
        isTeam={isTeam}
        team={team}
        hasVaultAccess={hasVaultAccess}
        isInitialized={isInitialized}
        isOwner={isOwner}
        isUnlocked={isUnlocked}
        isUnlocking={isUnlocking}
        isSetupMode={isSetupMode}
        onSetupModeChange={setIsSetupMode}
        unlockError={unlockError}
        teamBusy={teamBusy}
        onTeamBusyChange={setTeamBusy}
        personalUnlocked={personalStore.isUnlocked}
        personalUnlock={personalStore.unlock}
        personalUnlockError={personalStore.unlockError}
        personalInitializeVault={personalStore.initializeVault}
        personalSaveHint={personalStore.saveHint}
        personalUnlockWithBiometrics={personalStore.unlockWithBiometrics}
        teamUnlock={teamStore.unlock}
        teamLoadStatus={teamStore.loadStatus}
        teamNeedsSlot={teamStore.needsSlot}
        isBiometricsEnabled={isBiometricsEnabled}
        isBiometricsSupported={isBiometricsSupported}
        isDeviceAuthorized={isDeviceAuthorized}
        activeUnlock={activeUnlock}
        activeHasHint={activeHasHint}
        isRequestingHint={isRequestingHint}
        onRequestHint={handleRequestHint}
        onSetupRetry={() => setSetupVersuch((v) => v + 1)}
      />
    )
  }

  // ── HILFSKOMPONENTE: ZEILE IN LISTE / TABELLE ──
  const renderItemRow = (item: VaultItem) => (
    <VaultItemRow
      key={item.id}
      item={item}
      ansicht={ansicht}
      isRevealed={revealedPasswordId === item.id}
      totpCode={totpCodes[item.id]}
      totpRemaining={totpRemaining}
      copiedIdField={copiedIdField}
      onCopy={handleCopy}
      onToggleRevealPassword={handleToggleRevealPassword}
      onRestore={handleRestoreItem}
      onDelete={handleDeleteItem}
      onArchive={handleArchiv}
      onToggleFavorite={activeToggleFavorite}
      onEdit={(target) => {
        if (target.category === 'secure_note') {
          setNotizBearbeitet(target)
          setNotizDialogOffen(true)
        } else {
          openEditEntryModal(target)
        }
      }}
    />
  )

  // ── 3. HAUPTANSICHT ──
  return (
    <div className="flex flex-col md:flex-row h-full min-h-0 text-on-surface overflow-hidden">
      <VaultSidebar
        ansicht={ansicht}
        onAnsicht={(naechste) => {
          setAnsicht(naechste)
          if (naechste === 'tresor') setFilter('alle')
          if (naechste !== 'tresor') setOrdnerFilter(null)
        }}
        anzahlImPapierkorb={anzahlImPapierkorb}
        anzahlEintraege={zaehleEintraege(items)}
        syncStatus={syncStatus}
        onSperren={activeLock}
        tresorName={isTeam && team?.name ? team.name : 'MSM'}
        notizenAktiv={ansicht === 'tresor' && filter === 'notizen'}
        zaehler={sidebarZaehler}
        onNotizen={() => {
          setAnsicht('tresor')
          setFilter('notizen')
          setOrdnerFilter(null)
        }}
        onPasswortGenerieren={() => setGeneratorOffen(true)}
        onSicherheitscheck={() => {
          setCheckStand((stand) => ({ ...stand, laeuft: true }))
          setCheckOffen(true)
        }}
        onImportExport={() => setImportExportOffen(true)}
        onHinweisVerwalten={
          !isTeam
            ? () => {
                setEditHintInput('')
                setIsHintModalOpen(true)
                void activeCheckHintStatus()
              }
            : undefined
        }
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <VaultHeaderBereich
        ansichtsTitel={ansichtsTitel}
        isTeam={isTeam}
        teamName={team?.name}
        ansicht={ansicht}
        filter={filter}
        onFilterChange={setFilter}
        filterLabels={filterLabels}
        ordnerFilter={ordnerFilter}
        ordnerFilterName={ordnerFilterName}
        onClearOrdnerFilter={() => setOrdnerFilter(null)}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onNewEntry={() => {
          if (ansicht === 'tresor' && filter === 'notizen') {
            setNotizBearbeitet(null)
            setNotizDialogOffen(true)
          } else {
            openNewEntryModal()
          }
        }}
        syncStatus={syncStatus}
        onSyncWithServer={activeSyncWithServer}
        showRotationPreparedBanner={isTeam && teamStore.rotationState === 'prepared'}
        isOwner={isOwner}
        onOpenRotation={() => setRotationOpen(true)}
        onAbortRotation={() => {
          if (team?.id) void teamStore.abortRotation(team.id)
        }}
        zurueckgesetzt={zurueckgesetzt}
        activeHasHint={activeHasHint}
        dismissedHintReminder={dismissedHintReminder}
        onDismissHintReminder={() => setDismissedHintReminder(true)}
        editHintInput={editHintInput}
        onEditHintInputChange={setEditHintInput}
        isSavingHint={isSavingHint}
        onSavingHintChange={setIsSavingHint}
        onSaveHint={activeSaveHint}
        onClearEditHintInput={() => setEditHintInput('')}
      />

      {/* ÜBERSICHT / LISTE */}
      {ansicht === 'uebersicht' ? (
        <VaultDashboard
          items={items}
          begruessung={begruessung}
          isTeam={isTeam}
          syncStatus={syncStatus}
          geraete={isTeam ? (team?.members?.length ?? null) : geraete}
          sicherheitscheck={{ ...checkStand, laeuft: checkOffen && checkStand.laeuft }}
          onNeuerEintrag={() => openNewEntryModal()}
          onPasswortGenerieren={() => setGeneratorOffen(true)}
          onDateiHochladen={(datei) => void handleDateiHochladen(datei)}
          onSichereNotiz={() => {
            setNotizBearbeitet(null)
            setNotizDialogOffen(true)
          }}
          onSicherheitscheck={() => {
            setCheckStand((stand) => ({ ...stand, laeuft: true }))
            setCheckOffen(true)
          }}
          onSammlung={(id) => {
            setAnsicht('tresor')
            setFilter('alle')
            setOrdnerFilter(id)
          }}
          onSammlungUmbenennen={(sammlung) => void handleSammlungUmbenennen(sammlung)}
          onSammlungBildAendern={(sammlung) =>
            setKategorieBildZiel({
              typ: 'sammlung',
              id: sammlung.id,
              name: sammlung.name,
              aktuellesBild: sammlung.titelbild,
            })
          }
          onStandardKategorieBildAendern={(schluessel, name, aktuellesBild) =>
            setKategorieBildZiel({
              typ: 'standard',
              id: `std-${schluessel}`,
              name,
              aktuellesBild,
              standardSchluessel: schluessel,
            })
          }
          standardKategorieBilder={standardKategorieBilder}
          onNeueSammlung={() => void handleNeueSammlung()}
          onAlleEintraege={() => {
            setAnsicht('tresor')
            setFilter('alle')
            setOrdnerFilter(null)
          }}
          onFilterAnsicht={(zielFilter) => {
            setAnsicht('tresor')
            setFilter(zielFilter)
            setOrdnerFilter(null)
          }}
          onEintrag={handleDashboardEintrag}
          suchbegriff={searchQuery}
          onSucheAendern={setSearchQuery}
          dateiBusy={uploadBusy > 0}
        />
      ) : ansicht === 'fotos' ? (
        <TresorGalerie suche={searchQuery} isTeam={isTeam} />
      ) : ansicht === 'dateien' ? (
        <TresorDateiBereich suche={searchQuery} isTeam={isTeam} />
      ) : ansicht === 'zahlung' ? (
        isTeam ? (
          <Zustandsflaeche art="leer" icon={<CreditCard className="h-10 w-10" />} text={t('teams.vaultNoPaymentsYet', { defaultValue: 'Noch keine Zahlungsmethoden im Team-Tresor.' })} />
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <TresorZahlung suche={searchQuery} />
          </div>
        )
      ) : (
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {ansicht === 'papierkorb' && ansichtsItems.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-container-low border border-outline-variant/20 px-3 py-2">
            <span className="text-label-sm text-on-surface-variant">
              {t('mss.vault.papierkorbHinweis', { tage: PAPIERKORB_TAGE })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleEmptyTrash()}
              className="text-xs px-2 py-1 text-status-destructive hover:bg-status-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t('mss.vault.papierkorbLeeren')}
            </Button>
          </div>
        )}
        {ansicht === 'archiv' && ansichtsItems.length > 0 && (
          <p className="text-label-sm text-on-surface-variant">{t('mss.vault.archivHinweis')}</p>
        )}
        {ansicht !== 'tresor' && ansichtsItems.length === 0 ? (
          <Zustandsflaeche art="leer" text={t(ansicht === 'archiv' ? 'mss.vault.archivLeer' : 'mss.vault.papierkorbLeer')} />
        ) : ansichtsItems.length === 0 && (filter !== 'alle' || ordnerFilter) ? (
          <Zustandsflaeche art="leer" ansagen icon={<SearchX className="h-10 w-10" />} text={t('mss.vault.keineTreffer')}>
            <Button
              size="sm"
              variant="secondary"
              className="max-sm:min-h-11"
              onClick={() => {
                setFilter('alle')
                setOrdnerFilter(null)
              }}
            >
              {t('mss.vault.dashboard.filterAlle')}
            </Button>
          </Zustandsflaeche>
        ) : ansichtsItems.length === 0 ? (
          <Zustandsflaeche art="leer" icon={<KeyRound className="h-10 w-10" />} titel={t('mss.vault.leer')}>
            <Button size="sm" className="max-sm:min-h-11" onClick={() => openNewEntryModal()}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('mss.vault.passwortAnlegen')}
            </Button>
          </Zustandsflaeche>
        ) : searchedItems.length === 0 ? (
          <Zustandsflaeche art="leer" ansagen icon={<SearchX className="h-10 w-10" />} text={t('mss.vault.keineTreffer')} />
        ) : ansicht === 'tresor' && filter === 'notizen' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {[...favoriteItems, ...recentItems, ...otherItems].map((notizItem) => (
              <TresorNotizKarte
                key={notizItem.id}
                item={notizItem}
                onBearbeiten={(item) => {
                  setNotizBearbeitet(item)
                  setNotizDialogOffen(true)
                }}
                onPinUmschalten={(item) => void activeToggleFavorite(item.id)}
                onArchivUmschalten={(item) => void handleArchiv(item, !item.archivedAt)}
                onPapierkorb={(item) => void handleTrashItem(item)}
                onChecklisteUmschalten={(item, itemIndex) => void handleNotizChecklisteUmschalten(item, itemIndex)}
              />
            ))}
          </div>
        ) : (
          <>
            {/* FAVORITEN */}
            {favoriteItems.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-label-sm font-semibold text-status-warning">
                  <Star className="h-3 w-3 fill-current" />
                  <span>{t('mss.vault.favoriten')}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {favoriteItems.map(renderItemRow)}
                </div>
              </div>
            )}

            {/* ZULETZT VERWENDET */}
            {recentItems.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-label-sm font-semibold text-primary">
                  <Clock className="h-3 w-3" />
                  <span>{t('mss.vault.zuletztVerwendet')}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {recentItems.map(renderItemRow)}
                </div>
              </div>
            )}

            {/* ALLE ZUGÄNGE */}
            {otherItems.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-label-sm font-semibold text-on-surface-variant">
                  {t('common.all')}
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {otherItems.map(renderItemRow)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {istSchmal && (
        <TresorUntereLeiste
          ansicht={ansicht}
          onAnsicht={(naechste) => {
            setAnsicht(naechste)
            if (naechste === 'tresor') setFilter('alle')
            if (naechste !== 'tresor') setOrdnerFilter(null)
          }}
          onNeuerEintrag={() => {
            if (ansicht === 'tresor' && filter === 'notizen') {
              setNotizBearbeitet(null)
              setNotizDialogOffen(true)
            } else {
              openNewEntryModal()
            }
          }}
          anzahlImPapierkorb={anzahlImPapierkorb}
          notizenAktiv={ansicht === 'tresor' && filter === 'notizen'}
          onNotizen={() => {
            setAnsicht('tresor')
            setFilter('notizen')
            setOrdnerFilter(null)
          }}
          onWallet={
            !isTeam && isAndroid && isDeviceAuthorized
              ? () => window.dispatchEvent(new Event('msm:open-wallet'))
              : undefined
          }
          onPasswortGenerieren={() => setGeneratorOffen(true)}
          onSicherheitscheck={() => {
            setCheckStand((stand) => ({ ...stand, laeuft: true }))
            setCheckOffen(true)
          }}
          onImportExport={() => setImportExportOffen(true)}
          onHinweisVerwalten={
            !isTeam
              ? () => {
                  setEditHintInput('')
                  setIsHintModalOpen(true)
                  void activeCheckHintStatus()
                }
              : undefined
          }
          onSperren={activeLock}
        />
      )}

      {/* ── 4. DIALOG: PASSWORT ANLEGEN / BEARBEITEN ── */}
      <VaultEntryModal
        isOpen={isModalOpen}
        onClose={modalSchliessen}
        editingItem={editingItemId ? items.find((i) => i.id === editingItemId) : undefined}
        isTeam={isTeam}
        modalService={modalService}
        onServiceChange={setModalService}
        modalUsername={modalUsername}
        onUsernameChange={setModalUsername}
        modalPassword={modalPassword}
        onPasswordChange={setModalPassword}
        modalUrl={modalUrl}
        modalTotpSecret={modalTotpSecret}
        onTotpSecretChange={setModalTotpSecret}
        modalOrdner={modalOrdner}
        onOrdnerChange={setModalOrdner}
        ordnerOptionen={ordnerOptionen}
        modalNotes={modalNotes}
        onNotesChange={setModalNotes}
        leakCheckResult={leakCheckResult}
        onLeakCheck={debouncedLeakCheck}
        onOpenQrScanner={() => setShowQrScanner(true)}
        onSubmit={handleModalSave}
        onTrashItem={handleTrashItem}
        onArchiveItem={handleArchiv}
        onTransferItem={(item) => {
          setTransferItem(item)
          setTransferOpen(true)
        }}
      />

      {/* QR-Code Scanner */}
      <QrScannerModal
        isOpen={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onDetected={handleQrDetected}
      />

      {/* Dialog: Passwort-Hinweis verwalten */}
      <VaultHintModal
        isOpen={isHintModalOpen}
        onClose={hinweisModalSchliessen}
        activeHasHint={activeHasHint}
        editHintInput={editHintInput}
        onEditHintInputChange={setEditHintInput}
        isSavingHint={isSavingHint}
        onSavingHintChange={setIsSavingHint}
        isRequestingHint={isRequestingHint}
        onRequestHint={handleRequestHint}
        onSaveHint={activeSaveHint}
        onSavedSuccess={() => {
          setEditHintInput('')
          setIsHintModalOpen(false)
        }}
      />

      {/* Dialog: Team-Master-Passwort rotieren */}
      {isTeam && (
        <VaultTeamRotationModal
          isOpen={rotationOpen}
          onOpenChange={setRotationOpen}
          rotBusy={rotBusy}
          onRotate={handleTeamRotate}
        />
      )}

      {/* In Team-Tresor übertragen Modal */}
      {!isTeam && transferOpen && (
        <TransferToTeamVaultModal
          open={transferOpen}
          onOpenChange={setTransferOpen}
          item={transferItem}
        />
      )}

      <PasswortGeneratorDialog
        offen={generatorOffen}
        onSchliessen={() => setGeneratorOffen(false)}
        onVerwenden={(passwort) => {
          openNewEntryModal(passwort)
          setGeneratorOffen(false)
        }}
      />

      <SicherheitscheckDialog
        offen={checkOffen}
        eintraege={pruefKandidaten}
        onSchliessen={() => {
          setCheckOffen(false)
          setCheckStand((stand) => ({ ...stand, laeuft: false }))
        }}
        onFertig={(ergebnis) =>
          setCheckStand({
            laeuft: false,
            geprueft: ergebnis.geprueft,
            gesamt: pruefKandidaten.length,
            gefunden: ergebnis.gefunden,
            abgeschlossen: true,
          })
        }
      />

      <TresorNotizDialog
        offen={notizDialogOffen}
        initialNotiz={notizBearbeitet}
        ordnerOptionen={ordnerOptionen}
        standardOrdner={ordnerFilter ?? ''}
        busy={notizBusy}
        onSchliessen={() => {
          setNotizDialogOffen(false)
          setNotizBearbeitet(null)
        }}
        onSpeichern={handleNotizSpeichern}
      />

      <TresorKategorieBildDialog
        offen={kategorieBildZiel !== null}
        kategorieName={kategorieBildZiel?.name ?? ''}
        aktuellesBild={kategorieBildZiel?.aktuellesBild}
        onSchliessen={() => setKategorieBildZiel(null)}
        onBildWaehlen={(bildQuelle) => void handleKategorieBildSpeichern(bildQuelle)}
        onStandardWiederherstellen={
          kategorieBildZiel?.typ === 'standard' || Boolean(kategorieBildZiel?.aktuellesBild)
            ? () => void handleStandardKategorieBildZuruecksetzen()
            : undefined
        }
      />

      <TresorImportExportDialog
        offen={importExportOffen}
        items={items}
        onSchliessen={() => setImportExportOffen(false)}
        onImportieren={handleImportEintraege}
        onErfolgMeldung={(text) => toast.success(text)}
        onFehlerMeldung={(text) => toast.error(text)}
      />
      </div>
    </div>
  )
}
