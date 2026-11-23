import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { BrandingSettings } from './BrandingSettings'
import { EMPTY_PANEL_SETTINGS } from './types'

const { apiMock, refreshMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  refreshMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  SanitizedApiError: class SanitizedApiError extends Error {},
}))

vi.mock('@/stores/toastStore', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('@/stores/publicSettingsStore', () => ({
  usePublicSettingsStore: {
    getState: () => ({ refresh: refreshMock }),
  },
}))

describe('BrandingSettings', () => {
  beforeEach(() => {
    void i18n.changeLanguage('de')
    apiMock.mockReset()
    refreshMock.mockReset().mockResolvedValue(undefined)
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
  })

  it('rendert Namen- und Logo-Steuerung ohne Akzentfarben-Auswahl', () => {
    const onChange = vi.fn()
    const { container } = render(
      <BrandingSettings settings={EMPTY_PANEL_SETTINGS} canWrite={true} onChange={onChange} />,
    )

    const brandInput = screen.getByLabelText('Marken- / Produktname')
    fireEvent.change(brandInput, { target: { value: 'NordCloud' } })
    expect(onChange).toHaveBeenCalledWith({ brand_name: 'NordCloud' })

    expect(screen.queryByLabelText('Name der KI')).toBeNull()
    expect(container.querySelector('input[type="color"]')).toBeNull()
    expect(screen.queryByLabelText(/Akzentfarbe/i)).toBeNull()
  })

  it('laedt ein eigenes WebP-Logo hoch, aktiviert Custom-Modus und aktualisiert den Store', async () => {
    apiMock.mockResolvedValue({
      slot: 'default',
      configured: true,
      version: 1,
      url: '/api/settings/public/branding/logo/default?v=1',
    })
    const onChange = vi.fn()
    render(<BrandingSettings settings={EMPTY_PANEL_SETTINGS} canWrite={true} onChange={onChange} />)

    const fileInput = screen.getByLabelText('Hochladen (Standard-Logo)') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'logo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/settings/branding/logo/default',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      )
    })
    expect(onChange).toHaveBeenCalledWith({
      brand_logos: {
        default: {
          configured: true,
          version: 1,
          url: '/api/settings/public/branding/logo/default?v=1',
        },
      },
      brand_logo_mode: 'custom',
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(toastSuccessMock).toHaveBeenCalledWith('Logo gespeichert.')
  })

  it('entfernt ein hinterlegtes eigenes Logo und setzt den Modus zurueck', async () => {
    apiMock.mockResolvedValue({ deleted: true })
    const onChange = vi.fn()
    render(
      <BrandingSettings
        settings={{
          ...EMPTY_PANEL_SETTINGS,
          brand_logo_mode: 'custom',
          brand_logos: {
            default: {
              configured: true,
              version: 2,
              url: '/api/settings/public/branding/logo/default?v=2',
            },
          },
        }}
        canWrite={true}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Logo entfernen (Standard-Logo)' }))

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/settings/branding/logo/default', { method: 'DELETE' })
    })
    expect(onChange).toHaveBeenCalledWith({
      brand_logos: {
        default: { configured: false, version: null, url: null },
      },
      brand_logo_mode: 'default',
    })
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(toastSuccessMock).toHaveBeenCalledWith('Eigenes Logo entfernt.')
  })

  it('erlaubt bei fehlendem Schreibrecht keine Aenderungen oder Logo-Uploads', () => {
    render(
      <BrandingSettings settings={EMPTY_PANEL_SETTINGS} canWrite={false} onChange={vi.fn()} />,
    )

    expect(screen.getByLabelText('Marken- / Produktname')).toBeDisabled()
    expect(screen.queryByLabelText('Name der KI')).toBeNull()
    expect(screen.queryByLabelText(/Hochladen/i)).toBeNull()
  })
})
