import { useMemo } from 'react'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { resolveEffectivePermissions, useRolePreviewStore } from '@/stores/rolePreviewStore'
import type { MePermissions } from '@/types/permissions'

/** Liefert die effektiven Berechtigungen — unter Berücksichtigung einer aktiven Rollenvorschau. */
export function useEffectivePermissions(): MePermissions | null {
  const me = usePermissionsStore((s) => s.me)
  const preview = useRolePreviewStore((s) => s.preview)
  return useMemo(() => resolveEffectivePermissions(me, preview), [me, preview])
}

/** Prueft eine Permission im Frontend (nur UI — Backend prueft selbst).
 *
 * @param key Permission-Key aus dem Catalog (global oder server-scoped)
 * @param serverId Optional — wenn gesetzt, wird zusaetzlich nach
 *                 server-spezifischer Delegation geschaut.
 */
export function useHasPermission(key: string, serverId?: number): boolean {
  const effective = useEffectivePermissions()
  if (!effective) return false
  if (effective.is_owner) return true
  if (effective.global_keys.includes(key)) return true
  if (serverId !== undefined) {
    const perServer = effective.server_keys[String(serverId)] ?? []
    if (perServer.includes(key)) return true
  }
  return false
}

export function useIsOwner(): boolean {
  const effective = useEffectivePermissions()
  return !!effective?.is_owner
}
