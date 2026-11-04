import { useEffect, useMemo, useState } from 'react'
import { Crown, Server, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SanitizedApiError } from '@/api/client'
import {
  teamsApi,
  type TeamDetail,
  type TeamRole,
  type TeamRoleWritePayload,
} from '@/api/teams'
import { Button, ColorPicker, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, IconPicker, Input, MultiSelect, RechteAbschnitte, renderRoleIcon, Switch, Textarea } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import {
  TEAM_PERMISSION_ABSCHNITTE,
  TEAM_PERMISSION_DEFINITIONS,
} from './teamPermissionsCatalog'

export interface TeamRoleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: TeamDetail
  role: TeamRole | null
  onSaved: (role: TeamRole) => void
}

export function TeamRoleModal({
  open,
  onOpenChange,
  team,
  role,
  onSaved,
}: TeamRoleModalProps) {
  const { t } = useTranslation()
  const isEditing = role !== null

  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const [icon, setIcon] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isDefault, setIsDefault] = useState(false)
  const [permissionKeys, setPermissionKeys] = useState<Set<string>>(new Set())
  const [serverGrants, setServerGrants] = useState<Map<number, Set<string>>>(new Map())
  const [busy, setBusy] = useState(false)

  // Reset/populate form when modal opens or target role changes
  useEffect(() => {
    if (!open) return

    if (role) {
      setName(role.name)
      setColor(role.color || '#3b82f6')
      setIcon(role.icon || null)
      setDescription(role.description || '')
      setIsAdmin(Boolean(role.is_admin))
      setIsDefault(Boolean(role.is_default))
      setPermissionKeys(new Set(role.permission_keys || []))

      const grantMap = new Map<number, Set<string>>()
      for (const sg of role.server_grants || []) {
        grantMap.set(sg.server_id, new Set(sg.permission_keys))
      }
      setServerGrants(grantMap)
    } else {
      setName('')
      setColor('#3b82f6')
      setIcon(null)
      setDescription('')
      setIsAdmin(false)
      setIsDefault(false)
      setPermissionKeys(new Set())
      setServerGrants(new Map())
    }
  }, [open, role])

  const togglePermission = (key: string, enabled: boolean) => {
    setPermissionKeys((prev) => {
      const next = new Set(prev)
      if (enabled) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  const setServerGrantKeys = (serverId: number, keys: string[]) => {
    setServerGrants((prev) => {
      const next = new Map(prev)
      if (keys.length === 0) {
        next.delete(serverId)
      } else {
        next.set(serverId, new Set(keys))
      }
      return next
    })
  }

  const toggleAllServerKeys = (serverId: number, allKeys: string[], giveAll: boolean) => {
    setServerGrants((prev) => {
      const next = new Map(prev)
      if (giveAll) {
        next.set(serverId, new Set(allKeys))
      } else {
        next.delete(serverId)
      }
      return next
    })
  }

  const canSave = name.trim().length >= 2 && !busy

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)

    try {
      const grantsPayload = Array.from(serverGrants.entries())
        .filter(([, keys]) => keys.size > 0)
        .map(([serverId, keys]) => ({
          server_id: serverId,
          permission_keys: Array.from(keys),
        }))

      const payload: TeamRoleWritePayload = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon: icon || null,
        is_admin: isAdmin,
        is_default: isDefault,
        permission_keys: Array.from(permissionKeys),
        server_grants: grantsPayload,
        can_access_vault: permissionKeys.has('vault.read') || isAdmin,
        can_manage_skills: permissionKeys.has('ai.skills.manage') || isAdmin,
        can_manage_memory: permissionKeys.has('ai.memory.write') || isAdmin,
      }

      let saved: TeamRole
      if (isEditing && role) {
        saved = await teamsApi.updateRole(team.id, role.id, payload)
      } else {
        saved = await teamsApi.createRole(team.id, payload)
      }

      toast.success(t('teams.roleSaved'))
      onSaved(saved)
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof SanitizedApiError ? err.message : t('teams.errors.save'))
    } finally {
      setBusy(false)
    }
  }

  const teamServers = useMemo(() => team.servers || [], [team.servers])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div
              className="grid h-8 w-8 place-items-center rounded-lg text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {renderRoleIcon(icon, 'h-4 w-4 text-white')}
            </div>
            <div>
              <DialogTitle>
                {isEditing ? t('teams.editRole') : t('teams.createRole')}
              </DialogTitle>
              <DialogDescription>
                {t('teams.rolesHint')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* ── Basisdaten: Name, Farbe, Icon, Beschreibung ─────────────── */}
          <div className="space-y-4 rounded-xl border border-outline-variant/40 bg-surface-container-low/50 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1.5">
                  {t('teams.roleName')} <span className="text-status-destructive">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="z. B. Moderator, Entwickler, Redakteur"
                  maxLength={32}
                  disabled={busy}
                  aria-label={t('teams.roleName')}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface mb-1.5">
                  {t('teams.roleColor')}
                </label>
                <ColorPicker
                  value={color}
                  onChange={setColor}
                  disabled={busy}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Rollen-Icon
              </label>
              <IconPicker
                value={icon}
                onChange={setIcon}
                disabled={busy}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                {t('teams.roleDescription')}
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('teams.roleDescriptionPlaceholder')}
                rows={2}
                maxLength={255}
                disabled={busy}
                aria-label={t('teams.roleDescription')}
              />
            </div>
          </div>

          {/* ── Status-Schalter: Admin & Standardrolle ─────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-start justify-between gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/40 p-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                  <Crown className="h-4 w-4 text-status-warning" />
                  <span>{t('teams.isAdmin')}</span>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
                  {t('teams.isAdminDesc')}
                </p>
              </div>
              <Switch
                checked={isAdmin}
                onCheckedChange={setIsAdmin}
                disabled={busy}
                aria-label={t('teams.isAdmin')}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low/40 p-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-bold text-on-surface">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>{t('teams.isDefault')}</span>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
                  {t('teams.isDefaultDesc')}
                </p>
              </div>
              <Switch
                checked={isDefault}
                onCheckedChange={setIsDefault}
                disabled={busy}
                aria-label={t('teams.isDefault')}
              />
            </div>
          </div>

          {/* ── Granulare Team-Rechte via Design-DNA RechteAbschnitte ──────── */}
          {isAdmin ? (
            <div className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-4 text-center">
              <Crown className="mx-auto h-6 w-6 text-status-warning mb-1.5" />
              <h4 className="text-sm font-bold text-status-warning">
                Administrator-Rolle aktiviert
              </h4>
              <p className="mt-1 text-xs text-on-surface-variant max-w-md mx-auto">
                Diese Rolle besitzt automatisch sämtliche Teamverwaltungs-, KI-, Tresor- und Server-Rechte des Gründers. Eine granulare Zuweisung ist nicht erforderlich.
              </p>
            </div>
          ) : (
            <>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                  Funktionale Berechtigungen
                </h4>
                <RechteAbschnitte
                  rechte={TEAM_PERMISSION_DEFINITIONS}
                  abschnitte={TEAM_PERMISSION_ABSCHNITTE}
                  gesetzt={permissionKeys}
                  onToggle={togglePermission}
                  disabled={busy}
                  zeilenBeschriftung={(titel) => `${titel} für Rolle umschalten`}
                />
              </div>

              {/* ── Server-Berechtigungen je Team-Server ───────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      {t('teams.serverGrantsTitle')}
                    </h4>
                    <p className="text-xs text-on-surface-variant">
                      {t('teams.serverGrantsDesc')}
                    </p>
                  </div>
                </div>

                {teamServers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low/30 p-4 text-center text-xs text-on-surface-variant">
                    {t('teams.noServersAssigned')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {teamServers.map((server) => {
                      const currentGranted = serverGrants.get(server.server_id) ?? new Set<string>()
                      const availableKeys = server.permission_keys

                      const options = availableKeys.map((key) => ({
                        value: key,
                        label: t(`permissionDetails.${key.replace(/\./g, '_')}.title`, { defaultValue: key }),
                      }))

                      return (
                        <div
                          key={server.server_id}
                          className="rounded-xl border border-outline-variant/40 bg-surface-container-low/40 p-3.5 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Server className="h-4 w-4 text-primary shrink-0" />
                              <span className="text-sm font-semibold text-on-surface">
                                {server.server_name}
                              </span>
                              <span className="text-xs text-on-surface-variant">
                                ({currentGranted.size} / {availableKeys.length} aktiv)
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => toggleAllServerKeys(server.server_id, availableKeys, true)}
                                className="text-xs h-7 px-2"
                              >
                                {t('teams.allPermissions')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => toggleAllServerKeys(server.server_id, availableKeys, false)}
                                className="text-xs h-7 px-2 text-on-surface-variant"
                              >
                                {t('teams.noPermissions')}
                              </Button>
                            </div>
                          </div>

                          <MultiSelect
                            options={options}
                            values={Array.from(currentGranted)}
                            onChange={(keys) => setServerGrantKeys(server.server_id, keys)}
                            disabled={busy}
                            placeholder={t('teams.noAccess')}
                            aria-label={`Serverrechte für ${server.server_name}`}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-outline-variant/30 !bg-surface-container-low/70 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {isEditing ? t('common.save') : t('teams.createRole')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
