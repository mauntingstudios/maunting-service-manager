import '../../../src/index.css'

/** Die Werkstatt läuft auf dem Canvas der App, nicht auf Storybooks Weiß. */
const preview = {
  parameters: {
    backgrounds: {
      default: 'canvas',
      values: [{ name: 'canvas', value: 'hsl(196 41% 5%)' }],
    },
    layout: 'fullscreen',
    options: {
      storySort: { order: ['Maunting UI', ['Fensterleiste', 'Button', 'Einstellungen']] },
    },
  },
}

export default preview
