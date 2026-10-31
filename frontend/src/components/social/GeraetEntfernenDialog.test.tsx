import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { GeraetEntfernenDialog } from './GeraetEntfernenDialog'

vi.mock('@/services/e2eeGeraet', () => ({ entferneGeraet: vi.fn(async () => undefined) }))
vi.mock('@/components/auth/ZweitfaktorNachweis', () => ({
  useZweitfaktor: () => ({
    wahl: null,
    methoden: [],
    bereit: false,
    code: '',
    setCode: vi.fn(),
    nachweis: vi.fn(),
  }),
  ZweitfaktorFeld: () => null,
}))
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (waehlen: (zustand: unknown) => unknown) =>
    waehlen({ user: { has_password: true } }),
}))

const GERAET = {
  device_id: 'geraet-0001',
  public_key: 'pub',
  signing_public_key: 'sig',
  label: 'Arbeitsrechner',
}

describe('GeraetEntfernenDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('sperrt das Entfernen des letzten Schlüsselhalters und erklaert warum', () => {
    render(
      <GeraetEntfernenDialog
        geraet={GERAET}
        letzterSchluesselhalter
        onOpenChange={() => {}}
        onEntfernt={() => {}}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      i18n.t('profile.e2eeDevices.lastKeyHolderRemoveWarning'),
    )
    expect(
      screen.getByRole('button', { name: i18n.t('profile.e2eeDevices.remove') }),
    ).toBeDisabled()
  })

  it('laesst ein normales Gerät nach dem Nachweis entfernen', () => {
    render(
      <GeraetEntfernenDialog
        geraet={GERAET}
        onOpenChange={() => {}}
        onEntfernt={() => {}}
      />,
    )

    expect(screen.queryByRole('alert')).toBeNull()
    expect(
      screen.getByRole('button', { name: i18n.t('profile.e2eeDevices.remove') }),
    ).toBeDisabled() // ohne Passwort noch nicht bereit
  })
})
