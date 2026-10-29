import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import * as docsApi from '@/api/docs'
import type { DocRevision } from '@/api/docs'
import { HistoryPanel } from './HistoryPanel'

const dialog = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  prompt: vi.fn(async () => 'Vor dem Umbau'),
}))

vi.mock('@/Singra/UI', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/Singra/UI')>()
  return { ...echt, confirm: dialog.confirm, prompt: dialog.prompt }
})

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    createRevision: vi.fn(async () => ({ rev: 4 })),
    restoreRevision: vi.fn(async () => ({ rev: 5 })),
  }
})

const revision = (over: Partial<DocRevision> = {}): DocRevision => ({
  rev: 3,
  reason: 'ai_edit',
  label: null,
  preview: 'Singra hat den Absatz ersetzt',
  size_bytes: 2048,
  author: 'Singra',
  author_kind: 'ai',
  ai_run_id: 'run-1',
  created_at: '2026-10-01T10:00:00Z',
  ...over,
})

function zeigen(revisions: DocRevision[], canEdit: boolean) {
  const onChanged = vi.fn()
  render(<HistoryPanel uid="doc-1" revisions={revisions} canEdit={canEdit} onChanged={onChanged} />)
  return { onChanged }
}

beforeEach(() => {
  vi.clearAllMocks()
  dialog.confirm.mockResolvedValue(true)
  dialog.prompt.mockResolvedValue('Vor dem Umbau')
})

describe('HistoryPanel', () => {
  it('zeigt im leeren Verlauf einen Hinweis', () => {
    zeigen([], true)
    expect(screen.getByText(i18n.t('docs.history.empty'))).toBeInTheDocument()
  })

  it('markiert KI-Revisionen und ihren Grund', () => {
    zeigen([revision()], false)
    expect(screen.getByText(i18n.t('docs.history.reasons.aiEdit'))).toBeInTheDocument()
    expect(screen.getAllByText(/Singra/).length).toBeGreaterThan(0)
    expect(screen.getByText('Singra hat den Absatz ersetzt')).toBeInTheDocument()
  })

  it('lässt Viewer weder Checkpoint noch Wiederherstellung anbieten', () => {
    zeigen([revision()], false)
    expect(
      screen.queryByRole('button', { name: i18n.t('docs.history.checkpoint') }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: i18n.t('docs.history.restore') }),
    ).not.toBeInTheDocument()
  })

  it('stellt nach Bestätigung eine ältere Version wieder her', async () => {
    const { onChanged } = zeigen([revision({ reason: 'checkpoint', author_kind: 'user' })], true)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.history.restore') }))
    await waitFor(() => expect(docsApi.restoreRevision).toHaveBeenCalledWith('doc-1', 3))
    expect(dialog.confirm).toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalled()
  })

  it('bricht die Wiederherstellung ohne Bestätigung ab', async () => {
    dialog.confirm.mockResolvedValue(false)
    zeigen([revision()], true)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.history.restore') }))
    await waitFor(() => expect(dialog.confirm).toHaveBeenCalled())
    expect(docsApi.restoreRevision).not.toHaveBeenCalled()
  })

  it('legt einen benannten Checkpoint an', async () => {
    const { onChanged } = zeigen([revision()], true)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.history.checkpoint') }))
    await waitFor(() =>
      expect(docsApi.createRevision).toHaveBeenCalledWith('doc-1', 'Vor dem Umbau'),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('legt ohne Eingabe einen unbenannten Checkpoint an', async () => {
    dialog.prompt.mockResolvedValue('   ')
    zeigen([revision()], true)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.history.checkpoint') }))
    await waitFor(() => expect(docsApi.createRevision).toHaveBeenCalledWith('doc-1', undefined))
  })
})
