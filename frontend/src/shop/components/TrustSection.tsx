import { useTranslation } from 'react-i18next'
import { ExternalLink, MessageSquare, Receipt, Server, ShieldCheck } from 'lucide-react'
import type { ShopPublicPolicyDto } from '@/api/shop'
import { still } from '@/lib/still'
import type { ShopDdosSummary } from '../ddosSummary'
import { isSafeHttpUrl } from '../safeUrl'

interface TrustSectionProps {
  onlineNodesCount: number
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
  publicPolicy,
  ddosSummary = null,
}: TrustSectionProps) {
  const { t } = useTranslation()
  const trustpilotUrl =
    publicPolicy?.shop_trustpilot_enabled && isSafeTrustpilotUrl(publicPolicy.shop_trustpilot_url)
      ? publicPolicy.shop_trustpilot_url
      : null
  const discordUrl = isSafeDiscordUrl(publicPolicy?.shop_discord_invite_url)
    ? publicPolicy.shop_discord_invite_url
    : null

  const showDdosTile = Boolean(ddosSummary && ddosSummary.coverage !== 'none')

  const ddosTitel =
    ddosSummary?.coverage === 'partial'
      ? t('shop.trust.ddosPartialTitel')
      : ddosSummary?.coverage === 'mixed'
        ? t('shop.trust.ddosSpotlightTitelMulti')
        : ddosSummary?.allGameAware
          ? t('shop.trust.ddosSpotlightTitelGameAware')
          : t('shop.trust.ddosSpotlightTitel')

  const ddosText =
    ddosSummary?.coverage === 'partial'
      ? ddosSummary.providers.length > 0
        ? `${ddosSummary.providers.join(' · ')}: ${t('shop.trust.ddosPartialText')}`
        : t('shop.trust.ddosPartialText')
      : ddosSummary?.coverage === 'mixed'
        ? ddosSummary.providers.join(' · ')
        : ddosSummary?.providers[0] || t('shop.trust.ddosSpotlightText')

  return (
    <section
      aria-label={t('shop.trust.titel')}
      data-shop-reveal
      className="msm-shop-reveal msm-shop-reveal-fallback border-b border-white/10 bg-surface-container-low/40"
    >
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <div
          className={`grid gap-3 sm:grid-cols-2 ${
            showDdosTile ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
          }`}
        >
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
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-headline text-sm font-bold text-on-surface">
                {t('shop.trust.backupsWert')}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {t('shop.trust.backupsLabel')}
              </p>
            </div>
          </div>

          {showDdosTile && ddosSummary && (
            <div className="flex items-start gap-3 rounded-xl border border-status-running/35 bg-status-running/[0.06] px-4 py-3.5">
              <ShieldCheck
                className="mt-0.5 h-5 w-5 shrink-0 text-status-running"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-headline text-sm font-bold text-on-surface">{ddosTitel}</p>
                <p className="mt-0.5 text-xs text-on-surface-variant">{ddosText}</p>
              </div>
            </div>
          )}
        </div>

        {(isSafeHttpUrl(trustpilotUrl) || isSafeHttpUrl(discordUrl)) && (
          <div className="grid gap-3 md:grid-cols-2">
            {isSafeHttpUrl(trustpilotUrl) && (
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

            {isSafeHttpUrl(discordUrl) && (
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
