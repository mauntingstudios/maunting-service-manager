/** Stable, repository-contained contract for the Maunting design tokens. */
export const mauntingUiVersion = '2.0.0'

/**
 * The colour tokens as CSS colours. `tokens.css` holds the same values as HSL
 * triplets; `src/test/mauntingUiTokens.test.ts` keeps both in step.
 */
export const muiTokens = Object.freeze({
  canvas: 'hsl(196 41% 5%)',
  foreground: 'hsl(189 43% 94%)',
  'surface-1': 'hsl(204 25% 8%)',
  'surface-2': 'hsl(204 25% 10%)',
  'surface-3': 'hsl(202 26% 14%)',
  'surface-4': 'hsl(200 24% 18%)',
  primary: 'hsl(188 100% 86%)',
  focus: 'hsl(190 92% 62%)',
  success: 'hsl(158 64% 52%)',
  warning: 'hsl(38 92% 50%)',
  danger: 'hsl(0 70% 55%)',
})

/**
 * The palette of the voice swarm (`@maunting/ui/swarm`), as HSL triplets like
 * `tokens.css` (`--mui-voice-*`). Glow and ice are the focus and primary
 * colours; think, fault and rest are the swarm's own.
 */
export const voiceTokens = Object.freeze({
  glow: '190 92% 62%',
  ice: '188 100% 86%',
  think: '203 100% 64%',
  fault: '38 92% 50%',
  rest: '205 18% 40%',
})

/**
 * The tone each swarm state glows in, as a key of `voiceTokens`. The swarm
 * mixes its colour from this table; whatever shows the same state beside it
 * (a status mark, a frame) takes its tone from here, so the two cannot drift.
 */
export const voiceStateTones = Object.freeze({
  off: 'rest',
  connecting: 'glow',
  ready: 'glow',
  listening: 'glow',
  thinking: 'think',
  working: 'think',
  speaking: 'glow',
  fault: 'fault',
  expired: 'rest',
})

/** Shared motion values. The CSS side lives in `styles.css`. */
export const muiMotion = Object.freeze({
  fast: 120,
  base: 180,
  slow: 240,
  easeOut: [0.22, 1, 0.36, 1] as const,
  easeIn: [0.4, 0, 1, 1] as const,
})
