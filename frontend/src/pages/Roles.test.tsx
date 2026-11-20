/**
 * Das Muster fuer Rollennamen — in der Sprache des Browsers und des Backends.
 *
 * Anlass ist eine Meldung vom 18.08.2026: die Rollenmaske warf beim Tippen
 *
 *   Pattern attribute value ^[a-zA-Z0-9_-]+$ is not a valid regular
 *   expression: Invalid character in character class
 *
 * Chrome uebersetzt `pattern` mit dem `v`-Flag (RegExp v-mode). Dort ist der
 * Bindestrich in einer Zeichenklasse ein reserviertes Zeichen und muss
 * maskiert werden. Ein `pattern`, das der Browser nicht uebersetzen kann,
 * wird nicht grosszuegig ausgelegt — es faellt **ganz** aus. Die Maske liess
 * damit jeden Namen durch, und das Backend wies ihn danach mit 422 ab.
 *
 * Diese Datei prueft beide Richtungen, weil ein Fix nur einer Seite den
 * Fehler bloss verschiebt:
 *   1. der Browser kann das Muster uebersetzen (auch im strengen `v`-Modus),
 *   2. es beschreibt dieselbe Menge wie `backend/schemas/role.py`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ROLLENNAME_MUSTER, Roles } from './Roles'
import { rbacApi } from '@/api/rbac'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { useRolePreviewStore } from '@/stores/rolePreviewStore'
import i18n from '@/i18n'

vi.mock('@/api/rbac', () => ({
  rbacApi: {
    catalog: vi.fn(),
    listRoles: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
  },
}))

// Woertlich aus `backend/schemas/role.py`. Bewusst kopiert und nicht
// importiert — es ist die *fremde* Seite des Vertrags, und wenn sie sich
// aendert, soll dieser Test rot werden statt stillschweigend mitzuwandern.
const BACKEND_MUSTER = /^[a-zA-Z0-9_-]+$/

describe('Rollenname-Muster', () => {
  it('laesst sich im strengen v-Modus uebersetzen', () => {
    // Genau der Aufruf, an dem Chrome gescheitert ist. `new RegExp(..., 'v')`
    // wirft bei einem unmaskierten Bindestrich in der Zeichenklasse.
    expect(() => new RegExp(ROLLENNAME_MUSTER, 'v')).not.toThrow()
  })

  it('laesst sich auch ohne v-Modus uebersetzen', () => {
    // Aeltere Browser und Firefox uebersetzen ohne `v`. Die Maskierung darf
    // dort nicht zu einer anderen Bedeutung fuehren.
    expect(() => new RegExp(ROLLENNAME_MUSTER)).not.toThrow()
  })

  it.each([
    ['KI-Nutzung', true],
    ['admin', true],
    ['team_lead', true],
    ['A1', true],
    ['---', true],
    ['mit leerzeichen', false],
    ['punkt.name', false],
    ['umlaut-ä', false],
    ['', false],
  ])('beurteilt %j wie das Backend', (name, erwartet) => {
    const browser = new RegExp(ROLLENNAME_MUSTER, 'v')
    expect(browser.test(name)).toBe(erwartet)
    // Und dieselbe Antwort gibt das Backend. Ein Muster, das strenger oder
    // lockerer waere als `schemas/role.py`, hiesse: die Maske sagt ja und der
    // Server sagt 422 — oder die Maske sperrt einen Namen, den der Server
    // angenommen haette.
    expect(BACKEND_MUSTER.test(name)).toBe(erwartet)
  })

  it('nimmt den Bindestrich an, an dem der Fehler haing', () => {
    // Der konkrete Name aus der Meldung. Ohne den Fix kam er gar nicht erst
    // zur Pruefung, weil das Muster vorher zerbrach.
    expect(new RegExp(ROLLENNAME_MUSTER, 'v').test('KI-Nutzung')).toBe(true)
  })
})

describe('Roles Vorschau-Modus', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    useRolePreviewStore.getState().stopPreview()
    usePermissionsStore.setState({
      me: { is_owner: true, role_id: 1, role_name: 'admin', global_keys: ['roles.manage'], server_keys: {} },
      isLoading: false,
      error: null,
    })
    vi.mocked(rbacApi.catalog).mockReset().mockResolvedValue({
      global_permissions: [{ key: 'users.read', group: 'users', label: 'Benutzer lesen' }],
      server_permissions: [{ key: 'server.view', group: 'server', label: 'Server sehen' }],
    })
    vi.mocked(rbacApi.listRoles).mockReset().mockResolvedValue([
      {
        id: 2,
        name: 'user',
        description: 'Standard',
        color: '#64748b',
        icon: null,
        is_system: true,
        permissions: ['server.view'],
        created_at: '2026-10-01T00:00:00Z',
      },
    ])
  })

  it('startet beim Klick auf eine Panel-Rolle die Rollenvorschau und wechselt aufs Dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/roles']}>
        <Routes>
          <Route path="/roles" element={<Roles />} />
          <Route path="/" element={<div>Dashboard-Ansicht</div>} />
          <Route path="/dashboard" element={<div>Dashboard-Ansicht</div>} />
        </Routes>
      </MemoryRouter>,
    )

    const roleButton = await screen.findByRole('button', { name: 'Mit Rolle betrachten: User' })
    fireEvent.click(roleButton)

    await waitFor(() => {
      expect(screen.getByText('Dashboard-Ansicht')).toBeInTheDocument()
    })
    const preview = useRolePreviewStore.getState().preview
    expect(preview).toMatchObject({
      kind: 'panel',
      roleId: 2,
      roleName: 'user',
      permissions: ['server.view'],
    })
  })
})
