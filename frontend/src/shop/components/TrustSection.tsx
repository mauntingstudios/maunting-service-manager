import { useTranslation } from 'react-i18next'
import { Activity, ExternalLink, MessageSquare, Receipt, Server, ShieldCheck } from 'lucide-react'
import type { ShopPublicPolicyDto } from '@/api/shop'
import { still } from '@/lib/still'

export interface ShopDdosSummary {
  gameAware: boolean
  providers: string[]
  profiles: string[]
}

interface TrustSectionProps {
  onlineNodesCount: number
  bestPingMs: number | null
  publicPolicy: ShopPublicPolicyDto | null
  ddosSummary?: ShopDdosSummary | null
}

function isSafeTrustpilotUrl(raw?: string | null): raw is string {
  if (!raw) return false
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    const isHostValid = host === 'trustpilot.com' || host.endsWith('.trustpilot.com')
    return (
      parsed.protocol === 'https:' &&
      isHostValid &&
      parsed.pathname.toLowerCase().startsWith('/review/')
    )
  } catch (err) {
    still(err, 'TrustSection.parseTrustpilotUrl')
    return false
  }
}

function isSafeDiscordUrl(raw?: string | null): raw is string {
  if (!raw) return false
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.toLowerCase()
    const isInviteHost =
      host === 'discord.gg' ||
      ((host === 'discord.com' || host === 'www.discord.com') &&
        parsed.pathname.toLowerCase().startsWith('/invite/'))
    return parsed.protocol === 'https:' && isInviteHost
  } catch (err) {
    still(err, 'TrustSection.parseDiscordUrl')
    return false
  }
}

export function TrustSection({
  onlineNodesCount,
  bestPingMs,
  publicPolicy,
  ddosSummary,
}: TrustSectionProps) {
  const { t } = useTranslation()
  const trustpilotUrl =
    publicPolicy?.shop_trustpilot_enabled && isSafeTrustpilotUrl(publicPolicy.shop_trustpilot_url)
      ? publicPolicy.shop_trustpilot_url
      : null
  const discordUrl = isSafeDiscordUrl(publicPolicy?.shop_discord_invite_url)
    ? publicPolicy.shop_discord_invite_url
    : null

  const hasDdosSpotlight = Boolean(
    ddosSummary && (ddosSummary.gameAware || ddosSummary.providers.length > 0),
  )

  return (
    <section
      aria-label={t('shop.trust.titel')}
      data-shop-reveal
      className="msm-shop-reveal msm-shop-reveal-fallback border-b border-white/10 bg-surface-container-low/40"
    >
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        {hasDdosSpotlight && ddosSummary && (
          <div className="msm-shop-ddos-glow flex flex-col justify-between gap-4 rounded-2xl border p-4 sm:p-5 lg:flex-row lg:items-center">
            <div className="flex items-start gap-3.5 sm:items-center">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-status-running/45 bg-status-running/15 text-status-running shadow-sm">
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label-sm font-bold uppercase tracking-[0.16em] text-status-running">
                    {t('shop.trust.ddosSpotlightBadge')}
                  </span>
                </div>
                <h2 className="mt-0.5 font-headline text-base font-extrabold text-white sm:text-lg">
                  {ddosSummary.gameAware
                    ? t('shop.trust.ddosSpotlightTitelGameAware')
                    : t('shop.trust.ddosSpotlightTitel')}
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant sm:text-sm">
                  {t('shop.trust.ddosSpotlightText')}
                </p>
              </div>
            </div>

            {(ddosSummary.providers.length > 0 || ddosSummary.profiles.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {ddosSummary.providers.map((provider) => (
                  <span
                    key={provider}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-status-running/50 bg-background/80 px-3 py-1.5 text-xs font-bold text-status-running shadow-sm"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{provider}</span>
                  </span>
                ))}
                {ddosSummary.profiles.map((profile) => (
                  <span
                    key={profile}
                    className="inline-flex items-center rounded-xl border border-white/15 bg-background/70 px-3 py-1.5 text-xs font-medium text-on-surface"
                  >
                    {profile}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-surface-container/60 px-4 py-3.5">
            <Server className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-headline text-sm font-bold tabular-nums text-on-surface">
                {onlineNodesCount > 0
                  ? t('shop.trust.standorteWert', { count: onlineNodesCount })
                  : t('shop.trust.standorteBereit')}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {t('shop.trust.standorteLabel')}
              </p>
            </div>
          </div>

          <a
            href="#shop-standorte"
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-surface-container/60 px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-surface-container-high/70"
          >
            <Activity className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-headline text-sm font-bold tabular-nums text-on-surface">
                {bestPingMs != null
                  ? t('shop.trust.pingWert', { ms: bestPingMs })
                  : t('shop.trust.pingMessbar')}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {t('shop.trust.pingLabel')}
              </p>
            </div>
          </a>

          <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-surface-container/60 px-4 py-3.5">
            <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-headline text-sm font-bold text-on-surface">
                {t('shop.trust.prepaidWert')}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {t('shop.trust.prepaidLabel')}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-surface-container/60 px-4 py-3.5">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-status-running" aria-hidden="true" />
            <div>
              <p className="font-headline text-sm font-bold text-on-surface">
                {t('shop.trust.backupsWert')}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {t('shop.trust.backupsLabel')}
              </p>
            </div>
          </div>
        </div>

        {(trustpilotUrl || discordUrl) && (
          <div className="grid gap-3 md:grid-cols-2">
            {trustpilotUrl && (
              <a
                href={trustpilotUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center justify-between gap-4 rounded-xl border border-status-running/35 bg-status-running/[0.06] px-4 py-3 transition-colors hover:border-status-running/60"
              >
                <div>
                  <p className="font-headline text-sm font-bold text-on-surface">
                    {t('shop.trust.trustpilotTitel')}
                  </p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">
                    {t('shop.trust.trustpilotText')}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-status-running">
                  <span>{t('shop.trust.trustpilotCta')}</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </a>
            )}

            {discordUrl && (
              <a
                href={discordUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center justify-between gap-4 rounded-xl border border-primary/35 bg-primary/[0.06] px-4 py-3 transition-colors hover:border-primary/60"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="font-headline text-sm font-bold text-on-surface">
                      {t('shop.trust.discordTitel')}
                    </p>
                    <p className="mt-0.5 text-xs text-on-surface-variant">
                      {t('shop.trust.discordText')}
                    </p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary">
                  <span>{t('shop.trust.discordCta')}</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
