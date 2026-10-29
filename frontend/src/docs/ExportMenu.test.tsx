import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import * as docsApi from '@/api/docs'
import { ExportMenu } from './ExportMenu'

vi.mock('@/api/docs', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/api/docs')>()
  return {
    ...echt,
    downloadExport: vi.fn(async () => ({ blob: new Blob(['x']), filename: 'dokument.html' })),
  }
})

describe('ExportMenu', () => {
  it('nutzt die DNA-Dropdown und lädt das gewählte Format', async () => {
    render(<ExportMenu uid="doc-1" rev={4} />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.export.label') }))
    fireEvent.click(await screen.findByRole('option', { name: i18n.t('docs.export.markdown') }))

    await waitFor(() =>
      expect(docsApi.downloadExport).toHaveBeenCalledWith('doc-1', 'md', 4),
    )
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
