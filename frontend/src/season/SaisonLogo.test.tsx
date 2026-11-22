import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PUBLIC_SETTINGS, usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { SEASON_ASSETS } from './assets'
import { SaisonLogo } from './SaisonLogo'

describe('SaisonLogo', () => {
  beforeEach(() => {
    usePublicSettingsStore.setState({ ...DEFAULT_PUBLIC_SETTINGS })
  })

  it('rendert standardmaessig alle vier MSM-Saisonlogos mit Fallback-Assets', () => {
    const { container } = render(
      <SaisonLogo art="msm" standardSrc="/msm-default.webp" alt="MSM Logo" />,
    )

    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs).toHaveLength(4)
    expect(imgs[0].getAttribute('src')).toBe('/msm-default.webp')
    expect(imgs[0].getAttribute('alt')).toBe('MSM Logo')
    expect(imgs[1].getAttribute('src')).toBe(SEASON_ASSETS.birthday.logoMsm)
    expect(imgs[2].getAttribute('src')).toBe(SEASON_ASSETS.halloween.logoMsm)
    expect(imgs[3].getAttribute('src')).toBe(SEASON_ASSETS.christmas.logoMsm)
  })

  it('verwendet benutzerdefinierte Standard- und Saison-Logos im Custom-Modus', () => {
    usePublicSettingsStore.setState({
      ...DEFAULT_PUBLIC_SETTINGS,
      branding: {
        ...DEFAULT_PUBLIC_SETTINGS.branding,
        logo_mode: 'custom',
        season_logo_mode: 'custom',
        logo_url: '/api/settings/public/branding/logo/default?v=4',
        season_logos: {
          birthday: null,
          halloween: '/api/settings/public/branding/logo/halloween?v=5',
          christmas: null,
        },
      },
    })

    const { container } = render(
      <SaisonLogo art="msm" standardSrc="/msm-default.webp" alt="CloudForge" />,
    )

    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs).toHaveLength(4)
    expect(imgs[0].getAttribute('src')).toBe('/api/settings/public/branding/logo/default?v=4')
    expect(imgs[1].getAttribute('src')).toBe(SEASON_ASSETS.birthday.logoMsm)
    expect(imgs[2].getAttribute('src')).toBe('/api/settings/public/branding/logo/halloween?v=5')
    expect(imgs[3].getAttribute('src')).toBe(SEASON_ASSETS.christmas.logoMsm)
  })

  it('deaktiviert Saison-Logos fuer msm bei season_logo_mode=disabled, laesst pontis unberuehrt', () => {
    usePublicSettingsStore.setState({
      ...DEFAULT_PUBLIC_SETTINGS,
      branding: {
        ...DEFAULT_PUBLIC_SETTINGS.branding,
        logo_mode: 'custom',
        season_logo_mode: 'disabled',
        logo_url: '/api/settings/public/branding/logo/default?v=7',
      },
    })

    const msmRender = render(
      <SaisonLogo art="msm" standardSrc="/msm-default.webp" alt="CloudForge" />,
    )
    const msmImgs = Array.from(msmRender.container.querySelectorAll('img'))
    expect(msmImgs).toHaveLength(1)
    expect(msmImgs[0].getAttribute('src')).toBe('/api/settings/public/branding/logo/default?v=7')

    const pontisRender = render(
      <SaisonLogo art="pontis" standardSrc="/pontis-default.webp" alt="Pontis" />,
    )
    const pontisImgs = Array.from(pontisRender.container.querySelectorAll('img'))
    expect(pontisImgs).toHaveLength(4)
    expect(pontisImgs[0].getAttribute('src')).toBe('/pontis-default.webp')
    expect(pontisImgs[2].getAttribute('src')).toBe(SEASON_ASSETS.halloween.logoPontis)
  })
})
