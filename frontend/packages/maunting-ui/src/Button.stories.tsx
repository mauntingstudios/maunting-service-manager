import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from './Button'

const meta = {
  title: 'Maunting UI/Button',
  component: Button,
  args: { children: 'Speichern' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'destructive'] },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primaer: Story = {}
export const Sekundaer: Story = { args: { variant: 'secondary' } }
export const Ruhig: Story = { args: { variant: 'ghost', children: 'Abbrechen' } }
export const Gefahr: Story = { args: { variant: 'destructive', children: 'Löschen' } }
export const Fingerziel: Story = { args: { fingerziel: true, children: 'Weiter' } }
