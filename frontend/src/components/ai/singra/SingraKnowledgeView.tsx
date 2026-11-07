import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { aiApi, type AiSkillManaged, type AiSkillSummary } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { teamsApi, type Team } from '@/api/teams'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Spinner,
  Switch,
  Textarea,
} from '@maunting/ui'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

function generateSkillKey(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
  if (slug.length >= 2) return slug
  return `wissen-${Math.random().toString(36).slice(2, 8)}`
}

export function SingraKnowledgeView() {
  const [personalTeam, setPersonalTeam] = useState<Team | null>(null)
  const [sharedTeams, setSharedTeams] = useState<Team[]>([])
  const [selectedScope, setSelectedScope] = useState<string>('personal')
  const [loading, setLoading] = useState(true)

  const [managedSkills, setManagedSkills] = useState<AiSkillManaged[]>([])
  const [directorySkills, setDirectorySkills] = useState<AiSkillSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<'own' | 'built_in'>('own')
  const [busy, setBusy] = useState(false)

  // Modal state for creating / editing knowledge
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<AiSkillManaged | null>(null)
  const [showCustomKey, setShowCustomKey] = useState(false)
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    body: '',
    skill_key: '',
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [teamRows, managedRows, dirRows] = await Promise.all([
        teamsApi.list().catch(() => [] as Team[]),
        aiApi.listManagedSkills().catch(() => [] as AiSkillManaged[]),
        aiApi.listSkills().catch(() => [] as AiSkillSummary[]),
      ])
      const personal = teamRows.find((r) => r.is_personal) ?? null
      const shared = teamRows.filter((r) => !r.is_personal)
      setPersonalTeam(personal)
      setSharedTeams(shared)
      setManagedSkills(managedRows)
      setDirectorySkills(dirRows)
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Wissenseinträge konnten nicht geladen werden.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const activeTeam =
    selectedScope === 'personal'
      ? personalTeam
      : sharedTeams.find((t) => String(t.id) === selectedScope) ?? personalTeam

  const activeTeamId = activeTeam?.id ?? null
  const canManage = activeTeam?.can_manage_skills ?? true

  const ownSkills = useMemo(() => {
    return managedSkills.filter((s) => s.team_id === activeTeamId)
  }, [managedSkills, activeTeamId])

  const builtInSkills = useMemo(() => {
    return directorySkills.filter((s) => s.scope === 'shipped')
  }, [directorySkills])

  const filteredOwnSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return ownSkills
    return ownSkills.filter((s) =>
      `${s.name} ${s.description} ${s.body}`.toLowerCase().includes(q),
    )
  }, [ownSkills, searchQuery])

  const filteredBuiltInSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return builtInSkills
    return builtInSkills.filter((s) =>
      `${s.name} ${s.description}`.toLowerCase().includes(q),
    )
  }, [builtInSkills, searchQuery])

  const openCreateModal = () => {
    setEditingSkill(null)
    setShowCustomKey(false)
    setDraft({ name: '', description: '', body: '', skill_key: '' })
    setModalOpen(true)
  }

  const openEditModal = (skill: AiSkillManaged) => {
    setEditingSkill(skill)
    setShowCustomKey(false)
    setDraft({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      skill_key: skill.skill_key,
    })
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim() || !draft.description.trim() || !draft.body.trim() || busy) return
    setBusy(true)
    try {
      const effectiveKey = editingSkill
        ? editingSkill.skill_key
        : (draft.skill_key.trim().toLowerCase() || generateSkillKey(draft.name))

      await aiApi.saveSkill({
        skill_key: effectiveKey,
        name: draft.name.trim(),
        description: draft.description.trim(),
        body: draft.body.trim(),
        team_id: activeTeamId,
        enabled: editingSkill ? editingSkill.enabled : true,
      })
      setModalOpen(false)
      await loadData()
      toast.success(editingSkill ? 'Wissenseintrag aktualisiert.' : 'Neues Wissen gespeichert.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Wissenseintrag konnte nicht gespeichert werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  const handleToggle = async (skill: AiSkillManaged, enabled: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await aiApi.toggleSkill(skill.id, enabled)
      setManagedSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, enabled } : s)),
      )
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Status konnte nicht geändert werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (skill: AiSkillManaged) => {
    const ok = await confirm({
      title: 'Wissenseintrag löschen',
      message: `Soll „${skill.name}“ wirklich gelöscht werden?`,
      confirmText: 'Löschen',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await aiApi.deleteSkill(skill.id)
      setManagedSkills((prev) => prev.filter((s) => s.id !== skill.id))
      toast.success('Wissenseintrag entfernt.')
    } catch (err: unknown) {
      toast.error(
        err instanceof SanitizedApiError
          ? err.message
          : 'Eintrag konnte nicht gelöscht werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-surface px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Calm Header Card */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-5">
          <div className="flex items-start gap-3 max-w-xl">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-headline text-lg font-semibold text-on-surface">
                Wissen & Abläufe
              </h2>
              <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                Hinterlege feste Abläufe, Stilvorgaben oder Anleitungen. Singra schlägt passendes Wissen automatisch nach, wenn es im Gespräch gebraucht wird.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {sharedTeams.length > 0 ? (
              <div className="w-48">
                <Dropdown
                  value={selectedScope}
                  onChange={setSelectedScope}
                  options={[
                    { value: 'personal', label: 'Persönlich' },
                    ...sharedTeams.map((team) => ({
                      value: String(team.id),
                      label: `Team: ${team.name}`,
                    })),
                  ]}
                  aria-label="Wissensbereich auswählen"
                />
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface-variant">
                <User className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Persönlich
              </span>
            )}

            {canManage && (
              <Button
                type="button"
                size="sm"
                className="rounded-full px-4"
                onClick={openCreateModal}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Neues Wissen
              </Button>
            )}
          </div>
        </div>

        {/* Filter Bar & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterTab('own')}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors border',
                filterTab === 'own'
                  ? 'border-primary/35 bg-primary/15 text-primary'
                  : 'border-transparent bg-surface-container-low/60 text-on-surface-variant hover:text-on-surface',
              ].join(' ')}
            >
              {selectedScope === 'personal' ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Users className="h-3.5 w-3.5" />
              )}
              <span>Eigene Einträge ({ownSkills.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('built_in')}
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors border',
                filterTab === 'built_in'
                  ? 'border-primary/35 bg-primary/15 text-primary'
                  : 'border-transparent bg-surface-container-low/60 text-on-surface-variant hover:text-on-surface',
              ].join(' ')}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Mitgeliefertes Grundwissen ({builtInSkills.length})</span>
            </button>
          </div>

          {(ownSkills.length > 2 || builtInSkills.length > 2 || searchQuery) && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Wissen durchsuchen…"
                aria-label="Wissen durchsuchen"
                className="h-8 w-full rounded-full border border-outline-variant/30 bg-surface-container-low/60 pl-8 pr-3 text-xs text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary/50 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Cards Grid */}
        {filterTab === 'own' ? (
          filteredOwnSkills.length === 0 ? (
            <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/30 p-8 text-center">
              <BookOpen className="h-8 w-8 text-primary/50 mx-auto mb-2.5" />
              <p className="text-sm font-medium text-on-surface">
                {ownSkills.length === 0
                  ? 'Noch kein eigenes Wissen hinterlegt'
                  : 'Kein Eintrag passt zu deiner Suche'}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant max-w-md mx-auto leading-relaxed">
                {ownSkills.length === 0
                  ? 'Speichere hier wiederkehrende Abläufe, Checklisten oder Projektstandards, damit du sie im Chat nicht jedes Mal neu erklären musst.'
                  : 'Probiere einen anderen Suchbegriff aus.'}
              </p>
              {ownSkills.length === 0 && canManage && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-4 rounded-full"
                  onClick={openCreateModal}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ersten Eintrag anlegen
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filteredOwnSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex flex-col justify-between rounded-2xl border border-outline-variant/25 bg-surface-container-low/40 p-4 hover:border-outline-variant/45 transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => canManage && openEditModal(skill)}
                        className="text-left font-medium text-sm text-on-surface hover:text-primary transition-colors"
                      >
                        {skill.name}
                      </button>
                      {canManage && (
                        <Switch
                          checked={skill.enabled}
                          disabled={busy}
                          onCheckedChange={(next) => void handleToggle(skill, next)}
                          aria-label={`${skill.name} aktivieren`}
                        />
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {skill.origin === 'ai' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-label-sm font-medium text-primary">
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          Von Singra gelernt
                        </span>
                      )}
                      {skill.status === 'pending' && (
                        <span className="rounded-full bg-status-warning/15 px-2 py-0.5 text-label-sm font-medium text-status-warning">
                          Wartet auf Freigabe
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-xs text-on-surface-variant line-clamp-2 leading-relaxed">
                      {skill.description}
                    </p>
                  </div>

                  {canManage && (
                    <div className="mt-4 flex items-center justify-end gap-1 border-t border-outline-variant/15 pt-2.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => openEditModal(skill)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Bearbeiten
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-on-surface-variant hover:text-status-destructive"
                        onClick={() => void handleDelete(skill)}
                        aria-label={`${skill.name} löschen`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredBuiltInSkills.map((skill) => (
              <div
                key={skill.skill_key}
                className="flex flex-col justify-between rounded-2xl border border-outline-variant/20 bg-surface-container-low/25 p-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-on-surface">
                      {skill.name}
                    </span>
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-label-sm text-on-surface-variant">
                      Standard
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-on-surface-variant leading-relaxed">
                    {skill.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clean Modal for Creating / Editing Knowledge */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSkill ? 'Wissenseintrag bearbeiten' : 'Neues Wissen festhalten'}
            </DialogTitle>
            <DialogDescription>
              Beschreibe kurz, worum es geht und wie Singra vorgehen soll.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 mt-2">
            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Titel
              </label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="z. B. Server-Wartung oder Antwortstil für Kunden"
                required
                autoFocus
                aria-label="Titel"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Wann wird dieses Wissen gebraucht?
              </label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="z. B. Wenn ein Spielserver zu viel Arbeitsspeicher verbraucht"
                required
                aria-label="Kurzbeschreibung"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-on-surface-variant mb-1">
                Anleitung & Inhalt
              </label>
              <Textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={6}
                placeholder="Schreibe hier Schritt für Schritt auf, worauf Singra achten soll…"
                required
                aria-label="Anleitung und Inhalt"
              />
            </div>

            {!editingSkill && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowCustomKey((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface"
                >
                  {showCustomKey ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  <span>Kennung manuell anpassen (optional)</span>
                </button>
                {showCustomKey && (
                  <div className="mt-2">
                    <Input
                      value={draft.skill_key}
                      onChange={(e) => setDraft((d) => ({ ...d, skill_key: e.target.value }))}
                      placeholder={generateSkillKey(draft.name || 'mein-ablauf')}
                      aria-label="Interne Kennung"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/20">
              <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !draft.name.trim() ||
                  !draft.description.trim() ||
                  !draft.body.trim()
                }
              >
                {busy ? 'Speichert…' : 'Speichern'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
