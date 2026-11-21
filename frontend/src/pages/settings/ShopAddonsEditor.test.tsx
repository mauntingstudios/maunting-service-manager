import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
}))

const { createAddonMock, listAddonsMock, listRolesMock } = vi.hoisted(() => ({
  createAddonMock: vi.fn(),
  listAddonsMock: vi.fn(),
  listRolesMock: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopAdminApi: {
      listAddons: listAddonsMock,
      createAddon: createAddonMock,
      updateAddon: vi.fn(),
      deleteAddon: vi.fn(),
    },
  }
})

vi.mock('@/api/rbac', () => ({
  rbacApi: {
    listRoles: listRolesMock,
  },
}))

import { ShopAddonsEditor } from './ShopAddonsEditor'

describe('ShopAddonsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAddonsMock.mockResolvedValue([
      {
        id: 4,
        slug: 'ai-pro',
        name: 'KI Pro Paket',
        description: 'Mehr KI-Budget im Monat',
        category: 'ai_quota',
        price_cents: 999,
        currency: 'EUR',
        billing_interval: 'month',
        tax_rate_percent: 19,
        extra_slots: null,
        extra_storage_mb: null,
        extra_backups: null,
        extra_ai_tokens: 250000,
        role_id: 12,
        active: true,
        sort_order: 1,
        created_at: '2026-11-21T00:00:00+00:00',
        updated_at: '2026-11-21T00:00:00+00:00',
      },
    ])
    listRolesMock.mockResolvedValue([
      {
        id: 1,
        name: 'System Admin',
        description: null,
        is_system: true,
        permissions: ['*'],
        created_at: '2026-11-21T00:00:00+00:00',
      },
      {
        id: 12,
        name: 'Supporter Plus',
        description: null,
        is_system: false,
        permissions: ['servers.view'],
        created_at: '2026-11-21T00:00:00+00:00',
      },
    ])
    createAddonMock.mockResolvedValue({})
  })

  it('listet eigenstaendige Add-ons und speichert ein neues Add-on im Dialog', async () => {
    render(<ShopAddonsEditor />)
    expect(await screen.findByText('KI Pro Paket')).toBeInTheDocument()
    expect(screen.getByText(/9,99/)).toBeInTheDocument()
    expect(screen.getByText('Supporter Plus')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.addons.neu') }),
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(i18n.t('settings.shop.addons.name')), {
      target: { value: 'KI Starter' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.addons.speichern') }),
    )

    await waitFor(() => {
      expect(createAddonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'KI Starter',
          slug: 'ki-starter',
          category: 'ai_quota',
          extra_ai_tokens: 100000,
        }),
      )
    })
  })
})
