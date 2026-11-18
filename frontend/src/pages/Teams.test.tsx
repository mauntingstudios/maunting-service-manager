import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/api/client'
import { teamsApi, type Team, type TeamDetail, type TeamInvitation } from '@/api/teams'
import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { confirm } from '@/stores/confirmStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { useRolePreviewStore } from '@/stores/rolePreviewStore'
import { toast } from '@/stores/toastStore'
import type { User } from '@/types'
import { Teams } from './Teams'

vi.mock('@/api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    getMediaGallery: vi.fn().mockResolvedValue([]),
    uploadMedia: vi.fn(),
    activateMedia: vi.fn(),
    setMediaPreset: vi.fn(),
    resetMedia: vi.fn(),
    deleteMediaItem: vi.fn(),
    inviteMember: vi.fn(),
    removeMember: vi.fn(),
    setServerGrants: vi.fn(),
    setServerGrantsBatch: vi.fn(),
    setServerRolesActive: vi.fn(),
    assignableServers: vi.fn(),
    invitations: vi.fn(),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
    listRoles: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    setMemberRoles: vi.fn(),
  },
}))

// Diese Datei prueft die Teamseite, nicht das Gedaechtnis — der eine Mock
// steht fuer alles, was die eingebetteten KI-Bauteile nebenher holen. Seit dem
// 19.08.2026 antwortet der Gedaechtnisweg aber mit einer **Seite** und nicht
// mehr mit einer Liste (ein Teambereich fasst jetzt bis zu 5.000 Eintraege,
// und jede Zeile kostet beim Oeffnen eine Entschluesselung). Ein pauschales
// `[]` liess `AiMemoryManager` deshalb an `seite.entries` auflaufen und nahm
// die halbe Seite mit — sichtbar als vier Tests, die ihre Beschriftungen nicht
// mehr fanden.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  const leereSeite = { entries: [], total: 0, clearable: 0, limit: 200 }
  return {
    ...actual,
    // Die Themen eines Bereichs sind eine Liste, keine Seite (Gedächtnis v2).
    api: vi.fn().mockImplementation(async (pfad: string) =>
      typeof pfad === 'string' && pfad.includes('/ai/memory/') && !pfad.includes('themen') ? leereSeite : []
    ),
  }
})

vi.mock('@/stores/confirmStore', () => ({ confirm: vi.fn().mockResolvedValue(true) }))
vi.mock('@/stores/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const personal: Team = {
  id: 1, name: 'einmalmaik', is_personal: true, owner_user_id: 1, is_owner: true,
  can_manage_skills: true, can_manage_memory: true, member_count: 1,
  created_at: '2026-08-09T10:00:00Z',
}

const real: Team = { ...personal, id: 2, name: 'Betrieb', is_personal: false, member_count: 2 }

const personalDetail: TeamDetail = { ...personal, members: [], servers: [], invitations: [], roles: [] }

/** Der offen Eingeladene: angeschrieben, aber kein Mitglied. */
const offeneEinladung: TeamInvitation = {
  team_id: 2, team_name: 'Betrieb', user_id: 3, username: 'neuer',
  invited_by_username: 'einmalmaik', team_role_id: 11, team_role_name: 'Mitglied',
  invited_at: '2026-08-23T10:00:00Z',
}

const realDetail: TeamDetail = {
  ...real,
  members: [
    { user_id: 1, username: 'einmalmaik', role: 'owner', joined_at: '2026-08-09T10:00:00Z' },
    { user_id: 2, username: 'kollege', role: 'member', joined_at: '2026-08-09T10:00:00Z' },
  ],
  servers: [{ server_id: 7, server_name: 'Valheim', permission_keys: ['server.view'] }],
  invitations: [offeneEinladung],
  roles: [
    {
      id: 10,
      team_id: 2,
      name: 'Admin',
      description: 'Volle Rechte',
      color: '#3b82f6',
      is_default: false,
      is_admin: true,
      created_at: '2026-08-09T10:00:00Z',
      permission_keys: [],
      server_grants: [],
      members_count: 1,
    },
    {
      id: 11,
      team_id: 2,
      name: 'Mitglied',
      description: 'Standard-Rechte',
      color: '#10b981',
      is_default: true,
      is_admin: false,
      created_at: '2026-08-09T10:00:00Z',
      permission_keys: ['ai.memory.read'],
      server_grants: [{ server_id: 7, server_name: 'Valheim', permission_keys: ['server.view'] }],
      members_count: 1,
    },
  ],
}

