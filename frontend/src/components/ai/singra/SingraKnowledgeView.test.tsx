import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aiApi, type AiSkillManaged } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { teamsApi, type Team } from '@/api/teams'
import i18n from '@/i18n'
import { toast } from '@/stores/toastStore'
import { SingraKnowledgeView } from './SingraKnowledgeView'

vi.mock('@/api/ai', () => ({
  aiApi: {
    listSkills: vi.fn(),
    listManagedSkills: vi.fn(),
    saveSkill: vi.fn(),
    deleteSkill: vi.fn(),
    toggleSkill: vi.fn(),
    toggleSkillAlwaysActive: vi.fn(),
    approveSkill: vi.fn(),
  },
}))
vi.mock('@/api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
  },
}))
vi.mock('@/stores/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/stores/confirmStore', () => ({ confirm: vi.fn() }))

const PERSONAL_TEAM: Team = {
  id: 1,
  name: 'Persönlich',
  is_personal: true,
  is_owner: true,
  can_manage_skills: true,
} as Team

const SKILL_ROW: AiSkillManaged = {
  id: 'skill-1',
  skill_key: 'i-have-adhd',
  name: 'i-have-adhd',
  description: 'Kurze Antworten mit klarem nächsten Schritt.',
  body: 'Starte immer mit der nächsten konkreten Handlung.',
  scope: 'team',
  origin: 'operator',
  team_id: 1,
  status: 'active',
  enabled: true,
  always_active: false,
  created_by: 1,
  created_at: '2026-11-26T12:00:00Z',
  updated_at: '2026-11-26T12:00:00Z',
  fingerprint: 'fp-1',
}

describe('SingraKnowledgeView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    vi.mocked(teamsApi.list).mockReset().mockResolvedValue([PERSONAL_TEAM])
    vi.mocked(aiApi.listSkills).mockReset().mockResolvedValue([])
    vi.mocked(aiApi.listManagedSkills).mockReset().mockResolvedValue([SKILL_ROW])
    vi.mocked(aiApi.saveSkill).mockReset().mockResolvedValue(SKILL_ROW)
    vi.mocked(aiApi.toggleSkillAlwaysActive).mockReset().mockResolvedValue({ ...SKILL_ROW, always_active: true })
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.success).mockReset()
  })

  it('erlaubt Immer-aktiv beim Anlegen eines neuen Wissenseintrags', async () => {
    render(<SingraKnowledgeView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Neues Wissen' }))
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'ADHS Stil' } })
    fireEvent.change(screen.getByLabelText('Kurzbeschreibung'), { target: { value: 'Immer aktiv' } })
    fireEvent.change(screen.getByLabelText('Anleitung und Inhalt'), { target: { value: 'Direkt starten.' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Immer im Kontext aktiv' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(aiApi.saveSkill).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ADHS Stil',
      always_active: true,
    })))
  })

  it('bewahrt always_active beim Bearbeiten und Speichern eines bestehenden Eintrags', async () => {
    const alwaysRow: AiSkillManaged = { ...SKILL_ROW, always_active: true }
    vi.mocked(aiApi.listManagedSkills).mockResolvedValue([alwaysRow])
    render(<SingraKnowledgeView />)

    fireEvent.click(await screen.findByRole('button', { name: 'i-have-adhd' }))
    fireEvent.change(screen.getByLabelText('Kurzbeschreibung'), { target: { value: 'Aktualisiert' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(aiApi.saveSkill).toHaveBeenCalledWith(expect.objectContaining({
      skill_key: 'i-have-adhd',
      description: 'Aktualisiert',
      always_active: true,
    })))
  })

  it('schaltet Immer-aktiv direkt auf der Karte um und zeigt 409-Limitfehler', async () => {
    render(<SingraKnowledgeView />)

    const toggleBtn = await screen.findByRole('button', { name: 'Immer im Kontext aktiv: i-have-adhd' })
    fireEvent.click(toggleBtn)

    await waitFor(() => expect(aiApi.toggleSkillAlwaysActive).toHaveBeenCalledWith('skill-1', true))

    vi.mocked(aiApi.toggleSkillAlwaysActive).mockRejectedValueOnce(
      new SanitizedApiError('Maximal 5 dauerhaft aktive Skills gleichzeitig moeglich.', { status: 409 }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Immer im Kontext aktiv: i-have-adhd' }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Maximal 5 dauerhaft aktive Skills gleichzeitig moeglich.'),
    )
  })
})
