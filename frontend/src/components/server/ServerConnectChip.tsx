import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Copy, Plug } from 'lucide-react'
import { ActionMenu, Kurzinfo, type ActionMenuItem } from '@maunting/ui'
import { formatPortRoleLabel, resolveServerConnect, type ServerEndpoint } from '@/lib/serverConnect'
import { toast } from '@/stores/toastStore'
import type { Server } from '@/types'

interface ServerConnectChipProps {
  server: Pick<Server, 'public_bind_ip' | 'ports' | 'game_port' | 'query_port' | 'rcon_port'>
  compact?: boolean
  className?: string
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fallback nicht nötig in modernen Browsern; Fehlermeldung folgt über Rückgabewert.
  }
  return false
}

/**
 * Zeigt die primäre Verbindungsadresse eines Servers als Kopier-Chip
 * und bündelt bei Mehrport-Blueprints weitere Ports (Game, Query, Web, DB, RCON) in einem Menü.
 */
export function ServerConnectChip({ server, compact = false, className = '' }: ServerConnectChipProps) {
  const { t } = useTranslation()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const resolved = resolveServerConnect(server)

  if (!resolved.primary) {
    return null
  }

  const roleLabel = (endpoint: ServerEndpoint) => formatPortRoleLabel(endpoint.role, t)

  const handleCopy = async (endpoint: ServerEndpoint, key: string) => {
    const value = endpoint.address ?? String(endpoint.port)
    const ok = await copyText(value)
    if (ok) {
      setCopiedKey(key)
      toast.success(`${t('serverDetail.addressCopied')}: ${value}`)
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current))
      }, 1800)
    }
  }

  const primary = resolved.primary
  const primaryText = primary.address ?? `:${primary.port}`
  const showRoleBadge = !compact && primary.baseRole !== 'game'
  const tooltipText = resolved.host
    ? `${roleLabel(primary)} · ${t('serverDetail.copyAddress')}`
    : `${roleLabel(primary)} · ${t('serverDetail.noPublicIp')}`

  const menuItems: ActionMenuItem[] = resolved.endpoints.map((ep) => {
    const epKey = `${ep.role}:${ep.port}:${ep.protocol}`
    const targetValue = ep.address ?? `:${ep.port}`
    return {
      key: epKey,
      label: `${roleLabel(ep)} · ${targetValue} (${ep.protocol.toUpperCase()})`,
      icon: copiedKey === epKey ? <Check className="h-3.5 w-3.5 text-secondary" /> : <Copy className="h-3.5 w-3.5" />,
      separatorBefore: ep.baseRole === 'rcon',
      onSelect: () => {
        void handleCopy(ep, epKey)
      },
    }
  })

  return (
    <div
      role="group"
      aria-label={t('serverDetail.connectAddress')}
      className={`inline-flex items-center rounded-full border border-outline bg-surface-container-high/85 backdrop-blur-md transition-colors hover:border-outline-variant ${className}`}
    >
      <Kurzinfo text={tooltipText} portal>
        <button
          type="button"
          onClick={() => void handleCopy(primary, 'primary')}
          aria-label={`${t('serverDetail.copyAddress')}: ${primaryText}`}
          className={`inline-flex items-center gap-1.5 rounded-l-full ${
            resolved.endpoints.length <= 1 ? 'rounded-r-full pr-3' : 'pr-2'
          } ${compact ? 'min-h-[34px] pl-2.5 text-xs' : 'min-h-[44px] md:min-h-[34px] pl-3 text-xs'} font-body-md text-on-surface hover:text-primary transition-colors`}
        >
          <Plug className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
          {showRoleBadge ? (
            <span className="text-label-sm font-medium uppercase tracking-wider text-on-surface-variant">
              {primary.baseRole === 'database' ? 'DB' : primary.baseRole}
            </span>
          ) : null}
          <span className="font-mono text-body-md">{primaryText}</span>
          {copiedKey === 'primary' ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
          ) : (
            <Copy className="h-3 w-3 shrink-0 text-on-surface-variant" aria-hidden="true" />
          )}
        </button>
      </Kurzinfo>

      {resolved.endpoints.length > 1 ? (
        <div className="border-l border-outline/70 pr-0.5 flex items-center">
          <ActionMenu
            label={t('serverDetail.morePorts')}
            ariaLabel={t('serverDetail.morePorts')}
            icon={<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            items={menuItems}
            variant="ghost"
            surface="dna"
            align="end"
            compact
            iconOnly
          />
        </div>
      ) : null}
    </div>
  )
}
