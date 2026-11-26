import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aiApi, type AiRouterConfig } from '@/api/ai'
import i18n from '@/i18n'
import { useToastStore } from '@/stores/toastStore'
import { AiRouterSettingsCard } from './AiRouterSettingsCard'

vi.mock('@/api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ai')>()
  return {
    ...actual,
    aiApi: {
      ...actual.aiApi,
      getRouterConfig: vi.fn(),
      updateRouterConfig: vi.fn(),
    },
  }
})

const initialConfig: AiRouterConfig = {
  enabled: false,
  router_provider_id: 77,
  ready: false,
  eco_models: [
    { provider_id: 1, model: 'google/gemini-2.5-flash', provider_name: 'OpenRouter', available: true },
  ],
  standard_models: [],
  flagship_models: [],
  fallback_models: [],
  eco_weight: 1.0,
  standard_weight: 1.0,
  flagship_weight: 1.0,
  fallback_weight: 1.0,
  available_providers: [
    {
      provider_id: 1,
      provider_name: 'OpenRouter',
      provider_kind: 'openrouter',
      models: ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4'],
    },
  ],
  updated_at: null,
}

describe('AiRouterSettingsCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    useToastStore.setState({ toasts: [] })
    vi.mocked(aiApi.getRouterConfig).mockReset()
    vi.mocked(aiApi.updateRouterConfig).mockReset()
    vi.mocked(aiApi.getRouterConfig).mockResolvedValue(initialConfig)
  })

  it('loads router pools, adds a model via Dropdown and saves configuration', async () => {
    vi.mocked(aiApi.updateRouterConfig).mockResolvedValue({
      ...initialConfig,
      enabled: true,
      ready: true,
      standard_models: [
        { provider_id: 1, model: 'anthropic/claude-sonnet-4', provider_name: 'OpenRouter', available: true },
      ],
    })

    render(<AiRouterSettingsCard canWrite />)

    await screen.findByText('Singra Router')
    expect(screen.getByText('google/gemini-2.5-flash')).toBeInTheDocument()

    // Aktivieren
    fireEvent.click(screen.getByRole('switch', { name: /Singra Router aktivieren/i }))

    // Speichern
    fireEvent.click(screen.getByRole('button', { name: /Speichern/i }))

    await waitFor(() => {
      expect(aiApi.updateRouterConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          eco_models: [{ provider_id: 1, model: 'google/gemini-2.5-flash' }],
        }),
      )
    })
  })
})
