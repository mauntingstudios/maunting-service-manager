import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingRow, SettingsLayout, SettingsSection } from './SettingsLayout'

const sections = [
  { id: 'allgemein' as const, label: 'Allgemein', group: 'Grundlagen' },
  { id: 'sicherheit' as const, label: 'Sicherheit', group: 'Schutz' },
]

describe('SettingsLayout', () => {
  it('zeigt die Abschnitte in Gruppen und wechselt über die Leiste', () => {
    const onChange = vi.fn()
    render(
      <SettingsLayout
        sections={sections}
        active="allgemein"
        onChange={onChange}
        title="Einstellungen"
        description="Ruhige Zeilen."
      >
        <SettingsSection title="Allgemein">
          <SettingRow title="Sprache" description="Die Sprache der Oberfläche.">
            Deutsch
          </SettingRow>
        </SettingsSection>
      </SettingsLayout>,
    )

    const nav = screen.getByRole('navigation', { name: 'Einstellungen' })
    expect(within(nav).getByText('Grundlagen')).toBeInTheDocument()
    expect(within(nav).getByText('Schutz')).toBeInTheDocument()
    expect(screen.getByText('Die Sprache der Oberfläche.')).toBeInTheDocument()

    fireEvent.click(within(nav).getByRole('button', { name: 'Sicherheit' }))
    expect(onChange).toHaveBeenCalledWith('sicherheit')
  })
})
