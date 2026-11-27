import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@/i18n'
import i18n from '@/i18n'
import { VaultItemRow } from './VaultItemRow'
import type { VaultItem } from './vaultEintrag'

const eintrag: VaultItem = {
  id: 'login-1',
  service: 'GitLab',
  username: 'dev@example.com',
  password: 'SecretPassword!99',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  category: 'login',
  createdAt: 1,
  updatedAt: 2,
  revision: 1,
}

describe('VaultItemRow (Phase 4)', () => {
  it('zeigt im mobilen Aktionsblatt Detail-Aktionen für Passwort, Benutzername und Bearbeiten', () => {
    const onCopy = vi.fn()
    const onToggleRevealPassword = vi.fn()
    const onEdit = vi.fn()

    render(
      <VaultItemRow
        item={eintrag}
        ansicht="tresor"
        isRevealed={false}
        totpCode="123456"
        totpRemaining={18}
        copiedIdField={null}
        onCopy={onCopy}
        onToggleRevealPassword={onToggleRevealPassword}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        onArchive={vi.fn()}
        onToggleFavorite={vi.fn()}
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.vault.dashboard.mehr') }))
    const blatt = screen.getByRole('dialog', { name: 'GitLab' })
    fireEvent.click(within(blatt).getByRole('button', { name: new RegExp(i18n.t('common.showPassword')) }))
    expect(onToggleRevealPassword).toHaveBeenCalledWith('login-1')

    fireEvent.click(within(blatt).getByRole('button', { name: new RegExp(i18n.t('mss.vault.benutzernameKopieren')) }))
    expect(onCopy).toHaveBeenCalledWith('dev@example.com', 'user-login-1', 'login-1')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.vault.dashboard.mehr') }))
    const blatt2 = screen.getByRole('dialog', { name: 'GitLab' })
    fireEvent.click(within(blatt2).getByRole('button', { name: new RegExp(i18n.t('mss.vault.eintragBearbeiten', { name: 'GitLab' })) }))
    expect(onEdit).toHaveBeenCalledWith(eintrag)
  })
})
