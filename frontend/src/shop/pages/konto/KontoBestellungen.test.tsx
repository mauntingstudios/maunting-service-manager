import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { KontoBestellungen } from './KontoBestellungen'

describe('KontoBestellungen', () => {
  it('zeigt die Demo-Bestellungen aus der Mock-API', async () => {
    render(
      <MemoryRouter>
        <KontoBestellungen />
      </MemoryRouter>,
    )
    expect(await screen.findByText('MSM-2026-1001')).toBeInTheDocument()
    expect(screen.getByText('MSM-2026-1002')).toBeInTheDocument()
  })
})
