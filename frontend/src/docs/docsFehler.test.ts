import { describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import { SanitizedApiError } from '@/api/client'
import { docsFehlermeldung, type DocsFehlerKontext } from './docsFehler'

const t = i18n.t.bind(i18n)

const KONTEXTE: DocsFehlerKontext[] = ['create', 'list', 'update', 'upload', 'share', 'export']

describe('docsFehlermeldung', () => {
  it('zeigt bei netzartigen Fehlern den Kontexttext', () => {
    for (const kontext of KONTEXTE) {
      expect(docsFehlermeldung(t, new Error('kaputt'), kontext)).toBe(
        i18n.t(`docs.fehler.${kontext}`),
      )
      expect(docsFehlermeldung(t, new SanitizedApiError('kaputt', {}), kontext)).toBe(
        i18n.t(`docs.fehler.${kontext}`),
      )
    }
  })

  it('zeigt bei bekanntem Server-Code dessen Text', () => {
    expect(
      docsFehlermeldung(
        t,
        new SanitizedApiError('voll', { code: 'ASSET_QUOTA_EXCEEDED' }),
        'upload',
      ),
    ).toBe(i18n.t('docs.errors.ASSET_QUOTA_EXCEEDED'))
    expect(
      docsFehlermeldung(
        t,
        new SanitizedApiError('gross', { code: 'ASSET_BYTES_EXCEEDED' }),
        'upload',
      ),
    ).toBe(i18n.t('docs.errors.ASSET_BYTES_EXCEEDED'))
  })

  it('fällt bei unbekanntem Code auf den Kontexttext zurück', () => {
    expect(
      docsFehlermeldung(t, new SanitizedApiError('neu', { code: 'DOC_ZUKUNFT' }), 'share'),
    ).toBe(i18n.t('docs.fehler.share'))
  })
})