/** Eine Einladung an den angemeldeten Benutzer selbst — sein Weg ins Team. */
const eigeneEinladung: TeamInvitation = {
  team_id: 5, team_name: 'Nachtschicht', user_id: 1, username: 'einmalmaik',
  invited_by_username: 'chefin', team_role_id: 11, team_role_name: 'Mitglied',
  invited_at: '2026-08-23T11:00:00Z',
}

/**
 * Alle Benutzer des Panels: zwei Mitglieder, ein bereits Eingeladener
 * („neuer") und einer, den noch niemand gefragt hat („fremde"). Nur mit beiden
 * Nichtmitgliedern ist überhaupt prüfbar, dass die Auswahl den Eingeladenen
 * aussortiert und nicht einfach alles.
 */
const alleBenutzer = [
  { id: 1, username: 'einmalmaik' },
  { id: 2, username: 'kollege' },
  { id: 3, username: 'neuer' },
  { id: 4, username: 'fremde' },
]

function renderTeams() {
  return render(<MemoryRouter><Teams /></MemoryRouter>)
}

/** Teams startet direkt in der Ansicht der echten Teams. */
async function zuTeams() {
  // Kein Tab-Wechsel mehr nötig: Teams-Bereich ist jetzt primär
}

/**
 * Klappt ein Dropdown über sein aria-label auf. Die Optionen hängen per Portal
 * am Body und existieren erst im geöffneten Zustand — anders kommt man nicht an
 * sie heran.
 */
async function oeffneAuswahl(label: string) {
  const knopf = (await screen.findAllByLabelText(label))
    .find((element) => element.getAttribute('aria-haspopup') === 'listbox')
  expect(knopf).toBeDefined()
  fireEvent.click(knopf as HTMLElement)
}

/**
 * Vier Zusicherungen liegen hier übereinander.
 *
 * Die ältere ist die Obergrenze: die Serverauswahl darf nur zeigen, was der
 * Gründer selbst direkt hält — dieselbe Grenze, die `permission_service` bei
 * jedem Zugriff durchsetzt.
 *
 * Die neuere ist die Trennung: persönliches Wissen und Teamwissen sind zwei
 * Welten. Unter „Persönlich" stehen die eigenen Skills und **kein**
 * Gedächtnis — persönliche Erinnerungen gehören ins Profil, und bis vor Kurzem
 * zeigte diese Seite genau dieselbe Liste noch einmal.
 *
 * Die dritte ist die Einladung: eine Mitgliedschaft entsteht nie ohne den
 * Betroffenen. Der Gründer lädt ein, beitreten muss der Eingeladene — und die
 * Oberfläche muss beide Hälften zeigen, sonst meldet sie eine Aufnahme, die
 * nie stattfand, und dem Eingeladenen fehlt jeder Weg zuzusagen.
 *
 * Die jüngste zieht dieselbe Linie zweimal weiter: auch ein *angehobener*
 * Verwaltungsschalter braucht die Zusage des Betroffenen — die Meldung darf
 * ihn also nicht als gespeichert ausgeben, und die beiden Angebotsarten
 * gehören auseinander. Und wer nur mit eigener Zusage hineinkommt, muss ohne
 * fremde wieder hinaus: der Austritt gehört in jede eigene Zeile.
 */
