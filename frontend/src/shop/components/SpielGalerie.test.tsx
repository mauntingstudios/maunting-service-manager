import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { ShopSpiel } from '../typen'

const hoisted = vi.hoisted(() => ({
  getGallery: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: {
      ...actual.shopCatalogApi,
      getGallery: hoisted.getGallery,
    },
  }
})

import { SpielGalerie } from './SpielGalerie'

const BASIS_SPIEL: ShopSpiel = {
  id: 'project_zomboid',
  name: 'Project Zomboid',
  game: 'Project Zomboid',
  category: 'steam_game',
  beschreibung: { de: 'Survival', en: 'Survival' },
  tags: ['Survival'],
  unterstuetztMods: true,
  unterstuetztWorkshop: true,
  motiv: 'survival',
  bildUrl: '/api/shop/artwork/project_zomboid',
  grundpreisCent: 799,
  ramStufenGb: [4, 8],
  standardRamGb: 4,
  preisProGbCent: 100,
  cpuStufen: [100, 200],
  standardCpu: 100,
  preisProKernCent: 100,
  slotStufen: [8, 16],
  standardSlots: 8,
  preisProSlotCent: 20,
  kiZugangCent: 199,
}

describe('SpielGalerie', () => {
  beforeEach(() => {
    hoisted.getGallery.mockReset()
  })

  it('rendert Karussell und schaltet ueber Pfeil, Taste und Thumbnail weiter', async () => {
    hoisted.getGallery.mockResolvedValue([
      {
        id: 'steam-108600-hero',
        source: 'steam',
        url: '/api/shop/artwork/project_zomboid/gallery/steam-108600-hero',
        is_primary: true,
        wallpaper_id: null,
      },
      {
        id: 'steam-108600-0',
        source: 'steam',
        url: '/api/shop/artwork/project_zomboid/gallery/steam-108600-0',
        is_primary: false,
        wallpaper_id: null,
      },
      {
        id: 'steam-108600-1',
        source: 'steam',
        url: '/api/shop/artwork/project_zomboid/gallery/steam-108600-1',
        is_primary: false,
        wallpaper_id: null,
      },
    ])

    render(<SpielGalerie spiel={BASIS_SPIEL} priority />)

    expect(await screen.findByText('1 / 3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.galerie.weiter') }))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('shop.galerie.bildAuswaehlen', { index: 3 }),
      }),
    )
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('faellt ohne Galerie-Eintraege sauber auf SpielArtwork zurueck', async () => {
    hoisted.getGallery.mockResolvedValue([])
    const { container } = render(<SpielGalerie spiel={BASIS_SPIEL} />)

    await waitFor(() => {
      expect(hoisted.getGallery).toHaveBeenCalledWith('project_zomboid')
    })
    expect(screen.queryByRole('button', { name: i18n.t('shop.galerie.weiter') })).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeInTheDocument()
  })
})
