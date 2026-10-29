import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import * as docsApi from '@/api/docs'
import type { DocSummary } from '@/api/docs'
import type { Team } from '@/api/teams'
import { MoveDialog } from './MoveDialog'

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    listFolders: vi.fn(async () => []),
    updateDocument: vi.fn(async () => ({})),
  }
})

vi.mock('@/stores/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const dokument = (): DocSummary => ({
  uid: 'doc-1',
  title: 'Protokoll',
  folder_uid: null,
  team_id: 1,
  team_name: 'Quelle',
  role: 'editor',
  can_edit: true,
  can_comment: true,
  can_manage: true,
  rev: 2,
  archived: false,
  deleted: false,
  content_truncated: false,
  updated_at: '2026-10-01T10:00:00Z',
  last_edited_at: '2026-10-01T10:00:00Z',
  owner: 'Ada',
})

const teams: Team[] = [
  { id: 1, name: 'Quelle', owner_user_id: 1, personal_for_user_id: null } as Team,
  { id: 2, name: 'Ziel', owner_user_id: 1, personal_for_user_id: null } as Team,
]

describe('MoveDialog', () => {
  it('verschiebt in ein anderes Team und lädt dessen Ordner', async () => {
    render(
      <MoveDialog
        document={dokument()}
        folders={[]}
        teams={teams}
        open
        onOpenChange={() => {}}
        onMoved={() => {}}
      />,
    )

    fireEvent.click(screen.getByLabelText(i18n.t('docs.move.team')))
    fireEvent.click(await screen.findByRole('option', { name: 'Ziel' }))
    await waitFor(() => expect(docsApi.listFolders).toHaveBeenCalledWith(2))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.move.action') }))
    await waitFor(() =>
      expect(docsApi.updateDocument).toHaveBeenCalledWith('doc-1', {
        team_id: 2,
        folder_uid: null,
      }),
    )
  })
})
