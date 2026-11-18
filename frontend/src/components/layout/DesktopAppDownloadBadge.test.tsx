import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopAppDownloadBadge } from './DesktopAppDownloadBadge'
import { DEFAULT_PUBLIC_SETTINGS, usePublicSettingsStore } from '@/stores/publicSettingsStore'

describe('DesktopAppDownloadBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePublicSettingsStore.setState({ ...DEFAULT_PUBLIC_SETTINGS })
  })

  it('renders windows download link when enabled on desktop', () => {
    usePublicSettingsStore.setState({ desktop_app_download_enabled: true })

    render(<DesktopAppDownloadBadge />)

    expect(screen.getByText('MSS Desktop')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSmartSystem-Setup.exe'
    )
  })

  it('renders android apk link when on android device', () => {
    usePublicSettingsStore.setState({ desktop_app_download_enabled: true })
    const originalUserAgent = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
      configurable: true,
    })

    try {
      render(<DesktopAppDownloadBadge />)

      expect(screen.getByText('MSS Mobile App')).toBeInTheDocument()
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute(
        'href',
        'https://github.com/mauntingstudios/maunting-service-manager/releases/latest/download/MauntingSmartSystem.apk'
      )
    } finally {
      Object.defineProperty(navigator, 'userAgent', {
        value: originalUserAgent,
        configurable: true,
      })
    }
  })

  it('does not render when disabled', () => {
    usePublicSettingsStore.setState({ desktop_app_download_enabled: false })

    render(<DesktopAppDownloadBadge />)

    expect(screen.queryByText('MSS Desktop')).not.toBeInTheDocument()
  })
})
