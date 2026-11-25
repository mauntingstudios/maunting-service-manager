import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { TroubleshootingDocs } from './TroubleshootingDocs'

describe('TroubleshootingDocs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('rendert SteamCMD- und allgemeine Server-Fehler inkl. 0x202 und ENOSPC', () => {
    render(
      <MemoryRouter>
        <TroubleshootingDocs />
      </MemoryRouter>,
    )

    expect(screen.getByText(i18n.t('docsTroubleshooting.title'))).toBeInTheDocument()
    expect(screen.getByText('0x202 / UpdateResult 43')).toBeInTheDocument()
    expect(screen.getByText('ENOSPC / EDQUOT')).toBeInTheDocument()
    expect(screen.getByText('Exit 137 / OOMKilled')).toBeInTheDocument()
  })
})
