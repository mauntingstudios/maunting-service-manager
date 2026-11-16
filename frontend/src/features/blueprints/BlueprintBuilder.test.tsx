import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlueprintBuilder } from './BlueprintBuilder'
import { validateBlueprintDraft, type BlueprintDraft } from './contract'
import i18n from '@/i18n'

function Harness({ mode = 'create' as const }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Editor öffnen</button>
      {open && <BlueprintBuilder mode={mode} entries={[]} onClose={() => setOpen(false)} onSaved={vi.fn().mockResolvedValue(undefined)} />}
    </>
  )
}

describe('BlueprintBuilder accessibility and responsive dialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('opens as a compact Design-DNA dialog with mobile sheet framing and accessible description', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleDescription(/niemals stillschweigend ersetzt/i)
    expect(dialog).toHaveClass('items-end', 'sm:items-center')

    const panel = screen.getByTestId('blueprint-builder-panel')
    expect(panel).toHaveClass('max-w-2xl', 'rounded-t-3xl', 'sm:rounded-panel')
    expect(panel).not.toHaveClass('h-[100dvh]')

    const nav = screen.getByRole('tablist', { name: /Blueprint-Abschnitte/i })
    expect(nav.querySelectorAll('[role="tab"]')).toHaveLength(6)
    expect(document.querySelectorAll('[title]')).toHaveLength(0)

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('auto-fills the identifier from the name until manually edited', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))

    const nameInput = screen.getByLabelText('Name')
    const idInput = screen.getByLabelText('Kennung') as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'Mein Palworld Server!' } })
    expect(idInput.value).toBe('mein_palworld_server')

    fireEvent.change(idInput, { target: { value: 'custom_palworld' } })
    fireEvent.change(nameInput, { target: { value: 'Anderer Name' } })
    expect(idInput.value).toBe('custom_palworld')
  })

  it('defers inline field errors until interaction or review', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))

    expect(screen.queryByRole('alert')).toBeNull()

    const nameInput = screen.getByLabelText('Name')
    fireEvent.blur(nameInput)
    expect(screen.getByText(/Bitte einen Namen/i)).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the opener', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Editor öffnen' })
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('supports all new categories and links review errors back to the matching tab', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))

    const category = screen.getByRole('button', { name: /Bereich/i })
    fireEvent.click(category)
    fireEvent.click(screen.getByRole('option', { name: /Web-App/i }))
    expect(category).toHaveTextContent(/Web-App/i)

    fireEvent.click(screen.getByRole('tab', { name: /Prüfen/i }))
    fireEvent.click(screen.getByRole('button', { name: /meta\.id/i }))
    expect(screen.getByRole('tab', { name: /Basis/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('lets users toggle runtime hardening switches such as allowTmpfsExec and user namespaces', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))
    fireEvent.click(screen.getByRole('tab', { name: /Start & Ports/i }))

    fireEvent.click(screen.getByText('Erweiterte Einstellungen'))
    const tmpfsSwitch = screen.getByRole('switch', { name: /Ausführen im Temp-Speicher erlauben/i })
    const usernsSwitch = screen.getByRole('switch', { name: /Verschachtelte User-Namespaces/i })

    expect(tmpfsSwitch).toHaveAttribute('aria-checked', 'true')
    expect(usernsSwitch).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(tmpfsSwitch)
    fireEvent.click(usernsSwitch)

    fireEvent.click(screen.getByRole('tab', { name: /Prüfen/i }))
    const json = JSON.parse(screen.getByText(/"allowTmpfsExec": false/).textContent ?? '{}')
    expect(json.runtime.allowTmpfsExec).toBe(false)
    expect(json.runtime.allowUnprivilegedUserNamespaces).toBe(true)
  })

  it('preserves process and recovery siblings when individual Guardian controls change', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))
    fireEvent.click(screen.getByRole('tab', { name: /Autopilot/i }))

    fireEvent.click(screen.getByRole('switch', { name: /Hauptprozess-Liveness erzwingen/i }))
    fireEvent.click(screen.getByText('Erweiterte Prüfparameter'))
    fireEvent.change(screen.getAllByLabelText('Prüf-Name')[0], { target: { value: 'main-process' } })
    fireEvent.click(screen.getByText('Automatische Reparaturregeln'))
    fireEvent.click(screen.getByRole('button', { name: 'Policy hinzufügen' }))

    fireEvent.click(screen.getByRole('tab', { name: /Prüfen/i }))
    const json = JSON.parse(screen.getByText(/"main-process"/).textContent ?? '{}')
    expect(json.health.process).toEqual({
      required: false,
      id: 'main-process',
      interval: '15s',
      failure_threshold: 1,
      success_threshold: 1,
      required_for_startup: true,
      required_for_verification: true,
    })
    expect(json.recovery).toMatchObject({
      policies: [{ match: 'port-conflict', action: 'restart' }],
      max_attempts: 3,
      attempt_window_seconds: 1800,
      cooldown_seconds: 300,
      verification: {
        minimum_healthy_duration_seconds: 30,
        required_consecutive_successes: 3,
        verification_timeout_seconds: 180,
      },
    })
  })

  it('removes an HTTP-only path when the application probe type changes but keeps its siblings', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))
    fireEvent.click(screen.getByRole('tab', { name: /Autopilot/i }))

    const type = screen.getByRole('button', { name: 'Status-Abfrage' })
    fireEvent.click(type)
    fireEvent.click(screen.getByRole('option', { name: /HTTP Ping/ }))
    fireEvent.change(screen.getByLabelText('HTTP-Pfad'), { target: { value: '/ready' } })
    fireEvent.click(screen.getByText('Erweiterte Prüfparameter'))
    fireEvent.change(screen.getByLabelText('Max. Antwortgröße (Bytes)'), { target: { value: '8192' } })
    fireEvent.click(type)
    fireEvent.click(screen.getByRole('option', { name: 'TCP' }))

    fireEvent.click(screen.getByRole('tab', { name: /Prüfen/i }))
    const json = JSON.parse(screen.getByText(/"max_response_bytes": 8192/).textContent ?? '{}')
    expect(json.health.application).toMatchObject({
      type: 'tcp',
      max_response_bytes: 8192,
      interval: '30s',
      timeout: '3s',
      failure_threshold: 3,
      success_threshold: 1,
    })
    expect(json.health.application).not.toHaveProperty('path')
  })

  it.each([
    /Minecraft \(Paper/,
    /SteamCMD Server/,
    /Node\.js/,
    /Autopilot ausschalten/,
  ])('creates a Guardian-valid preset for %s', (presetName) => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))
    fireEvent.click(screen.getByRole('tab', { name: /Autopilot/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage laden …' }))
    fireEvent.click(screen.getByRole('option', { name: presetName }))
    fireEvent.click(screen.getByRole('tab', { name: /Prüfen/i }))

    const draft = JSON.parse(screen.getByText(/"version": 1/).textContent ?? '{}') as BlueprintDraft
    const guardianIssues = validateBlueprintDraft(draft).filter(issue =>
      /^(health|logs|diagnostics|recovery|backups)/.test(issue.path),
    )
    expect(guardianIssues).toEqual([])
  })

  it('removes all Guardian blocks on opt-out and restores complete safe defaults on re-enable', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Editor öffnen' }))
    fireEvent.click(screen.getByRole('tab', { name: /Autopilot/i }))
    const toggle = screen.getByRole('switch', { name: /Autopilot für dieses Blueprint aktivieren/ })

    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('tab', { name: /Prüfen/i }))
    let json = JSON.parse(screen.getByText(/"version": 1/).textContent ?? '{}')
    for (const key of ['health', 'logs', 'diagnostics', 'recovery', 'backups']) {
      expect(json).not.toHaveProperty(key)
    }

    fireEvent.click(screen.getByRole('tab', { name: /Autopilot/i }))
    fireEvent.click(screen.getByRole('switch', { name: /Autopilot für dieses Blueprint aktivieren/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Prüfen/i }))
    json = JSON.parse(screen.getByText(/"version": 1/).textContent ?? '{}')
    expect(json.health.process).toMatchObject({ id: 'process', interval: '15s', required_for_verification: true })
    expect(json.recovery).toMatchObject({
      max_attempts: 3,
      verification: { required_consecutive_successes: 3 },
    })
    expect(validateBlueprintDraft(json)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringMatching(/^(health|logs|diagnostics|recovery|backups)/) }),
    ]))
  })
})
