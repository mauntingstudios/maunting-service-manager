import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BookmarkCheck,
  Clock,
  ExternalLink,
  Gamepad2,
  Newspaper,
  Pin,
  Search,
  Settings,
  X,
} from 'lucide-react'
import { Badge, buttonClasses, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  NEWS_CATEGORIES,
  newsApi,
  newsCoverSrc,
  readingTimeMinutes,
  type NewsCategory,
  type NewsPostPublic,
} from '@/api/news'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

function formatNewsDate(iso: string | null, lang: string): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-US' : 'de-DE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export function categoryBadgeVariant(
  category: NewsCategory,
): 'info' | 'success' | 'warning' | 'default' | 'destructive' {
  switch (category) {
    case 'game_update':
      return 'success'
    case 'maintenance':
      return 'warning'
    case 'promo':
      return 'info'
    case 'infrastructure':
      return 'default'
    case 'world_news':
      return 'info'
    default:
      return 'default'
  }
}

export function NewsOverview() {
  const { t, i18n } = useTranslation()
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)
  const canManageNews =
    useHasPermission('panel.news.manage') ||
    useHasPermission('panel.settings.write') ||
    useHasPermission('shop.write')

  const [posts, setPosts] = useState<NewsPostPublic[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<NewsCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
    }, 220)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    let aktiv = true
    setLoading(true)
    setLoadFailed(false)
    newsApi
      .listPublic({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        q: debouncedQuery || undefined,
        limit: 30,
      })
      .then((res) => {
        if (!aktiv) return
        setPosts(Array.isArray(res?.items) ? res.items : [])
      })
      .catch((err) => {
        still(err, 'NewsOverview.listPublic')
        if (aktiv) {
          setPosts([])
          setLoadFailed(true)
        }
      })
      .finally(() => {
        if (aktiv) setLoading(false)
      })
    return () => {
      aktiv = false
    }
  }, [selectedCategory, debouncedQuery])

  const leadPost = posts[0] ?? null
  const remainingPosts = leadPost ? posts.slice(1) : []
  const leadCover = newsCoverSrc(leadPost?.cover_url)

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-4 border-b border-outline-variant/30 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 text-label-sm font-semibold uppercase tracking-[0.18em] text-primary">
            <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('news.kicker')}</span>
          </p>
          <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface sm:text-4xl">
            {t('news.titel')}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-on-surface-variant sm:text-base">
            {t('news.untertitel')}
          </p>
        </div>

        {canManageNews && (
          <Link
            to="/settings?tab=news"
            className={buttonClasses('secondary', 'sm', 'shrink-0 gap-1.5 self-start md:self-auto')}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            <span>{t('news.cms.verwalten')}</span>
          </Link>
        )}
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t('news.filter.kategorie')}
        >
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            aria-pressed={selectedCategory === 'all'}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              selectedCategory === 'all'
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
            }`}
          >
            {t('news.kategorien.all')}
          </button>
          {NEWS_CATEGORIES.map((kat) => {
            const aktiv = selectedCategory === kat
            return (
              <button
                key={kat}
                type="button"
                onClick={() => setSelectedCategory(kat)}
                aria-pressed={aktiv}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  aktiv
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
                }`}
              >
                {t(`news.kategorien.${kat}`)}
              </button>
            )
          })}
        </div>

        <div className="relative w-full lg:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('news.suchePlaceholder')}
            aria-label={t('news.suchePlaceholder')}
            className="h-10 w-full rounded-xl border border-outline-variant/50 bg-surface-container-low pl-9 pr-9 text-sm text-on-surface placeholder:text-on-surface-variant/70 focus:border-primary focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={t('common.clear', 'Zurücksetzen')}
              className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div
          className="flex items-center justify-center gap-2.5 py-16 text-sm text-on-surface-variant"
          role="status"
        >
          <Spinner size="md" />
          <span>{t('news.laedt')}</span>
        </div>
      ) : loadFailed ? (
        <Zustandsflaeche
          art="fehler"
          icon={<Newspaper className="h-10 w-10" aria-hidden="true" />}
          titel={t('news.fehlerLadenTitel')}
          text={t('news.fehlerLadenBeschreibung')}
        />
      ) : !leadPost ? (
        <Zustandsflaeche
          art="leer"
          icon={<Newspaper className="h-10 w-10" aria-hidden="true" />}
          titel={t('news.leerTitel')}
          text={t('news.leerBeschreibung')}
        >
          {(selectedCategory !== 'all' || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all')
                setSearchQuery('')
              }}
              className={buttonClasses('secondary', 'sm', 'mt-2')}
            >
              {t('news.filterZuruecksetzen')}
            </button>
          )}
        </Zustandsflaeche>
      ) : (
        <div className="space-y-8">
          <article className="msm-card overflow-hidden border-outline-variant/40 bg-surface-container/75 transition-colors hover:border-primary/40">
            <div className="grid gap-0 lg:grid-cols-12">
              <div className="relative aspect-[16/10] bg-surface-container-high lg:col-span-6 lg:aspect-auto lg:min-h-[280px]">
                {leadCover ? (
                  <img
                    src={leadCover}
                    alt={leadPost.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-[220px] items-center justify-center bg-gradient-to-br from-primary/15 via-surface-container-high to-surface-container-low p-8">
                    <Newspaper className="h-14 w-14 text-primary/45" aria-hidden="true" />
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-between gap-5 p-6 sm:p-8 lg:col-span-6">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={categoryBadgeVariant(leadPost.category)}>
                      {t(`news.kategorien.${leadPost.category}`)}
                    </Badge>
                    {leadPost.is_pinned && (
                      <Badge variant="info">
                        <Pin className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        {t('news.angepinnt')}
                      </Badge>
                    )}
                    {leadPost.sources.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant">
                        <BookmarkCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>{t('news.quellenAnzahl', { count: leadPost.sources.length })}</span>
                      </span>
                    )}
                  </div>

                  <h2 className="font-headline text-2xl font-bold leading-snug text-on-surface sm:text-3xl">
                    <Link
                      to={`/news/${leadPost.slug}`}
                      className="transition-colors hover:text-primary"
                    >
                      {leadPost.title}
                    </Link>
                  </h2>

                  {leadPost.summary && (
                    <p className="text-sm leading-relaxed text-on-surface-variant sm:text-base">
                      {leadPost.summary}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/25 pt-4 text-xs text-on-surface-variant">
                  <div className="flex flex-wrap items-center gap-3">
                    {leadPost.published_at && (
                      <span>{formatNewsDate(leadPost.published_at, i18n.language)}</span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {t('news.lesezeit', {
                          minuten: readingTimeMinutes(leadPost.content_markdown),
                        })}
                      </span>
                    </span>
                    {leadPost.related_game_type && shopEnabled && (
                      <Link
                        to={`/shop/${leadPost.related_game_type}`}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{leadPost.related_game_type}</span>
                      </Link>
                    )}
                  </div>

                  <Link
                    to={`/news/${leadPost.slug}`}
                    className={buttonClasses('primary', 'sm', 'gap-1.5')}
                  >
                    <span>{t('news.weiterlesen')}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </article>

          {remainingPosts.length > 0 && (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {remainingPosts.map((post) => {
                const coverSrc = newsCoverSrc(post.cover_url)
                return (
                  <article
                    key={post.slug}
                    className="msm-card flex flex-col overflow-hidden border-outline-variant/40 bg-surface-container/65 transition-colors hover:border-primary/40"
                  >
                    <Link
                      to={`/news/${post.slug}`}
                      className="block aspect-[16/9] overflow-hidden bg-surface-container-high"
                    >
                      {coverSrc ? (
                        <img
                          src={coverSrc}
                          alt={post.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-surface-container-high to-surface-container-low">
                          <Newspaper className="h-9 w-9 text-primary/40" aria-hidden="true" />
                        </div>
                      )}
                    </Link>

                    <div className="flex flex-1 flex-col justify-between gap-4 p-5">
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={categoryBadgeVariant(post.category)}>
                            {t(`news.kategorien.${post.category}`)}
                          </Badge>
                          {post.sources.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-label-sm text-on-surface-variant">
                              <ExternalLink className="h-3 w-3 text-primary" aria-hidden="true" />
                              <span>{t('news.quellenAnzahl', { count: post.sources.length })}</span>
                            </span>
                          )}
                        </div>

                        <h3 className="font-headline text-lg font-bold leading-snug text-on-surface">
                          <Link
                            to={`/news/${post.slug}`}
                            className="transition-colors hover:text-primary"
                          >
                            {post.title}
                          </Link>
                        </h3>

                        {post.summary && (
                          <p className="line-clamp-3 text-sm leading-relaxed text-on-surface-variant">
                            {post.summary}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-outline-variant/25 pt-3 text-xs text-on-surface-variant">
                        <div className="flex items-center gap-2.5">
                          {post.published_at && (
                            <span>{formatNewsDate(post.published_at, i18n.language)}</span>
                          )}
                          <span>
                            {t('news.lesezeitKurz', {
                              minuten: readingTimeMinutes(post.content_markdown),
                            })}
                          </span>
                        </div>
                        <Link
                          to={`/news/${post.slug}`}
                          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                        >
                          <span>{t('news.lesen')}</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
