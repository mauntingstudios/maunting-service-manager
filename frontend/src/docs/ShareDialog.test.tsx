import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import * as docsApi from '@/api/docs'
import type { DocDetail } from '@/api/docs'
import { ShareDialog } from './ShareDialog'

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    createShare: vi.fn(async () => ({
      url: '/teilen/token-1',
      role: 'viewer' as const,
      expires_at: '2026-11-01T10:00:00Z',
    })),
    deleteShare: vi.fn(async () => ({ ok: true })),
  }
})

const detail = (over: Partial<DocDetail> = {}): DocDetail => ({
  uid: 'doc-1',
  title: 'Protokoll',
  folder_uid: null,
  team_id: 1,
  team_name: 'Team',
  role: 'editor',
  can_edit: true,
  can_comment: true,
  can_manage: true,
  rev: 3,
  archived: false,
  deleted: false,
  content_truncated: false,
  updated_at: '2026-10-01T10:00:00Z',
  last_edited_at: '2026-10-01T10:00:00Z',
  owner: 'Ada',
  default_role: 'viewer',
  schema_version: 1,
  shared: false,
  share_role: null,
  share_expires_at: null,
  ...over,
})

function zeigen(over: Partial<DocDetail> = {}) {
  const onChanged = vi.fn()
  render(
    <ShareDialog detail={detail(over)} open onOpenChange={() => {}} onChanged={onChanged} />,
  )
  return { onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
})

describe('ShareDialog', () => {
  it('legt einen Leselink mit Frist an und zeigt ihn absolut an', async () => {
    const { onChanged } = zeigen()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.share.create') }))
    await waitFor(() =>
      expect(docsApi.createShare).toHaveBeenCalledWith('doc-1', 'viewer', 7),
    )
    const feld = await screen.findByLabelText(i18n.t('docs.share.link'))
    expect((feld as HTMLInputElement).value).toBe(`${window.location.origin}/teilen/token-1`)
    expect(onChanged).toHaveBeenCalled()
  })

  it('bietet bei aktivem Link Ersetzen und Abschalten an', async () => {
    const { onChanged } = zeigen({
      shared: true,
      share_role: 'commenter',
      share_expires_at: '2026-11-01T10:00:00Z',
    })
    expect(screen.getByRole('button', { name: i18n.t('docs.share.replace') })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('docs.share.active', {
      role: i18n.t('docs.roles.commenter'),
      date: new Date('2026-11-01T10:00:00Z').toLocaleString(),
    }))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.share.disable') }))
    await waitFor(() => expect(docsApi.deleteShare).toHaveBeenCalledWith('doc-1'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('kopiert den angezeigten Link in die Zwischenablage', async () => {
    zeigen()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.share.create') }))
    const feld = await screen.findByLabelText(i18n.t('docs.share.link'))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.share.copy') }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/teilen/token-1`,
      ),
    )
    expect((feld as HTMLInputElement).value).toContain('/teilen/token-1')
  })
})
