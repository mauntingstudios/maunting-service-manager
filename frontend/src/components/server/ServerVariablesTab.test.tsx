import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import type { ServerVariablesResponse } from '@/api/serverVariables'

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/api/serverVariables', () => ({
  serverVariablesApi: {
    get: hoisted.get,
    update: hoisted.update,
  },
}))

import { ServerVariablesTab } from './ServerVariablesTab'

const MOCK_RESPONSE: ServerVariablesResponse = {
  server_id: 42,
  game_type: 'discord_bot_node',
  blueprint_name: 'Discord Bot (Node.js 22)',
  has_variables: true,
  is_running: true,
  source_type: 'dockerOnly',
  upload_hint: null,
  variables: [
    {
      key: 'NODE_ENV',
      label: 'Node-Umgebung',
      description: null,
      group: 'version',
      type: 'select',
      default: 'production',
      value: 'production',
      is_set: true,
      has_override: false,
      options: [
        { value: 'production', label: 'Produktion (production)', badge: 'Empfohlen' },
        { value: 'development', label: 'Entwicklung (development)', badge: null },
      ],
      allow_custom: true,
      placeholder: null,
      required: false,
      customer_editable: true,
      min: null,
      max: null,
      pattern: null,
      requires_restart: true,
    },
    {
      key: 'GIT_REPO_URL',
      label: 'GitHub-Repository-URL',
      description: 'Optional GitHub repo.',
      group: 'deployment',
      type: 'git_url',
      default: '',
      value: '',
      is_set: false,
      has_override: false,
      options: [],
      allow_custom: false,
      placeholder: 'https://github.com/benutzer/bot',
      required: false,
      customer_editable: true,
      min: null,
      max: null,
      pattern: null,
      requires_restart: true,
    },
    {
      key: 'DISCORD_TOKEN',
      label: 'Discord Bot Token',
      description: 'DIS-encrypted token.',
      group: 'security',
      type: 'secret',
      default: '',
      value: '',
      is_set: true,
      has_override: true,
      options: [],
      allow_custom: false,
      placeholder: null,
      required: true,
      customer_editable: true,
      min: null,
      max: null,
      pattern: null,
      requires_restart: true,
    },
    {
      key: 'BOT_ENTRY_FILE',
      label: 'Startdatei',
      description: null,
      group: 'general',
      type: 'string',
      default: 'index.js',
      value: 'index.js',
      is_set: true,
      has_override: false,
      options: [],
      allow_custom: false,
      placeholder: null,
      required: false,
      customer_editable: true,
      min: null,
      max: null,
      pattern: null,
      requires_restart: true,
    },
  ],
}

describe('ServerVariablesTab', () => {
  beforeEach(() => {
    hoisted.get.mockReset().mockResolvedValue(MOCK_RESPONSE)
    hoisted.update.mockReset().mockResolvedValue({
      variables: {
        ...MOCK_RESPONSE,
        variables: MOCK_RESPONSE.variables.map((v) =>
          v.key === 'BOT_ENTRY_FILE' ? { ...v, value: 'dist/bot.js', has_override: true } : v,
        ),
      },
      changed_keys: ['BOT_ENTRY_FILE'],
      restart_recommended: true,
    })
  })

  it('zeigt Gruppierung, maskiertes Secret, Upload-Banner und speichert geaenderte Felder', async () => {
    const onOpenFiles = vi.fn()
    const onRestart = vi.fn()

    render(
      <ServerVariablesTab
        serverId={42}
        canEdit={true}
        onOpenFiles={onOpenFiles}
        onRestart={onRestart}
      />,
    )

    expect(await screen.findByText('Discord Bot Token')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('serverVariables.gesetzt'))).toBeInTheDocument()

    // Datei-Tab Quickstart Banner
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('serverVariables.dateiTabOeffnen') }),
    )
    expect(onOpenFiles).toHaveBeenCalledTimes(1)

    // Feld aendern -> Sticky Save Bar erscheint und sendet NUR die geaenderte Variable
    const entryInput = screen.getByLabelText('Startdatei')
    fireEvent.change(entryInput, { target: { value: 'dist/bot.js' } })

    const saveBtn = screen.getByRole('button', { name: i18n.t('serverVariables.speichern') })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(hoisted.update).toHaveBeenCalledWith(42, { BOT_ENTRY_FILE: 'dist/bot.js' })
    })

    // Neustart-Banner nach Speichern
    const restartBtn = await screen.findByRole('button', {
      name: i18n.t('serverVariables.jetztNeustarten'),
    })
    fireEvent.click(restartBtn)
    expect(onRestart).toHaveBeenCalledTimes(1)
  })
})
