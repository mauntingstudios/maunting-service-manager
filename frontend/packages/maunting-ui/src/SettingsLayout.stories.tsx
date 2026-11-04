import type { Meta, StoryObj } from '@storybook/react-vite'
import { Globe, Shield } from 'lucide-react'
import { useState } from 'react'

import { Button } from './Button'
import { SettingsLayout, SettingsSection, SettingRow, type SettingsSectionEintrag } from './einstellungen/SettingsLayout'
import { Switch } from './Switch'

type Id = 'allgemein' | 'sicherheit'

const sections: SettingsSectionEintrag<Id>[] = [
  { id: 'allgemein', label: 'Allgemein', icon: Globe, group: 'Grundlagen' },
  { id: 'sicherheit', label: 'Sicherheit', icon: Shield, group: 'Schutz' },
]

const meta = {
  title: 'Maunting UI/Einstellungen',
  component: SettingsLayout,
  parameters: { layout: 'fullscreen' },
  args: {
    sections,
    active: 'allgemein',
    onChange: () => undefined,
    title: 'Einstellungen',
    children: null,
  },
} satisfies Meta<typeof SettingsLayout<Id>>

export default meta
type Story = StoryObj<typeof meta>

function Beispiel() {
  const [aktiv, setAktiv] = useState<Id>('allgemein')
  return (
    <div className="msm-page min-h-[32rem]">
      <SettingsLayout
        sections={sections}
        active={aktiv}
        onChange={setAktiv}
        title="Einstellungen"
        description="Ruhige Zeilen statt Kärtchen."
      >
        <SettingsSection title={aktiv === 'allgemein' ? 'Allgemein' : 'Sicherheit'} description="Eine Zeile Kontext, dann die Einstellungen.">
          <SettingRow title="Sprache" description="Die Sprache der Oberfläche.">
            <span className="text-body-sm text-on-surface-variant">Deutsch</span>
          </SettingRow>
          <SettingRow title="Benachrichtigungen" description="Nur wichtige Ereignisse melden.">
            <Switch checked aria-label="Benachrichtigungen" onCheckedChange={() => undefined} />
          </SettingRow>
          <SettingRow title="Sitzung beenden" description="Meldet dieses Gerät ab.">
            <Button variant="secondary">Abmelden</Button>
          </SettingRow>
        </SettingsSection>
      </SettingsLayout>
    </div>
  )
}

export const Standard: Story = {
  render: () => <Beispiel />,
}
