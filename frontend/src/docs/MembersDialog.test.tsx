import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import * as docsApi from '@/api/docs'
import type { DocDetail, DocMemberRow } from '@/api/docs'
import { MembersDialog } from './MembersDialog'

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    listMembers: vi.fn(async () => []),
    putMember: vi.fn(async () => ({})),
    deleteMember: vi.fn(async () => ({})),
    updateDocument: vi.fn(async () => ({})),
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

const zeile = (over: Partial<DocMemberRow> = {}): DocMemberRow => ({
  user_id: 2,
  username: 'bob',
  role: 'commenter',
  effective_role: 'commenter',
  source: 'manual',
  is_team_owner: false,
  is_doc_owner: false,
  ...over,
})

function zeigen() {
  const onChanged = vi.fn()
  render(
    <MembersDialog detail={detail()} open onOpenChange={() => {}} onChanged={onChanged} />,
  )
  return { onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MembersDialog', () => {
  it('lädt die Mitglieder beim Öffnen und zeigt Rollen an', async () => {
    vi.mocked(docsApi.listMembers).mockResolvedValueOnce([
      zeile(),
      zeile({ user_id: 3, username: 'cara', role: null, effective_role: 'viewer', source: 'team' }),
    ])
    zeigen()
    await waitFor(() => expect(docsApi.listMembers).toHaveBeenCalledWith('doc-1'))
    expect(await screen.findByText('bob')).toBeInTheDocument()
    expect(screen.getByText('cara')).toBeInTheDocument()
  })

  it('ändert die Standardrolle und meldet die Änderung', async () => {
    vi.mocked(docsApi.listMembers).mockResolvedValueOnce([])
    const { onChanged } = zeigen()
    await waitFor(() => expect(docsApi.listMembers).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText(i18n.t('docs.members.defaultRole')))
    fireEvent.click(await screen.findByRole('option', { name: i18n.t('common.edit') }))
    await waitFor(() =>
      expect(docsApi.updateDocument).toHaveBeenCalledWith('doc-1', { default_role: 'editor' }),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('setzt eine Einzelrolle und lädt danach neu', async () => {
    vi.mocked(docsApi.listMembers).mockResolvedValue([zeile()])
    zeigen()
    await waitFor(() => expect(docsApi.listMembers).toHaveBeenCalledWith('doc-1'))
    expect(await screen.findByText('bob')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(i18n.t('docs.members.roleFor', { name: 'bob' })))
    fireEvent.click(await screen.findByRole('option', { name: i18n.t('common.edit') }))
    await waitFor(() =>
      expect(docsApi.putMember).toHaveBeenCalledWith('doc-1', 2, 'editor'),
    )
    await waitFor(() => expect(docsApi.listMembers).toHaveBeenCalledTimes(2))
  })

  it('nimmt eine Einzelrolle über den Team-Standard zurück', async () => {
    vi.mocked(docsApi.listMembers).mockResolvedValue([zeile()])
    zeigen()
    await waitFor(() => expect(docsApi.listMembers).toHaveBeenCalledWith('doc-1'))
    expect(await screen.findByText('bob')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(i18n.t('docs.members.roleFor', { name: 'bob' })))
    fireEvent.click(
      await screen.findByRole('option', {
        name: i18n.t('docs.members.teamDefault', { role: i18n.t('docs.roles.viewer') }),
      }),
    )
    await waitFor(() => expect(docsApi.deleteMember).toHaveBeenCalledWith('doc-1', 2))
  })
})
