/**
 * Die Aufgabenliste.
 *
 * Sie ist das Versprechen „alles, was die KI kann, kann der Benutzer auch" als
 * Oberfläche: dieselben Dienstfunktionen, nur ohne Chat. Die Zusagen, die hier
 * als Tests stehen, sind die, die sich mit einer unauffälligen Zeile verlieren
 * ließen — Teilangaben beim Pausieren (sonst überschreibt ein Schalterklick
 * den ganzen Plan), die Bestätigung vor dem Löschen und die Adresse des
 * Hintergrundfensters, in der nur die UUID stehen darf.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aiApi, type AiTaskEntry } from '@/api/ai'
import { teamsApi, type Team } from '@/api/teams'
import i18n from '@/i18n'
import { confirm } from '@/stores/confirmStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { AufgabenAnsicht } from './AufgabenAnsicht'

vi.mock('@/api/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/ai')>()
  return {
    ...original,
    aiApi: {
      listTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
    },
  }
})

vi.mock('@/api/teams', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/teams')>()
  return {
    ...original,
    teamsApi: {
      ...original.teamsApi,
      list: vi.fn(),
    },
  }
})

vi.mock('@/stores/confirmStore', () => ({
  confirm: vi.fn(),
}))

const teamEintrag = (over: Partial<Team> = {}): Team => ({
  id: 7,
  name: 'Team Alpha',
  is_personal: false,
  owner_user_id: 1,
  is_owner: true,
  can_manage_skills: true,
  can_manage_memory: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
})

const aufgabe = (over: Partial<AiTaskEntry> = {}): AiTaskEntry => ({
  task_id: 'aufgabe-1',
  scope: 'personal',
  team_id: null,
  team_name: null,
  created_by: null,
  updated_by: null,
  title: 'Morgens Logs prüfen',
  instruction: 'Prüf die Logs aller Server auf Fehler.',
  kind: 'report',
  plan: 'täglich 08:00 (Europe/Berlin)',
  plan_kind: 'daily',
  time_of_day: '08:00',
  weekdays: null,
  interval_hours: null,
  once_at: null,
  timezone: 'Europe/Berlin',
  channel: 'chat',
  enabled: true,
  conversation_id: 'fenster-1',
  next_run: '2026-08-21T06:00:00Z',
  last_started: null,
  ...over,
})

function zeichnen(url = '/ai?ansicht=aufgaben') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AufgabenAnsicht />
    </MemoryRouter>,
  )
}

describe('AufgabenAnsicht', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    usePermissionsStore.setState({ me: null })
    vi.mocked(aiApi.listTasks).mockReset().mockResolvedValue([])
    vi.mocked(aiApi.createTask).mockReset().mockResolvedValue(aufgabe())
    vi.mocked(aiApi.updateTask).mockReset().mockResolvedValue(aufgabe())
    vi.mocked(aiApi.deleteTask).mockReset().mockResolvedValue({ deleted: true, title: '' })
    vi.mocked(teamsApi.list).mockReset().mockResolvedValue([])
    vi.mocked(confirm).mockReset().mockResolvedValue(true)
  })

  it('zeigt die Aufgaben mit Name und Plan', async () => {
    vi.mocked(aiApi.listTasks).mockResolvedValue([aufgabe()])

    zeichnen()

    expect(await screen.findByText('Morgens Logs prüfen')).toBeInTheDocument()
    // Die Anzeige entsteht aus den strukturierten Feldern (beide Sprachen),
    // nicht aus dem deutschen `plan`-Satz des Backends.
    expect(screen.getByText('Täglich um 08:00 (Europe/Berlin)')).toBeInTheDocument()
  })

  it('sagt in der leeren Liste, wie es weitergeht', async () => {
    zeichnen()

    expect(await screen.findByText(i18n.t('ai.tasks.emptyTitle'))).toBeInTheDocument()
  })

  it('legt eine Aufgabe mit den drei Angaben an', async () => {
    zeichnen()
    await waitFor(() => expect(aiApi.listTasks).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Neue Aufgabe/ }))
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.name')), {
      target: { value: 'Backup am Morgen' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.prompt')), {
      target: { value: 'Mach ein Backup von allen Servern.' },
    })
    const uhrzeitButton = screen.getByRole('button', { name: i18n.t('ai.tasks.timeOfDay') })
    fireEvent.click(uhrzeitButton)
    fireEvent.click(await screen.findByRole('option', { name: '07:30' }))
    const tzButton = screen.getByRole('button', { name: i18n.t('ai.tasks.timezone') })
    fireEvent.click(tzButton)
    fireEvent.click(await screen.findByRole('option', { name: 'Europe/Berlin' }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.tasks.create') }))

    await waitFor(() => expect(aiApi.createTask).toHaveBeenCalledTimes(1))
    expect(vi.mocked(aiApi.createTask).mock.calls[0][0]).toEqual({
      scope: 'personal',
      title: 'Backup am Morgen',
      instruction: 'Mach ein Backup von allen Servern.',
      kind: 'report',
      channel: 'both',
      timezone: 'Europe/Berlin',
      plan_kind: 'daily',
      time_of_day: '07:30',
      weekdays: [],
    })
  })

  it('legt eine Intervall-Aufgabe über das Dropdown-Menü an', async () => {
    zeichnen()
    await waitFor(() => expect(aiApi.listTasks).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Neue Aufgabe/ }))
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.name')), {
      target: { value: 'Stündliche Logs' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.prompt')), {
      target: { value: 'Logs prüfen' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.tasks.planKindInterval') }))
    const intervallButton = screen.getByRole('button', { name: i18n.t('ai.tasks.intervalHours') })
    fireEvent.click(intervallButton)
    fireEvent.click(await screen.findByRole('option', { name: i18n.t('ai.tasks.planInterval', { count: 6 }) }))
    const tzButton2 = screen.getByRole('button', { name: i18n.t('ai.tasks.timezone') })
    fireEvent.click(tzButton2)
    fireEvent.click(await screen.findByRole('option', { name: 'Europe/Berlin' }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.tasks.create') }))

    await waitFor(() => expect(aiApi.createTask).toHaveBeenCalledTimes(1))
    expect(vi.mocked(aiApi.createTask).mock.calls[0][0]).toEqual({
      scope: 'personal',
      title: 'Stündliche Logs',
      instruction: 'Logs prüfen',
      kind: 'report',
      channel: 'both',
      timezone: 'Europe/Berlin',
      plan_kind: 'interval',
      interval_hours: 6,
    })
  })

  it('pausiert mit einer Teilangabe statt den ganzen Plan zu schicken', async () => {
    // Das Backend fasst nur an, was genannt ist (`exclude_unset`). Schickte
    // der Schalter das ganze Formular mit, würde jeder Klick den Plan neu
    // schreiben — und bei einer `act`-Aufgabe ohne autonome Freigabe sogar
    // scheitern, obwohl niemand etwas geändert hat.
    vi.mocked(aiApi.listTasks).mockResolvedValue([aufgabe()])
    vi.mocked(aiApi.updateTask).mockResolvedValue(aufgabe({ enabled: false }))

    zeichnen()

    fireEvent.click(await screen.findByRole('switch', { name: i18n.t('ai.tasks.enabledAria') }))
    await waitFor(() => expect(aiApi.updateTask).toHaveBeenCalledTimes(1))
    expect(vi.mocked(aiApi.updateTask).mock.calls[0]).toEqual([
      'aufgabe-1', { enabled: false },
    ])
    // Der neue Zustand steht sichtbar in der Liste — auch eine von der KI
    // (oder einer manuellen Zeitplan-Änderung) pausierte Aufgabe sähe so aus.
    expect(await screen.findByText(i18n.t('ai.tasks.paused'))).toBeInTheDocument()
  })

  it('löscht nicht ohne Bestätigung', async () => {
    vi.mocked(aiApi.listTasks).mockResolvedValue([aufgabe()])
    vi.mocked(confirm).mockResolvedValue(false)

    zeichnen()

    fireEvent.click(await screen.findByRole('button', { name: /Löschen/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(aiApi.deleteTask).not.toHaveBeenCalled()
  })

  it('löscht nach Bestätigung und nimmt die Zeile aus der Liste', async () => {
    vi.mocked(aiApi.listTasks).mockResolvedValue([aufgabe()])

    zeichnen()

    fireEvent.click(await screen.findByRole('button', { name: /Löschen/ }))
    await waitFor(() => expect(aiApi.deleteTask).toHaveBeenCalledWith('aufgabe-1'))
    await waitFor(() => {
      expect(screen.queryByText('Morgens Logs prüfen')).toBeNull()
    })
  })

  it('verlinkt das Hintergrundfenster nur über die UUID', async () => {
    // Keine sensiblen Daten in URLs: in der Adresse steht die Kennung des
    // Fensters, nie Titel oder Auftragstext.
    vi.mocked(aiApi.listTasks).mockResolvedValue([aufgabe()])

    zeichnen()

    const link = await screen.findByRole('link', { name: i18n.t('ai.tasks.openWindow') })
    expect(link).toHaveAttribute('href', '/ai?ansicht=worker&id=fenster-1')
  })

  it('zeigt ohne Fenster keinen Verlaufslink', async () => {
    vi.mocked(aiApi.listTasks).mockResolvedValue([aufgabe({ conversation_id: null })])

    zeichnen()

    expect(await screen.findByText('Morgens Logs prüfen')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('ai.tasks.openWindow') })).toBeNull()
  })

  it('ermöglicht Team-Auswahl aus mehreren echten Teams ohne Global-Recht', async () => {
    vi.mocked(teamsApi.list).mockResolvedValue([
      teamEintrag({ id: 1, name: 'Privat', is_personal: true }),
      teamEintrag({ id: 7, name: 'Team Alpha', is_personal: false }),
      teamEintrag({ id: 9, name: 'Team Beta', is_personal: false }),
    ])

    zeichnen()
    await waitFor(() => expect(teamsApi.list).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /Neue Aufgabe/ }))
    const bereichBtn = await screen.findByRole('button', { name: i18n.t('ai.tasks.scopeLabel') })
    fireEvent.click(bereichBtn)

    expect(await screen.findByRole('option', { name: 'Team: Team Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Team: Team Beta' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: i18n.t('ai.tasks.scopeGlobal') })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Team: Privat' })).toBeNull()

    fireEvent.click(screen.getByRole('option', { name: 'Team: Team Alpha' }))
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.name')), {
      target: { value: 'Team Backup' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.prompt')), {
      target: { value: 'Teamserver sichern.' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.tasks.create') }))

    await waitFor(() => expect(aiApi.createTask).toHaveBeenCalledTimes(1))
    expect(vi.mocked(aiApi.createTask).mock.calls[0][0]).toMatchObject({
      scope: 'team',
      team_id: 7,
      title: 'Team Backup',
    })
  })

  it('aktiviert mit Global-Recht und ?scope=global den Panelweit-Filter und Standard', async () => {
    usePermissionsStore.setState({
      me: {
        is_owner: false,
        role_id: 2,
        role_name: 'Redaktion',
        global_keys: ['ai.tasks.manage', 'ai.tasks.manage_global'],
        server_keys: {},
      },
    })
    vi.mocked(aiApi.listTasks).mockResolvedValue([
      aufgabe({ task_id: 'p1', scope: 'personal', title: 'Privat-Check' }),
      aufgabe({
        task_id: 'g1',
        scope: 'global',
        title: 'Weltnews prüfen',
        created_by: 'admin',
      }),
    ])

    zeichnen('/ai?bereich=tools&tool=tasks&scope=global')

    expect(await screen.findByText('Weltnews prüfen')).toBeInTheDocument()
    expect(screen.queryByText('Privat-Check')).toBeNull()
    expect(screen.getByText(/Von admin/)).toBeInTheDocument()

    // Zurück auf Alle zeigt beide Aufgaben inklusive Scope-Badges
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.tasks.filterAll') }))
    expect(screen.getByText('Privat-Check')).toBeInTheDocument()

    // Zurück auf Panelweit und Neue Aufgabe -> global vorausgewählt
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.tasks.filterGlobal') }))
    fireEvent.click(screen.getByRole('button', { name: /Neue Aufgabe/ }))
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.name')), {
      target: { value: 'Pop-up-Check' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('ai.tasks.prompt')), {
      target: { value: 'News prüfen.' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('ai.tasks.create') }))

    await waitFor(() => expect(aiApi.createTask).toHaveBeenCalledTimes(1))
    expect(vi.mocked(aiApi.createTask).mock.calls[0][0]).toMatchObject({
      scope: 'global',
      title: 'Pop-up-Check',
    })
  })
})