describe('Teams', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    useRolePreviewStore.getState().stopPreview()
    // Wer angemeldet ist, entscheidet über eine Zeile der Mitgliederliste:
    // die eigene trägt „Team verlassen" statt „Mitglied entfernen".
    useAuthStore.setState({
      user: { id: 1, username: 'einmalmaik' } as User, isAuthenticated: true, isLoading: false,
    })
    usePermissionsStore.setState({
      me: {
        is_owner: false, role_id: null, role_name: null,
        // `users.read` gehört dazu, seit die Einladungsauswahl geprüft wird:
        // ohne dieses Recht holt die Seite die Benutzerliste gar nicht erst,
        // und die Auswahl, um die es geht, entsteht nie.
        global_keys: ['teams.create', 'ai.skills.use', 'ai.memory.use', 'users.read'],
        server_keys: {},
      },
      isLoading: false, error: null,
    })
    // Die Benutzerliste kommt aus `/admin/users` und muss echte Namen liefern:
    // ohne sie gäbe es keine Auswahl, gegen die die Einladungsfilterung
    // überhaupt prüfbar wäre.
    vi.mocked(api).mockImplementation((async (pfad: string) => {
      if (typeof pfad === 'string' && pfad.includes('/ai/memory/') && !pfad.includes('themen')) {
        return { entries: [], total: 0, clearable: 0, limit: 200 }
      }
      if (pfad === '/admin/users') return alleBenutzer
      return []
    }) as never)
    vi.mocked(teamsApi.list).mockReset().mockResolvedValue([real, personal])
    vi.mocked(teamsApi.get).mockReset().mockImplementation(async (id: number) =>
      (id === 1 ? personalDetail : realDetail))
    vi.mocked(teamsApi.assignableServers).mockReset().mockResolvedValue([
      { server_id: 7, server_name: 'Valheim', permission_keys: ['server.view', 'server.start'] },
    ])
    vi.mocked(teamsApi.getMediaGallery).mockReset().mockResolvedValue([])
    vi.mocked(teamsApi.inviteMember).mockReset().mockResolvedValue(realDetail)
    vi.mocked(teamsApi.invitations).mockReset().mockResolvedValue([])
    vi.mocked(teamsApi.acceptInvitation).mockReset().mockResolvedValue(realDetail)
    vi.mocked(teamsApi.declineInvitation).mockReset().mockResolvedValue(undefined)
    vi.mocked(teamsApi.removeMember).mockReset().mockResolvedValue(realDetail)
    vi.mocked(confirm).mockReset().mockResolvedValue(true)
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })

  it('bietet nur die Rechte an, die der Gründer selbst direkt hält', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    // Das Backend liefert für diesen Server nur zwei Schlüssel — genau die,
    // die der Gründer hält. Ein drittes Recht darf hier nicht auftauchen.
    await waitFor(() => expect(teamsApi.assignableServers).toHaveBeenCalledWith(2))
    fireEvent.click(screen.getByRole('tab', { name: /^Server/ }))
    const select = await screen.findByLabelText('Rechte: Valheim')
    expect(select).toBeInTheDocument()
    expect(screen.queryByText('server.console.exec')).not.toBeInTheDocument()
  })

  it('startet direkt in der Ansicht der echten Teams ohne Persönlich-Reiter', async () => {
    renderTeams()

    await screen.findByRole('heading', { name: 'Betrieb' })
    expect(screen.queryByRole('tab', { name: 'Persönlich' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Persönliches KI-Memory')).not.toBeInTheDocument()
  })

  it('führt das persönliche Team nicht in der Teamliste', async () => {
    renderTeams()
    await zuTeams()

    // „einmalmaik" ist der Name des persönlichen Teams. In der Team-Auswahl
    // hat es nichts verloren — es ist keins.
    expect(await screen.findByRole('heading', { name: 'Betrieb' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'einmalmaik' })).not.toBeInTheDocument()
  })

  it('zeigt die Mitglieder zuerst — Wissen und Server erst auf Klick', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    // Bis zum 27.09.2026 standen die Mitglieder als letzte Karte unter dem
    // ganzen KI-Wissen. Jetzt öffnet ein Team bei ihnen.
    expect(screen.getByRole('tab', { name: /Mitglieder/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByLabelText('Rollen & Rechte: kollege')).toBeInTheDocument()
    expect(screen.queryByLabelText('Skills verwalten: kollege')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Memory verwalten: einmalmaik')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tresorzugriff: kollege')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Wissen dieses Teams')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rechte: Valheim')).not.toBeInTheDocument()
  })

  it('bietet Nichtgründern keinen Server-Reiter an', async () => {
    const alsMitglied: TeamDetail = { ...realDetail, is_owner: false, invitations: [] }
    vi.mocked(teamsApi.list).mockResolvedValue([{ ...real, is_owner: false }, personal])
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      (id === 1 ? personalDetail : alsMitglied))
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    expect(screen.getByRole('tab', { name: /Mitglieder/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /^Server/ })).not.toBeInTheDocument()
  })

  it('erlaubt das Bearbeiten von Team-Name und Details mit Galerie-Triggern für Profilbild und Banner', async () => {
    vi.mocked(teamsApi.rename).mockResolvedValue({ ...real, name: 'Betrieb Neu' })
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    const editButtons = screen.getAllByLabelText('Team bearbeiten')
    fireEvent.click(editButtons[0])
    expect(await screen.findByDisplayValue('Betrieb')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Bild wählen' })).toHaveLength(2)
  })

  it('synchronisiert Teamdaten bei Echtzeit-Sync-Ereignis msm:sync-event', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    const listCallsBefore = vi.mocked(teamsApi.list).mock.calls.length
    const getCallsBefore = vi.mocked(teamsApi.get).mock.calls.length
    window.dispatchEvent(new CustomEvent('msm:sync-event', {
      detail: { type: 'team_updated', team_id: 2, scope: 'media:avatar' },
    }))

    await waitFor(() => {
      expect(vi.mocked(teamsApi.list).mock.calls.length).toBeGreaterThan(listCallsBefore)
      expect(vi.mocked(teamsApi.get).mock.calls.length).toBeGreaterThan(getCallsBefore)
    })
  })

  it('lädt ein, statt aufzunehmen — ohne alte Mitgliederschalter', async () => {
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      (id === 1 ? personalDetail : { ...realDetail, invitations: [] }))
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    await oeffneAuswahl('Mitglied einladen')
    fireEvent.click(await screen.findByRole('option', { name: 'neuer' }))
    const absenden = screen.getAllByRole('button', { name: 'Mitglied einladen' })
      .find((element) => element.getAttribute('aria-haspopup') !== 'listbox')
    fireEvent.click(absenden as HTMLElement)

    await waitFor(() => expect(teamsApi.inviteMember).toHaveBeenCalledWith(2, {
      user_id: 3,
    }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Benutzer eingeladen.'))
  })

  it('bietet einen bereits Eingeladenen nicht noch einmal zur Wahl an', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    // „neuer" hat eine offene Einladung, „fremde" nicht. Bliebe „neuer"
    // wählbar, klickte der Gründer dieselbe Einladung beliebig oft und sähe
    // nie einen Unterschied.
    await oeffneAuswahl('Mitglied einladen')
    const optionen = (await screen.findAllByRole('option')).map((element) => element.textContent)
    expect(optionen).toContain('fremde')
    expect(optionen).not.toContain('neuer')
  })

  it('führt Eingeladene getrennt von den Mitgliedern', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    expect(await screen.findByText('Offene Einladungen')).toBeInTheDocument()
    expect(screen.getByText('neuer')).toBeInTheDocument()
    expect(screen.getByText('wartet auf Zusage')).toBeInTheDocument()
    // Ein Eingeladener ist kein Mitglied: er hat keine Verwaltungsschalter,
    // und man kann ihn auch nicht entfernen.
    expect(screen.queryByLabelText('Skills verwalten: neuer')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Mitglied entfernen: neuer')).not.toBeInTheDocument()
  })

  it('lässt ein Mitglied selbst gehen', async () => {
    // Hinein führt seit dem 23.08.2026 nur die eigene Zusage — ohne den
    // Austritt käme niemand mehr heraus, denn der Knopf hing am Gründer.
    useAuthStore.setState({
      user: { id: 2, username: 'kollege' } as User, isAuthenticated: true, isLoading: false,
    })
    const alsMitglied: TeamDetail = { ...realDetail, is_owner: false, invitations: [] }
    vi.mocked(teamsApi.list).mockResolvedValue([{ ...real, is_owner: false }, personal])
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      (id === 1 ? personalDetail : alsMitglied))
    vi.mocked(teamsApi.removeMember).mockResolvedValue(alsMitglied)
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    // Fremde entlässt er nicht — nur sich selbst.
    expect(screen.queryByLabelText('Mitglied entfernen: einmalmaik')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByLabelText('Team verlassen'))

    // Dieselbe Rückfrage wie beim Teamlöschen: danach ist das Wissen des
    // Teams weg, und zurück geht es nur über eine neue Einladung.
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    await waitFor(() => expect(teamsApi.removeMember).toHaveBeenCalledWith(2, 2))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Du hast das Team verlassen.'))
  })

  it('bietet dem Gründer kein Verlassen an', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    // Der Gründer bleibt im Team — sein Konto ist die Obergrenze für alles,
    // was das Team weitergibt. Mitglieder entlässt er weiterhin.
    expect(screen.queryByLabelText('Team verlassen')).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Mitglied entfernen: kollege')).toBeInTheDocument()
  })

  it('zeigt die eigene Einladung und tritt auf Zusage bei', async () => {
    vi.mocked(teamsApi.invitations).mockResolvedValue([eigeneEinladung])
    renderTeams()

    // Ohne Klick auf „Teams": wer eine offene Einladung hat, soll sie sehen.
    // Genau der Benutzer, der noch keinem Team angehört, fände unter
    // „Persönlich" sonst nur den Hinweis, dass er keinem Team angehört.
    expect(await screen.findByText('Nachtschicht')).toBeInTheDocument()
    expect(screen.getByText('eingeladen von chefin')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Annehmen: Nachtschicht'))

    await waitFor(() => expect(teamsApi.acceptInvitation).toHaveBeenCalledWith(5))
    await waitFor(() => expect(screen.queryByText('Nachtschicht')).not.toBeInTheDocument())
  })

  it('lehnt eine Einladung ab, ohne beizutreten', async () => {
    vi.mocked(teamsApi.invitations).mockResolvedValue([eigeneEinladung])
    renderTeams()

    fireEvent.click(await screen.findByLabelText('Ablehnen: Nachtschicht'))

    await waitFor(() => expect(teamsApi.declineInvitation).toHaveBeenCalledWith(5))
    expect(teamsApi.acceptInvitation).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Nachtschicht')).not.toBeInTheDocument())
  })

  it('blendet das Gründen aus, wenn die Berechtigung fehlt', async () => {
    usePermissionsStore.setState({
      me: { is_owner: false, role_id: null, role_name: null, global_keys: [], server_keys: {} },
      isLoading: false, error: null,
    })
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    expect(screen.queryByLabelText('Teamname')).not.toBeInTheDocument()
  })

  it('zeigt den Rollen-Reiter und listet Rollen auf', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    const rolesTab = screen.getByRole('tab', { name: /Rollen/i })
    fireEvent.click(rolesTab)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mitglied' })).toBeInTheDocument()
    expect(screen.getByText('Volle Berechtigungen (Administrator)')).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
  })

  it('loescht eine Rolle nach Bestaetigung', async () => {
    vi.mocked(teamsApi.deleteRole).mockResolvedValue(undefined as any)
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    const rolesTab = screen.getByRole('tab', { name: /Rollen/i })
    fireEvent.click(rolesTab)

    const deleteBtn = await screen.findByLabelText('Rolle löschen: Admin')
    fireEvent.click(deleteBtn)

    await waitFor(() => expect(confirm).toHaveBeenCalled())
    await waitFor(() => expect(teamsApi.deleteRole).toHaveBeenCalledWith(2, 10))
  })

  it('schaltet Serverrechte nach Rollen als Gründer', async () => {
    vi.mocked(teamsApi.setServerRolesActive).mockResolvedValue({
      ...realDetail,
      server_roles_active: true,
    } as TeamDetail)
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    fireEvent.click(screen.getByRole('tab', { name: /Server/i }))
    const schalter = await screen.findByRole('switch', { name: 'Serverrechte nach Rollen' })
    fireEvent.click(schalter)

    await waitFor(() => expect(confirm).toHaveBeenCalled())
    await waitFor(() =>
      expect(teamsApi.setServerRolesActive).toHaveBeenCalledWith(2, true),
    )
  })

  it('öffnet das Rollen-Formular inline beim Klick auf Rolle erstellen und bricht ab', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    const rolesTab = screen.getByRole('tab', { name: /Rollen/i })
    fireEvent.click(rolesTab)

    const createBtn = await screen.findByRole('button', { name: 'Rolle erstellen' })
    fireEvent.click(createBtn)

    // Inline form should be displayed
    const nameInput = await screen.findByPlaceholderText('z. B. Moderator, Entwickler, Redakteur')
    expect(nameInput).toBeInTheDocument()

    // Cancel closes inline form
    const cancelBtn = screen.getByRole('button', { name: 'Abbrechen' })
    fireEvent.click(cancelBtn)

    expect(screen.queryByPlaceholderText('z. B. Moderator, Entwickler, Redakteur')).not.toBeInTheDocument()
  })

  it('zeigt an jedem Mitglied, wer gerade online ist', async () => {
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      id === 1 ? personalDetail : {
        ...realDetail,
        members: [
          { ...realDetail.members[0], presence: { status: 'online', device_type: 'web' } },
          { ...realDetail.members[1], presence: { status: 'away', device_type: 'desktop' } },
        ],
      })
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    expect(await screen.findByRole('img', { name: i18n.t('social.status.online') })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: i18n.t('social.status.away') })).toBeInTheDocument()
  })

  it('öffnet per Klick auf den Namen das Profil des Mitglieds', async () => {
    render(
      <MemoryRouter initialEntries={['/teams']}>
        <Routes>
          <Route path="/teams" element={<Teams />} />
          <Route path="/user/:userId" element={<div>Profilseite</div>} />
        </Routes>
      </MemoryRouter>
    )
    await screen.findByRole('heading', { name: 'Betrieb' })

    fireEvent.click(screen.getByRole('button', { name: 'kollege' }))
    expect(await screen.findByText('Profilseite')).toBeInTheDocument()
  })

  it('wählt Ansehen automatisch dazu, sobald ein Serverrecht steht', async () => {
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      id === 1 ? personalDetail : { ...realDetail, servers: [] })
    vi.mocked(teamsApi.setServerGrants).mockResolvedValue({ ...realDetail, servers: [] })
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    fireEvent.click(screen.getByRole('tab', { name: /^Server/ }))
    fireEvent.click(await screen.findByLabelText('Rechte: Valheim'))
    fireEvent.click(await screen.findByRole('option', { name: 'Server starten' }))

    await waitFor(() => expect(teamsApi.setServerGrants).toHaveBeenCalledWith(2, {
      server_id: 7,
      permission_keys: ['server.start', 'server.view'],
    }))
  })

  it('zeigt im Rollenmodus je Server einen eingeklappten Read-Only-Überblick ohne doppelte Bearbeitung', async () => {
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      id === 1 ? personalDetail : { ...realDetail, server_roles_active: true })
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    fireEvent.click(screen.getByRole('tab', { name: /^Server/ }))
    expect(await screen.findByText(i18n.t('teams.serverRollenHinweis'))).toBeInTheDocument()

    // Keine doppelte Rollenbearbeitung und kein Sync-Button im Rollenmodus
    expect(screen.queryByLabelText('Rechte: Valheim')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rollen & Rechte: Valheim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('teams.syncToAllServers') })).not.toBeInTheDocument()

    // Standardmäßig eingeklappt: Detail-Vorschau noch nicht sichtbar, aber Pill mit Rechtezahl sichtbar
    expect(screen.queryByText(i18n.t('teams.rolePermissionsReadOnlyHint'))).not.toBeInTheDocument()
    const pillButton = screen.getByRole('button', { name: /Mitglied.*1 Rechte/i })
    expect(pillButton).toHaveAttribute('aria-expanded', 'false')

    // Klick klappt schreibgeschützte Vorschau auf und führt bei Klick direkt in „Rollen & Rechte“
    fireEvent.click(pillButton)
    expect(pillButton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(i18n.t('teams.rolePermissionsReadOnlyHint'))).toBeInTheDocument()
    expect(within(screen.getByLabelText('Rechte: Valheim (Mitglied)')).getByText('Server anzeigen')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('teams.editRoleInRolesTab') }))
    expect(await screen.findByText(/Rolle bearbeiten: Mitglied/)).toBeInTheDocument()
    expect(teamsApi.updateRole).not.toHaveBeenCalled()
  })

  it('synchronisiert Serverrechte im Standard-Modus per Batch-API nach Rückfrage', async () => {
    const zweiServer = [
      { server_id: 7, server_name: 'Valheim', permission_keys: ['server.view', 'server.start'] },
      { server_id: 8, server_name: 'Rust', permission_keys: ['server.view', 'server.stop'] },
    ]
    const mitZweiServern: TeamDetail = {
      ...realDetail,
      servers: [
        { server_id: 7, server_name: 'Valheim', permission_keys: ['server.view', 'server.start'] },
        { server_id: 8, server_name: 'Rust', permission_keys: ['server.view', 'server.stop'] },
      ],
    }
    vi.mocked(teamsApi.assignableServers).mockResolvedValue(zweiServer)
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      id === 1 ? personalDetail : mitZweiServern)
    vi.mocked(teamsApi.setServerGrantsBatch).mockResolvedValue(mitZweiServern)

    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    fireEvent.click(screen.getByRole('tab', { name: /^Server/ }))
    const syncButtons = await screen.findAllByRole('button', { name: i18n.t('teams.syncToAllServers') })
    fireEvent.click(syncButtons[0])

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
        title: i18n.t('teams.syncPermissionsConfirmTitle'),
      }))
      expect(teamsApi.setServerGrantsBatch).toHaveBeenCalledWith(2, {
        grants: [
          { server_id: 7, permission_keys: ['server.view', 'server.start'] },
          { server_id: 8, permission_keys: ['server.view'] },
        ],
      })
    })
  })

  it('zeigt bei Rollen in „Rollen & Rechte“ direkt die zugewiesenen Servernamen an', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    fireEvent.click(screen.getByRole('tab', { name: /Rollen/i }))
    expect(await screen.findByText('Valheim')).toBeInTheDocument()
  })

  it('startet beim Klick auf eine Team-Rolle die Vorschau und passt die Team-Oberfläche an', async () => {
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    // Als Gründer ist der Server-Reiter zunächst sichtbar
    expect(screen.getByRole('tab', { name: /^Server/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Rollen/i }))
    const previewBtn = await screen.findByRole('button', { name: 'Mit Rolle betrachten: Mitglied' })
    fireEvent.click(previewBtn)

    // In der Vorschau der Rolle „Mitglied“ (ohne team.servers.manage / team.roles.manage)
    // verschwinden der Server-Reiter und die Rollen-Bearbeitungsknöpfe sofort
    expect(screen.queryByRole('tab', { name: /^Server/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rolle erstellen' })).not.toBeInTheDocument()
    expect(useRolePreviewStore.getState().preview).toMatchObject({
      kind: 'team',
      teamId: 2,
      roleId: 11,
      roleName: 'Mitglied',
    })
  })

  it('rendert Rollen in schreibgeschützten Mitgliederzeilen einmalig als RoleBadge ohne Duplikate', async () => {
    vi.mocked(teamsApi.get).mockResolvedValue({
      ...realDetail,
      members: [
        {
          ...realDetail.members[0],
          roles: [realDetail.roles![0]],
        },
        realDetail.members[1],
      ],
    })
    renderTeams()
    await zuTeams()

    const ownerButton = await screen.findByRole('button', { name: 'einmalmaik' })
    const ownerRow = ownerButton.closest('li')!
    expect(within(ownerRow).getAllByText('Admin')).toHaveLength(1)
  })

  it('zeigt im Rollenmodus direkt zugewiesene Rollen am Server als klickbare Pills an', async () => {
    vi.mocked(teamsApi.get).mockImplementation(async (id: number) =>
      (id === 1 ? personalDetail : { ...realDetail, server_roles_active: true }))
    renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    fireEvent.click(screen.getByRole('tab', { name: /^Server/ }))

    // Kompakt eingeklappt: direkt sichtbar, welche Rolle auf Valheim Rechte hält (Admin bleibt ausgeblendet)
    expect(await screen.findByText('1 Rechte')).toBeInTheDocument()
    expect(screen.getByText('1 Rollen')).toBeInTheDocument()
    expect(screen.getByText('Mitglied')).toBeInTheDocument()
  })

  it('rendert die Team-Tab-Leiste freischwebend ohne deckenden Trennbalken', async () => {
    const { container } = renderTeams()
    await zuTeams()
    await screen.findByRole('heading', { name: 'Betrieb' })

    expect(container.querySelector('.border-y.border-outline-variant\\/30.bg-surface\\/85')).toBeNull()
  })
})
