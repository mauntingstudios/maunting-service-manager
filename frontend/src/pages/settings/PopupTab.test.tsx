import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PopupTab } from './PopupTab'
import * as popupsApi from '@/api/popups'
import { useToastStore } from '@/stores/toastStore'
import i18n from '@/i18n'

vi.mock('@/api/popups', () => ({
  POPUP_CONTENT_MAX_LENGTH: 600,
  listAdminPopups: vi.fn(),
  createAdminPopup: vi.fn(),
  updateAdminPopup: vi.fn(),
  deleteAdminPopup: vi.fn(),
  getActivePopup: vi.fn(),
  getPublicActivePopups: vi.fn(),
  dismissPopup: vi.fn(),
}))

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
}))

describe('PopupTab', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useToastStore.setState({ toasts: [] })
  })

  it('renders list of popups and allows starting creation', async () => {
    vi.mocked(popupsApi.listAdminPopups).mockResolvedValue([
      {
        id: 10,
        title: 'Geplante Wartung',
        content_markdown: 'Server-Neustart um 04:00 Uhr.',
        is_active: true,
        start_at: null,
        end_at: null,
        button_text: null,
        button_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])

    const { container } = render(<PopupTab />)

    expect(await screen.findByText('Geplante Wartung')).toBeInTheDocument()
    expect(screen.getByText('Server-Neustart um 04:00 Uhr.')).toBeInTheDocument()
    // Symbolknöpfe tragen ihren Namen per aria-label, nie per nativem title.
    expect(screen.getByRole('button', { name: i18n.t('common.edit') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('common.delete') })).toBeInTheDocument()
    expect(container.querySelectorAll('[title]')).toHaveLength(0)

    const newBtn = screen.getByRole('button', { name: /Neues Pop-up|Create New/i })
    fireEvent.click(newBtn)

    expect(screen.getByLabelText(/Titel|Title/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(i18n.t('popups.bodyPlaceholder'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('popups.markdownHeading') })).toBeInTheDocument()
    expect(container.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('submits a new popup creation', async () => {
    vi.mocked(popupsApi.listAdminPopups).mockResolvedValue([])
    vi.mocked(popupsApi.createAdminPopup).mockResolvedValue({
      id: 11,
      title: 'Neues Feature',
      content_markdown: 'Markdown Text.',
      is_active: true,
      start_at: null,
      end_at: null,
      button_text: null,
      button_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    render(<PopupTab />)

    const newBtn = await screen.findByRole('button', { name: /Neues Pop-up|Create New/i })
    fireEvent.click(newBtn)

    fireEvent.change(screen.getByPlaceholderText(/z. B. Geplante Wartungsarbeiten/i), {
      target: { value: 'Neues Feature' },
    })
    fireEvent.change(screen.getByPlaceholderText(i18n.t('popups.bodyPlaceholder')), {
      target: { value: 'Markdown Text.' },
    })

    const saveBtn = screen.getByRole('button', { name: /Speichern|Save/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(popupsApi.createAdminPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Neues Feature',
          content_markdown: 'Markdown Text.',
          audience: 'all',
          tone: 'info',
          is_active: true,
        })
      )
    })
  })

  it('supports audience/tone dropdowns, relative urls, char limit counter, and badges', async () => {
    vi.mocked(popupsApi.listAdminPopups).mockResolvedValue([
      {
        id: 21,
        title: 'Nacht-Wartung',
        content_markdown: 'Kurzer Hinweis.',
        audience: 'panel',
        tone: 'maintenance',
        is_active: true,
        start_at: null,
        end_at: null,
        button_text: null,
        button_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
    vi.mocked(popupsApi.createAdminPopup).mockResolvedValue({
      id: 22,
      title: 'Shop Aktion',
      content_markdown: 'Kurzer Text',
      audience: 'shop',
      tone: 'promo',
      is_active: true,
      start_at: null,
      end_at: null,
      button_text: 'Zum Shop',
      button_url: '/shop',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    render(<PopupTab />)

    expect(await screen.findByText('Nacht-Wartung')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('popups.audiencePanel'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('popups.toneMaintenance'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Neues Pop-up|Create New/i }))

    const textarea = screen.getByPlaceholderText(i18n.t('popups.bodyPlaceholder'))
    expect(textarea).toHaveAttribute('maxlength', String(popupsApi.POPUP_CONTENT_MAX_LENGTH))
    expect(screen.getByText(`0 / ${popupsApi.POPUP_CONTENT_MAX_LENGTH}`)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Titel/i), { target: { value: 'Shop Aktion' } })
    fireEvent.change(textarea, { target: { value: 'Kurzer Text' } })
    expect(screen.getByText(`11 / ${popupsApi.POPUP_CONTENT_MAX_LENGTH}`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('popups.fieldAudience') }))
    fireEvent.click(await screen.findByRole('option', { name: i18n.t('popups.audienceShop') }))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('popups.fieldTone') }))
    fireEvent.click(await screen.findByRole('option', { name: i18n.t('popups.tonePromo') }))

    fireEvent.change(screen.getByLabelText(i18n.t('popups.fieldButtonUrl')), {
      target: { value: '/shop' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Speichern|Save/i }))

    await waitFor(() => {
      expect(popupsApi.createAdminPopup).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Shop Aktion',
          content_markdown: 'Kurzer Text',
          audience: 'shop',
          tone: 'promo',
          button_url: '/shop',
        }),
      )
    })

    // Prueft clientseitiges Limit auch ohne Browser-maxLength-Sperre
    fireEvent.click(await screen.findByRole('button', { name: /Neues Pop-up|Create New/i }))
    fireEvent.change(screen.getByLabelText(/Titel/i), { target: { value: 'Zu lang' } })
    fireEvent.change(screen.getByPlaceholderText(i18n.t('popups.bodyPlaceholder')), {
      target: { value: 'a'.repeat(popupsApi.POPUP_CONTENT_MAX_LENGTH + 1) },
    })
    fireEvent.click(screen.getByRole('button', { name: /Speichern|Save/i }))

    expect(popupsApi.createAdminPopup).toHaveBeenCalledTimes(1)
    expect(useToastStore.getState().toasts.some((item) => item.type === 'error')).toBe(true)
  })
})
