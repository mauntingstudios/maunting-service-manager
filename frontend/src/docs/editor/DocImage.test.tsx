import { render, screen, waitFor } from '@testing-library/react'
import type { NodeViewProps } from '@tiptap/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { DocImageNodeView } from './DocImage'
import { getAssetSignedUrl } from '@/api/docs'

vi.mock('@tiptap/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tiptap/react')>(),
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('@/api/docs', () => ({
  getAssetSignedUrl: vi.fn(),
  assetUrl: (url: string) => url,
}))

function props(attrs: Record<string, unknown>): NodeViewProps {
  return { node: { attrs }, extension: { options: { docUid: 'doc-1' } }, selected: false } as unknown as NodeViewProps
}

beforeEach(() => vi.resetAllMocks())

describe('DocImageNodeView', () => {
  it('zeigt ohne Asset statt einer fremden Quelle einen Platzhalter', () => {
    const { container } = render(<DocImageNodeView {...props({ src: 'https://tracker.example/bild.png' })} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(i18n.t('docs.editor.imageUnavailable'))).toBeInTheDocument()
    expect(getAssetSignedUrl).not.toHaveBeenCalled()
  })

  it('lädt ein eigenes Asset nur über die signierte URL', async () => {
    vi.mocked(getAssetSignedUrl).mockResolvedValue({ signed_url: '/api/docs/assets/asset-1', expires_at: '2026-11-03' })
    render(<DocImageNodeView {...props({ assetUid: 'asset-1', src: 'https://tracker.example/bild.png', alt: 'Bild' })} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', '/api/docs/assets/asset-1'))
    expect(getAssetSignedUrl).toHaveBeenCalledWith('doc-1', 'asset-1', 3600)
  })

  it('zeigt beim Wechsel des Assets keine alte Bild-URL', async () => {
    vi.mocked(getAssetSignedUrl).mockImplementation((_doc, asset) =>
      asset === 'asset-1'
        ? Promise.resolve({ signed_url: '/api/docs/assets/asset-1', expires_at: '2026-11-03' })
        : new Promise(() => {}),
    )
    const { rerender } = render(<DocImageNodeView {...props({ assetUid: 'asset-1', alt: 'Bild' })} />)
    await screen.findByRole('img')
    rerender(<DocImageNodeView {...props({ assetUid: 'asset-2', alt: 'Bild' })} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
