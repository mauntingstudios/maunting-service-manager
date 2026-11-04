import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { TeamVaultView } from './TeamVaultView'
import { useTeamVaultStore } from './teamVaultStore'
import { useVaultStore } from './vaultStore'
import type { TeamDetail } from '@/api/teams'

const mockTeam: TeamDetail = {
  id: 42,
  name: 'Familie Mueller',
  is_personal: false,
  owner_user_id: 1,
  is_owner: true,
  can_manage_skills: true,
  can_manage_memory: true,
  member_count: 2,
  created_at: '2026-10-31T00:00:00Z',
  members: [],
  servers: [],
  invitations: [],
}

describe('TeamVaultView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTeamVaultStore.setState({
      teamId: 42,
      bucketId: null,
      keyVersion: null,
      isInitialized: false,
      isUnlocked: false,
      needsRotation: false,
      needsSlot: false,
      isOwner: true,
      canAccessVault: true,
      items: [],
      loadStatus: vi.fn(),
      setup: vi.fn(),
      unlock: vi.fn(),
      rotateVault: vi.fn(),
      lock: vi.fn(),
      saveItem: vi.fn(),
      deleteItem: vi.fn(),
    })
    useVaultStore.setState({ isUnlocked: false, isDeviceAuthorized: true })
  })

  it('richtet den Team-Tresor beim Gründer automatisch ein, sobald die Karte steckt', async () => {
    const loadStatus = vi.fn().mockResolvedValue({ is_setup: false })
    const setup = vi.fn().mockResolvedValue(true)
    useTeamVaultStore.setState({
      isInitialized: false,
      isOwner: true,
      teamId: 42,
      isUnlocked: false,
      isUnlocking: false,
      error: null,
      loadStatus,
      setup,
    })
    useVaultStore.setState({ isUnlocked: true })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByRole('heading', { name: i18n.t('teams.vaultSetup') })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('teams.vaultSetupDesc'))).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(i18n.t('mss.vault.richteEin'))
    await waitFor(() => expect(setup).toHaveBeenCalledWith(42))
    // Keinen Einrichtungs-Knopf mehr: läuft von selbst.
    expect(screen.queryByRole('button', { name: new RegExp(i18n.t('teams.vaultSetup')) })).not.toBeInTheDocument()
  })

  it('zeigt das Karten-Formular, solange die Karte nicht steckt — ohne Setup-Knopf', () => {
    const setup = vi.fn()
    useTeamVaultStore.setState({ isInitialized: false, isOwner: true, error: null, setup })
    useVaultStore.setState({ isUnlocked: false })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByText(i18n.t('teams.vaultSetupBrauchtKarte'))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(i18n.t('mss.vault.masterPasswort'))).toBeInTheDocument()
    // Kein Team-Passwort mehr: kein Wiederholen-, kein Generator-Feld.
    expect(screen.queryByPlaceholderText(i18n.t('mss.vault.neuesMasterPasswort'))).not.toBeInTheDocument()
    expect(setup).not.toHaveBeenCalled()
  })

  it('bietet Wiederholen an, wenn das Auto-Setup fehlschlägt', async () => {
    const loadStatus = vi.fn().mockResolvedValue({ is_setup: false })
    const setup = vi.fn().mockResolvedValue(false)
    useTeamVaultStore.setState({
      isInitialized: false,
      isOwner: true,
      teamId: 42,
      isUnlocked: false,
      isUnlocking: false,
      error: null,
      loadStatus,
      setup,
    })
    useVaultStore.setState({ isUnlocked: true })

    render(<TeamVaultView team={mockTeam} />)

    // Erster Versuch läuft von selbst und scheitert (der echte Store setzt
    // den Fehler — hier von Hand, weil setup gemockt ist).
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    useTeamVaultStore.setState({ error: 'Netzwerk weg' })
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(i18n.t('common.retry')) }))
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(2))
  })

  it('zeigt Nicht-Eingerichtet-Hinweis für Nicht-Owner', () => {
    useTeamVaultStore.setState({ isInitialized: false, isOwner: false })

    render(<TeamVaultView team={{ ...mockTeam, is_owner: false }} />)

    expect(screen.getByText(i18n.t('teams.vaultNotSetup'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('teams.vaultNotSetupDesc'))).toBeInTheDocument()
  })

  it('zeigt den Entsperren-Dialog, wenn der Tresor eingerichtet aber gesperrt ist', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: false })
    useVaultStore.setState({ isDeviceAuthorized: true })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByText('Familie Mueller')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(i18n.t('mss.vault.entsperren')) })).toBeInTheDocument()
  })

  it('zeigt Geräte-Autorisierung statt Entsperren ohne freigeschaltetes Gerät', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: false })
    useVaultStore.setState({ isDeviceAuthorized: false })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByRole('button', { name: /Gerät autorisieren/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(i18n.t('mss.vault.entsperren')) })).not.toBeInTheDocument()
  })

  it('zeigt Warte-Hinweis ohne eigene Schlüsselhülle', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: false, needsSlot: true })
    useVaultStore.setState({ isDeviceAuthorized: true })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.getByText(i18n.t('teams.vaultWartetAufFreischaltung'))).toBeInTheDocument()
  })

  it('zeigt kein Rotations-Banner bei Rotations-Bedarf (Auto-Rotation läuft still)', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: true, needsRotation: true, isOwner: true, rotationState: null })

    render(<TeamVaultView team={mockTeam} />)

    expect(screen.queryByText(i18n.t('teams.vaultRotationTitle'))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(i18n.t('teams.vaultRotateBtn')) })).not.toBeInTheDocument()
  })

  it('öffnet den Rotations-Dialog weiter über unterbrochene Rotation', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: true, needsRotation: false, isOwner: true, rotationState: 'prepared' })

    render(<TeamVaultView team={mockTeam} />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('mss.vault.rotationFortsetzen')) }))
    expect(screen.getByText(i18n.t('teams.vaultRotationConfirmDesc'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(i18n.t('common.cancel')) })).toBeInTheDocument()
  })

  it('zeigt die Schranke (Zutritt verwehrt), wenn can_access_vault false ist', () => {
    useTeamVaultStore.setState({ isInitialized: true, isUnlocked: false, canAccessVault: false })

    render(<TeamVaultView team={{ ...mockTeam, can_access_vault: false }} />)

    expect(screen.getByRole('heading', { name: i18n.t('teams.vaultAccessDenied') })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('teams.vaultAccessDeniedDesc'))).toBeInTheDocument()
    // Sicherstellen, dass kein Entsperr-Button gerendert wird
    expect(screen.queryByRole('button', { name: new RegExp(i18n.t('mss.vault.entsperren')) })).not.toBeInTheDocument()
  })
})
