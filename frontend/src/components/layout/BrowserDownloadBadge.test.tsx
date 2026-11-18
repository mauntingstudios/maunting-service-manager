import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserDownloadBadge } from './BrowserDownloadBadge'
import * as geraeteArtModul from '@/desktop/geraeteArt'
import { DEFAULT_PUBLIC_SETTINGS, usePublicSettingsStore } from '@/stores/publicSettingsStore'

vi.mock('@/desktop/geraeteArt', () => ({
  geraeteArt: vi.fn(() => 'desktop'),
}))

describe('BrowserDownloadBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(geraeteArtModul.geraeteArt).mockReturnValue('desktop')
    usePublicSettingsStore.setState({ ...DEFAULT_PUBLIC_SETTINGS })
  })

  it('renders the setup.exe download link on desktop when enabled', () => {
    usePublicSettingsStore.setState({ browser_download_enabled: true })

    render(<BrowserDownloadBadge />)

    expect(screen.getByText('Maunting Pontis')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingPontis-Setup.exe'
    )
  })

  it('renders the apk download link when on Android', () => {
    usePublicSettingsStore.setState({ browser_download_enabled: true })
    const originalUserAgent = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      configurable: true,
    })

    try {
      render(<BrowserDownloadBadge />)
      expect(screen.getByText('Pontis Mobile')).toBeInTheDocument()
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute(
        'href',
        'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSecureBrowser.apk'
      )
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      })
    }
  })

  it('does not render when disabled via settings', () => {
    usePublicSettingsStore.setState({ browser_download_enabled: false })

    render(<BrowserDownloadBadge />)

    expect(screen.queryByText('Maunting Pontis')).not.toBeInTheDocument()
  })

  it('auto-hides when already running inside MSB (geraeteArt === browser)', () => {
    usePublicSettingsStore.setState({ browser_download_enabled: true })
    vi.mocked(geraeteArtModul.geraeteArt).mockReturnValue('browser')

    render(<BrowserDownloadBadge />)

    expect(screen.queryByText('Maunting Pontis')).not.toBeInTheDocument()
  })

  it('renders by default (true) from DEFAULT_PUBLIC_SETTINGS', () => {
    render(<BrowserDownloadBadge />)

    expect(screen.getByText('Maunting Pontis')).toBeInTheDocument()
  })
})
