import type { Meta, StoryObj } from '@storybook/react-vite'

import { Fensterleiste } from './Fensterleiste'

const meta = {
  title: 'Maunting UI/Fensterleiste',
  component: Fensterleiste,
  parameters: { layout: 'fullscreen' },
  args: {
    steuerung: { minimieren: () => undefined, maximieren: () => undefined, schliessen: () => undefined },
    beschriftungen: { minimieren: 'Minimieren', maximieren: 'Maximieren', schliessen: 'Schließen' },
    marke: <span className="grid h-5 w-5 place-items-center rounded-md bg-primary text-label-sm font-bold text-on-primary">M</span>,
    titel: 'Smart System',
  },
} satisfies Meta<typeof Fensterleiste>

export default meta
type Story = StoryObj<typeof meta>

export const Standard: Story = {}
