import { describe, expect, it } from 'vitest'

import {
  sichererStickerZurueck,
  tresorRoute,
  zurueckZumSticker,
} from './stickerTresor'

describe('stickerTresor', () => {
  it('hängt den Rückweg an den Chat-Pfad', () => {
    expect(zurueckZumSticker('/chat', '?userId=7')).toBe('/chat?userId=7&fotoSticker=tresor')
    expect(zurueckZumSticker('/chat', '')).toBe('/chat?fotoSticker=tresor')
    expect(tresorRoute('/chat?userId=7&fotoSticker=tresor')).toBe(
      '/tresor?zurueck=%2Fchat%3FuserId%3D7%26fotoSticker%3Dtresor',
    )
  })

  it('lässt nur den eigenen Chat als Rückziel zu', () => {
    expect(sichererStickerZurueck('/chat?userId=7&fotoSticker=tresor')).toBe(
      '/chat?userId=7&fotoSticker=tresor',
    )
    expect(sichererStickerZurueck('')).toBeNull()
    expect(sichererStickerZurueck(null)).toBeNull()
    expect(sichererStickerZurueck('https://evil.example/chat')).toBeNull()
    expect(sichererStickerZurueck('//evil.example/chat')).toBeNull()
    expect(sichererStickerZurueck('/chat\\evil')).toBeNull()
    expect(sichererStickerZurueck('/profil')).toBeNull()
    expect(sichererStickerZurueck('/chat\u0000')).toBeNull()
  })
})
