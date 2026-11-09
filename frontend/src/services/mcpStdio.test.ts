import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { entdeckeStdioWerkzeuge, stdioVerfuegbar } from './mcpStdio'

describe('mcpStdio', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('meldet die Desktop-App nur mit der Tauri-Brücke', () => {
    expect(stdioVerfuegbar()).toBe(false)
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    expect(stdioVerfuegbar()).toBe(true)
  })

  it('übernimmt nur benannte, begrenzte Werkzeuge', async () => {
    invoke.mockResolvedValue({
      antworten: [
        { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
        {
          jsonrpc: '2.0',
          id: 2,
          result: {
            tools: [
              {
                name: 'echo',
                description: 'Gibt zurück',
                inputSchema: { type: 'object', properties: {} },
                annotations: { readOnlyHint: true },
              },
              { name: '', inputSchema: { type: 'object' } },
              {
                name: 'riesig',
                inputSchema: { type: 'object', beschreibung: 'x'.repeat(70 * 1024) },
              },
            ],
          },
        },
      ],
    })

    const werkzeuge = await entdeckeStdioWerkzeuge('npx', ['-y', 'server'])

    expect(werkzeuge).toEqual([
      {
        name: 'echo',
        beschreibung: 'Gibt zurück',
        nur_lesen: true,
        schema: { type: 'object', properties: {} },
      },
    ])
    expect(invoke).toHaveBeenCalledWith('mcp_stdio', {
      anfrage: expect.objectContaining({
        command: 'npx',
        args: ['-y', 'server'],
        frist_ms: 30_000,
        nachrichten: expect.arrayContaining([
          expect.objectContaining({ method: 'initialize' }),
          expect.objectContaining({ method: 'notifications/initialized' }),
          expect.objectContaining({ method: 'tools/list' }),
        ]),
      }),
    })
  })

  it('sagt es, wenn keine Werkzeugliste kommt', async () => {
    invoke.mockResolvedValue({
      antworten: [{ jsonrpc: '2.0', id: 1, result: {} }],
    })
    await expect(entdeckeStdioWerkzeuge('npx', [])).rejects.toThrow('keine Werkzeugliste')
  })
})
