import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Newspaper } from 'lucide-react'
import { Badge, buttonClasses } from '@maunting/ui'
import { newsApi, newsCoverSrc, type NewsPostPublic } from '@/api/news'
import { still } from '@/lib/still'
import { categoryBadgeVariant } from '@/pages/NewsOverview'

function formatNewsDatum(iso: string | null, sprache: string): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat(sprache.startsWith('en') ? 'en-US' : 'de-DE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export function ShopNewsTeaser() {
  const { t, i18n } = useTranslation()
  const [posts, setPosts] = useState<NewsPostPublic[]>([])

  useEffect(() => {
    if (typeof newsApi?.listPublic !== 'function') return
    let aktiv = true
    newsApi
      .listPublic({ limit: 3 })
      .then((res) => {
        if (aktiv) setPosts(Array.isArray(res?.items) ? res.items : [])
      })
      .catch((err) => {
        still(err, 'ShopNewsTeaser.listPublic')
      })
    return () => {
      aktiv = false
    }
  }, [])

  if (posts.length === 0) return null

  return (
    <section
      id="shop-news"
      aria-label={t('shop.newsTeaser.titel')}
      data-shop-reveal
      className="msm-shop-reveal msm-shop-reveal-fallback border-t border-white/10 bg-surface-container-low/25"
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-label-sm font-semibold uppercase tracking-[0.18em] text-primary">
              {t('shop.newsTeaser.kicker')}
            </p>
            <h2 className="mt-1 font-headline text-2xl font-bold text-on-surface sm:text-3xl">
              {t('shop.newsTeaser.titel')}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {t('shop.newsTeaser.untertitel')}
            </p>
          </div>
          <Link to="/news" className={buttonClasses('secondary', 'sm', 'gap-1.5')}>
            <span>{t('shop.newsTeaser.alleBeitraege')}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {posts.map((post) => {
            const cover = newsCoverSrc(post.cover_url)
            const datum = formatNewsDatum(post.published_at || post.created_at, i18n.language)
            return (
              <Link
                key={post.slug}
                to={`/news/${post.slug}`}
                className="msm-card msm-shop-card-lift group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low/90 hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <div className="aspect-[16/9] w-full overflow-hidden bg-surface-container-high">
                  {cover ? (
                    <img
                      src={cover}
                      alt={post.title}
                      width={640}
                      height={360}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 via-surface-container-high to-surface-container">
                      <Newspaper className="h-8 w-8 text-primary/45" aria-hidden="true" />
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col justify-between gap-3 p-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={categoryBadgeVariant(post.category)}>
                        {t(`news.kategorien.${post.category}`)}
                      </Badge>
                      {datum && (
                        <span className="text-xs text-on-surface-variant">{datum}</span>
                      )}
                    </div>
                    <h3 className="font-headline text-base font-bold leading-snug text-on-surface group-hover:text-primary">
                      {post.title}
                    </h3>
                    {post.summary && (
                      <p className="line-clamp-2 text-xs leading-relaxed text-on-surface-variant sm:text-sm">
                        {post.summary}
                      </p>
                    )}
                  </div>

                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    <span>{t('news.weiterlesen')}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
