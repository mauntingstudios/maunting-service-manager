import { beforeEach, describe, expect, it } from 'vitest'

import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'
import { useDocsStore } from './docsStore'

describe('docsStore', () => {
  beforeEach(() => {
    useDocsStore.getState().zuruecksetzen()
    setzeAngemeldetesKonto(null)
  })

  it('nimmt die offene Auswahl bei einem Kontowechsel nicht mit', () => {
    setzeAngemeldetesKonto(1)
    useDocsStore.getState().setSelection({ quote: 'vertraulich' })
    useDocsStore.getState().setTreeOffen(true)

    setzeAngemeldetesKonto(2)

    expect(useDocsStore.getState().selection).toBeNull()
    expect(useDocsStore.getState().treeOffen).toBe(false)
  })
})
