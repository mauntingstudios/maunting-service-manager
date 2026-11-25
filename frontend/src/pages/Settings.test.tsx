import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings } from './Settings'
import * as client from '@/api/client'
import i18n from '@/i18n'
import { useDashboardPreferencesStore } from '@/stores/dashboardPreferencesStore'
import { useToastStore } from '@/stores/toastStore'

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/hooks/useHasPermission', () => ({ useHasPermission: () => true }))

function renderSettings(initialEntry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Settings />
    </MemoryRouter>,
  )
}

describe('Settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useDashboardPreferencesStore.getState().resetForTests()
    useToastStore.setState({ toasts: [] })
    vi.mocked(client.api).mockReset()
  })

  it('ordnet die gebündelten Abschnitte in Grundlagen, Sicherheit, Verbindungen und Speicher & Daten', async () => {
    vi.mocked(client.api).mockResolvedValue({} as never)
    renderSettings()

    const reihenfolge = [
      'general',
      'imprint',
      'announcements',
      'security',
      'oauth',
      'gameIntegrations',
      'shopAndHoster',
      'communication',
      'aiAndSearch',
      'storage',
    ]
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      reihenfolge.map((id) => i18n.t(`settings.tabs.${id}`)),
    )
  })

  it('wechselt zwischen gebündelten Sub-Tabs für Sicherheit, Spiele-APIs und Kommunikation', async () => {
    vi.mocked(client.api).mockResolvedValue({} as never)
    renderSettings()

    fireEvent.click(await screen.findByRole('tab', { name: i18n.t('settings.tabs.security') }))
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.captcha') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.cloudflare') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.tabs.captcha') }))
    expect(
      screen.getByRole('tab', { name: i18n.t('settings.tabs.captcha') }),
    ).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.tabs.cloudflare') }))
    expect(
      screen.getByRole('tab', { name: i18n.t('settings.tabs.cloudflare') }),
    ).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(
      screen.getByRole('tab', { name: i18n.t('settings.tabs.gameIntegrations') }),
    )
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.steam') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.curseforge') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.tabs.curseforge') }))
    expect(
      screen.getByRole('tab', { name: i18n.t('settings.tabs.curseforge') }),
    ).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.tabs.communication') }))
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.email') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.messenger') })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: i18n.t('settings.tabs.supportWidget') }),
    ).toBeInTheDocument()
  })

  it('öffnet Deep-Links wie ?tab=news und ?tab=hoster direkt auf dem passenden Sub-Tab', async () => {
    vi.mocked(client.api).mockImplementation(async (pfad: string) =>
      pfad.includes('/hoster/') || pfad.includes('/shop/') ? ([] as never) : ({} as never),
    )

    const { unmount } = renderSettings('/settings?tab=news')
    expect(
      await screen.findByRole('tab', { name: i18n.t('settings.tabs.announcements') }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.news') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    unmount()

    renderSettings('/settings?tab=hoster')
    expect(
      await screen.findByRole('tab', { name: i18n.t('settings.tabs.shopAndHoster') }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: i18n.t('settings.tabs.hoster') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it.each([null, {}, { default_language: null }])(
    'normalizes an incomplete settings response without exposing an exception (%j)',
    async (response) => {
      vi.mocked(client.api).mockResolvedValue(response as never)
      renderSettings()

      expect(await screen.findByText(/Panel[- ](?:Configuration|Konfiguration)/i)).toBeInTheDocument()
      await waitFor(() => {
        expect(useToastStore.getState().toasts).toEqual([])
      })
      expect(screen.queryByText(/startsWith/i)).not.toBeInTheDocument()
    },
  )

  it('pinnt einen Einstellungsbereich über den Stern-Schalter an die Dashboard-Leiste und löst ihn wieder', async () => {
    vi.mocked(client.api).mockResolvedValue({} as never)
    renderSettings('/settings')

    expect(await screen.findByText(/Panel[- ](?:Configuration|Konfiguration)/i)).toBeInTheDocument()
    const pinButton = screen.getByTestId('pin-settings-shop')
    expect(pinButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(pinButton)
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toContain('/settings?tab=shop')
    expect(pinButton).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(pinButton)
    expect(useDashboardPreferencesStore.getState().pinnedTabs).not.toContain('/settings?tab=shop')
    expect(pinButton).toHaveAttribute('aria-pressed', 'false')
  })
})
