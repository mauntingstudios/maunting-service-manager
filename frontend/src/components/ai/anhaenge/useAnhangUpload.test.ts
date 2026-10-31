import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aiApi, type AiAttachment } from '@/api/ai'
import { useAnhangUpload } from './useAnhangUpload'

vi.mock('@/api/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/ai')>()
  return {
    ...original,
    aiApi: {
      ...original.aiApi,
      uploadAttachment: vi.fn(),
      deleteAttachment: vi.fn().mockResolvedValue(undefined),
    },
  }
})

const angehaengt: AiAttachment = {
  id: 'img-1',
  conversation_id: 'c-1',
  original_name: 'foto.png',
  media_type: 'image/png',
  size_bytes: 2048,
  status: 'ready',
  rejection_code: null,
  message_id: null,
  redacted_spans: null,
  created_at: '2026-10-31T12:00:00Z',
}

describe('useAnhangUpload', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:vorschau')
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    vi.mocked(aiApi.uploadAttachment).mockReset().mockResolvedValue(angehaengt)
    vi.mocked(aiApi.deleteAttachment).mockReset().mockResolvedValue(undefined)
  })

  it('laedt mehrere Dateien nacheinander hoch und haelt Bildvorschauen', async () => {
    const gesetzt: AiAttachment[][] = []
    const { result } = renderHook(() => useAnhangUpload({
      aktiv: true,
      gesperrt: false,
      setAttachments: (update) => {
        gesetzt.push(typeof update === 'function' ? update([]) : update)
      },
      onFehler: () => undefined,
    }))
    const eins = new File(['a'], 'foto.png', { type: 'image/png' })
    const zwei = new File(['b'], 'einkauf.md', { type: 'text/markdown' })

    await act(async () => { await result.current.uploadFiles([eins, zwei]) })

    expect(aiApi.uploadAttachment).toHaveBeenCalledTimes(2)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledWith(eins)
    expect(result.current.vorschauen[angehaengt.id]).toBe('blob:vorschau')
    expect(gesetzt.length).toBeGreaterThanOrEqual(2)
  })

  it('gibt die Vorschau beim Entfernen wieder frei', async () => {
    const { result } = renderHook(() => useAnhangUpload({
      aktiv: true,
      gesperrt: false,
      setAttachments: () => undefined,
      onFehler: () => undefined,
    }))
    await act(async () => {
      await result.current.uploadFiles([new File(['a'], 'foto.png', { type: 'image/png' })])
    })

    await act(async () => { await result.current.remove(angehaengt) })

    expect(aiApi.deleteAttachment).toHaveBeenCalledWith(angehaengt.id)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:vorschau')
    expect(result.current.vorschauen[angehaengt.id]).toBeUndefined()
  })
})
