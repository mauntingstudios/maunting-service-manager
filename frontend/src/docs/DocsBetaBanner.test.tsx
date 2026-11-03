import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DocsBetaBanner, DOCS_IS_BETA } from './DocsBetaBanner'

describe('DocsBetaBanner', () => {
  it('rendert den Beta-Hinweis im aktiven Beta-Modus', () => {
    render(<DocsBetaBanner />)

    if (DOCS_IS_BETA) {
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    }
  })
})
