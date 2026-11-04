import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { User } from '@/types'
import { Kartenbegruessung } from './Kartenbegruessung'
import { useVaultStore } from './vaultStore'

const KONTO = { id: 7, username: 'maunting', email: 'm@example.com', is_owner: false } as unknown as User

function karteZuruecksetzen(werte: Record<string, unknown> = {}) {
  useVaultStore.setState({
    isInitialized: true,
    isDeviceAuthorized: false,
    isUnlocking: false,
    isUnlocked: false,
    unlockError: null,
    bucketId: null,
    rotationState: null,
    fetchVaultSalt: vi.fn().mockResolvedValue('salt'),
    authorizeDevice: vi.fn().mockResolvedValue(true),
    ...werte,
  })
}

describe('Kartenbegruessung', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    karteZuruecksetzen()
  })

  it('gibt das Gerät mit dem Master-Passwort frei und geht danach weiter', async () => {
    const onFertig = vi.fn()
    render(<Kartenbegruessung user={KONTO} onFertig={onFertig} />)

    const feld = await screen.findByLabelText(i18n.t('mss.card.welcomePasswordLabel'))
    fireEvent.change(feld, { target: { value: 'mein-meister-passwort' } })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.card.authorizeSubmit') }))

    await waitFor(() => {
      expect(useVaultStore.getState().authorizeDevice).toHaveBeenCalledWith('mein-meister-passwort')
    })
    expect(onFertig).toHaveBeenCalledTimes(1)
  })

  it('lässt das Passwort ausdrücklich aus — „Später“ schaltet nichts frei', async () => {
    const onFertig = vi.fn()
    render(<Kartenbegruessung user={KONTO} onFertig={onFertig} />)

    fireEvent.click(await screen.findByRole('button', { name: i18n.t('mss.card.welcomeSkip') }))

    expect(useVaultStore.getState().authorizeDevice).not.toHaveBeenCalled()
    expect(onFertig).toHaveBeenCalledTimes(1)
  })

  it('zeigt ein falsches Master-Passwort an und lässt den Weg offen', async () => {
    const onFertig = vi.fn()
    const authorizeDevice = vi.fn().mockImplementation(async () => {
      useVaultStore.setState({ unlockError: 'Falsches Master-Passwort.' })
      return false
    })
    karteZuruecksetzen({ authorizeDevice })

    render(<Kartenbegruessung user={KONTO} onFertig={onFertig} />)

    fireEvent.change(await screen.findByLabelText(i18n.t('mss.card.welcomePasswordLabel')), {
      target: { value: 'falsch' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('mss.card.authorizeSubmit') }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Falsches Master-Passwort.')
    expect(onFertig).not.toHaveBeenCalled()
  })

  it('ohne Tresor gibt es nichts freizuschalten — nur weiter', async () => {
    karteZuruecksetzen({ isInitialized: false })
    const onFertig = vi.fn()
    render(<Kartenbegruessung user={KONTO} onFertig={onFertig} />)

    expect(await screen.findByText(i18n.t('mss.card.welcomeNotSetUp'))).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('common.continue') }))
    expect(screen.queryByLabelText(i18n.t('mss.card.welcomePasswordLabel'))).not.toBeInTheDocument()
    expect(onFertig).toHaveBeenCalledTimes(1)
  })

  it('meldet ein bereits freigegebenes Gerät', async () => {
    karteZuruecksetzen({ isDeviceAuthorized: true })
    render(<Kartenbegruessung user={KONTO} onFertig={vi.fn()} />)

    expect(await screen.findByText(i18n.t('mss.card.welcomeAuthorized'))).toBeInTheDocument()
  })

  it('zeigt die Karte mit dem frisch gewählten Namen', async () => {
    render(<Kartenbegruessung user={KONTO} onFertig={vi.fn()} />)
    expect(await screen.findByText('MAUNTING')).toBeInTheDocument()
  })
})
