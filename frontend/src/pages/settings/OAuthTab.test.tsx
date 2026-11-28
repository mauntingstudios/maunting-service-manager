import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { OAuthTab } from './OAuthTab'

const { listProvidersMock, getSwitchesMock } = vi.hoisted(() => ({
  listProvidersMock: vi.fn(),
  getSwitchesMock: vi.fn(),
}))

vi.mock('@/api/oauth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/oauth')>()
  return {
    ...original,
    oauthApi: {
      ...original.oauthApi,
      listProviders: listProvidersMock,
      getSwitches: getSwitchesMock,
    },
  }
})

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}))

describe('OAuthTab', () => {
  beforeEach(() => {
    listProvidersMock.mockResolvedValue([
      {
        id: 1,
        slug: 'chatgpt',
        name: 'ChatGPT',
        preset: 'openai',
        enabled: true,
        client_id: 'oaiapp_123',
        client_secret: '****9999',
        issuer: null,
        authorization_endpoint: null,
        token_endpoint: null,
        userinfo_endpoint: null,
        scope: null,
        claims_mapping_json: null,
        position: 0,
        redirect_uri: 'https://panel.example.com/api/oauth/chatgpt/callback',
        created_at: '',
        updated_at: '',
      },
    ])
    getSwitchesMock.mockResolvedValue({
      allow_registration: false,
      allow_linking: false,
      require_verified_email: true,
    })
  })

  it('rendert konfigurierte Provider mit Symbol und konsistenten Aktionsbuttons', async () => {
    const { container } = render(<OAuthTab />)

    await waitFor(() => {
      expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    })

    expect(container.querySelector('[data-anbieter="OpenAI"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.delete' })).toBeInTheDocument()
  })

  it('oeffnet beim Hinzufuegen einen barrierefreien Dialog mit durchsuchbarem Preset-Dropdown', async () => {
    const user = userEvent.setup()
    render(<OAuthTab />)

    await waitFor(() => {
      expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /settings\.oauth\.addProvider/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    const presetTrigger = screen.getByRole('button', { name: 'settings.oauth.providerPreset' })
    await user.click(presetTrigger)

    const searchInput = screen.getByPlaceholderText('common.suchenPunkte')
    await user.type(searchInput, 'openai')
    expect(screen.getByRole('option', { name: 'openai' })).toBeInTheDocument()
  })
})
