import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  credentialsApi,
  type ServerCredentialStatus,
  type UserCredential,
} from '@/api/credentials'
import i18n from '@/i18n'
import { ServerCredentialsPanel } from './ServerCredentialsPanel'

vi.mock('@/api/credentials', () => ({
  credentialsApi: {
    listMine: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    listForServer: vi.fn(),
    bind: vi.fn(),
    readPolicy: vi.fn(),
    updatePolicy: vi.fn(),
  },
}))

const githubMissing: ServerCredentialStatus = {
  kind: 'github_token',
  required: true,
  source: 'none',
  configured: false,
  credential_id: null,
  label: null,
  username: null,
  hint: null,
}

const steamMissing: ServerCredentialStatus = {
  kind: 'steam_account',
  required: true,
  source: 'none',
  configured: false,
  credential_id: null,
  label: null,
  username: null,
  hint: null,
}

const ownGithubToken: UserCredential = {
  id: 7,
  kind: 'github_token',
  label: 'Privat-PAT',
  username: null,
  secret_hint: '...9a8b',
  updated_at: '2026-11-10T10:00:00Z',
}

describe('ServerCredentialsPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    vi.mocked(credentialsApi.listForServer).mockReset()
    vi.mocked(credentialsApi.listMine).mockReset().mockResolvedValue([])
    vi.mocked(credentialsApi.bind).mockReset()
  })

  it('nennt bei GitHub-Servern keinen panelweiten Zugang und verweist auf Profil → Verbindungen', async () => {
    vi.mocked(credentialsApi.listForServer).mockResolvedValue([githubMissing])

    render(<ServerCredentialsPanel serverId={42} canManage />)

    expect(await screen.findByText('GitHub-Token')).toBeInTheDocument()
    expect(screen.queryByText(/panelweiten Zugang/i)).not.toBeInTheDocument()
    expect(
      screen.getByText(/Kein GitHub-Token zugeordnet.*Profil → Verbindungen/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Zuordnung' }),
    ).toHaveTextContent('Kein Token (nur öffentliche Repositories)')
    expect(
      screen.getByText(/noch keine eigenen Zugangsdaten unter Profil → Verbindungen hinterlegt/i),
    ).toBeInTheDocument()
  })

  it('erlaubt das Zuweisen eines im Konto hinterlegten GitHub-Tokens', async () => {
    const boundGithub: ServerCredentialStatus = {
      ...githubMissing,
      source: 'server',
      configured: true,
      credential_id: ownGithubToken.id,
      label: ownGithubToken.label,
      hint: ownGithubToken.secret_hint,
    }
    vi.mocked(credentialsApi.listForServer).mockResolvedValue([githubMissing])
    vi.mocked(credentialsApi.listMine).mockResolvedValue([ownGithubToken])
    vi.mocked(credentialsApi.bind).mockResolvedValue([boundGithub])

    render(<ServerCredentialsPanel serverId={42} canManage />)

    const dropdown = await screen.findByRole('button', { name: 'Zuordnung' })
    fireEvent.click(dropdown)
    fireEvent.click(screen.getByRole('option', { name: 'Privat-PAT' }))

    await waitFor(() =>
      expect(credentialsApi.bind).toHaveBeenCalledWith(42, 'github_token', 7),
    )
    expect(await screen.findByText(/Privat-PAT · \.\.\.9a8b/)).toBeInTheDocument()
    expect(screen.queryByText(/Kein GitHub-Token zugeordnet/)).not.toBeInTheDocument()
  })

  it('zeigt bei Steam-Servern weiterhin die Option für den panelweiten Zugang', async () => {
    vi.mocked(credentialsApi.listForServer).mockResolvedValue([steamMissing])

    render(<ServerCredentialsPanel serverId={43} canManage />)

    expect(await screen.findByText('Steam-Konto')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Zuordnung' }),
    ).toHaveTextContent('Panelweiten Zugang verwenden')
    expect(
      screen.getByText(/Es ist kein Zugang verfügbar\. Installation und Updates schlagen fehl/i),
    ).toBeInTheDocument()
  })
})
