import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  Clock,
  ExternalLink,
  Gamepad2,
  Newspaper,
  Pin,
  User,
} from 'lucide-react'
import { Badge, buttonClasses, Spinner, Zustandsflaeche } from '@maunting/ui'
import {
  isValidHttpsUrl,
  newsApi,
  newsCoverSrc,
  readingTimeMinutes,
  type NewsPostPublic,
} from '@/api/news'
import { AiMarkdown } from '@/components/ai/AiMarkdown'
import { still } from '@/lib/still'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { categoryBadgeVariant } from './NewsOverview'

function formatFullDate(iso: string | null, lang: string): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-US' : 'de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export function NewsDetail() {
  const { slug } = useParams<{ slug: string }>()
  const { t, i18n } = useTranslation()
  const shopEnabled = usePublicSettingsStore((s) => s.shop_enabled)

  const [post, setPost] = useState<NewsPostPublic | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!slug) {
      setNotFound(true)
      setLoading(false)
      return
    }
    let aktiv = true
    setLoading(true)
    setNotFound(false)
    newsApi
      .getPublicBySlug(slug)
      .then((data) => {
        if (!aktiv) return
        setPost(data)
      })
      .catch((err) => {
        still(err, 'NewsDetail.getPublicBySlug')
        if (aktiv) {
          setPost(null)
          setNotFound(true)
        }
      })
      .finally(() => {
        if (aktiv) setLoading(false)
      })
    return () => {
      aktiv = false
    }
  }, [slug])

  if (loading) {
    return (
      <div
        className="flex items-center justify-center gap-2.5 py-20 text-sm text-on-surface-variant"
        role="status"
      >
        <Spinner size="md" />
        <span>{t('news.laedt')}</span>
      </div>
    )
  }

  if (notFound || !post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Zustandsflaeche
          art="leer"
          icon={<Newspaper className="h-10 w-10" aria-hidden="true" />}
          titel={t('news.nichtGefundenTitel')}
          text={t('news.nichtGefundenBeschreibung')}
        >
          <Link to="/news" className={buttonClasses('primary', 'sm', 'mt-2 gap-1.5')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{t('news.zurueckZurUebersicht')}</span>
          </Link>
        </Zustandsflaeche>
      </div>
    )
  }

  const coverSrc = newsCoverSrc(post.cover_url)
  const validSources = post.sources.filter((s) => s.title && isValidHttpsUrl(s.url))

  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
      <div>
        <Link
          to="/news"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-on-surface-variant transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t('news.zurueckZurUebersicht')}</span>
        </Link>
      </div>

      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={categoryBadgeVariant(post.category)}>
            {t(`news.kategorien.${post.category}`)}
          </Badge>
          {post.is_pinned && (
            <Badge variant="info">
              <Pin className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {t('news.angepinnt')}
            </Badge>
          )}
        </div>

        <h1 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-on-surface sm:text-4xl">
          {post.title}
        </h1>

        {post.summary && (
          <p className="text-base leading-relaxed text-on-surface-variant sm:text-lg">
            {post.summary}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4 border-y border-outline-variant/25 py-3 text-xs text-on-surface-variant">
          {post.published_at && (
            <span>{formatFullDate(post.published_at, i18n.language)}</span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {t('news.lesezeit', {
                minuten: readingTimeMinutes(post.content_markdown),
              })}
            </span>
          </span>
          {post.author_display_name && (
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{post.author_display_name}</span>
            </span>
          )}
        </div>
      </header>

      {coverSrc && (
        <div className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high">
          <img
            src={coverSrc}
            alt={post.title}
            className="max-h-[420px] w-full object-cover"
          />
        </div>
      )}

      <div className="msm-card p-6 sm:p-8">
        <AiMarkdown content={post.content_markdown} />
      </div>

      {validSources.length > 0 && (
        <section
          aria-labelledby="news-sources-heading"
          className="rounded-2xl border border-outline-variant/35 bg-surface-container-low/70 p-5 sm:p-6"
        >
          <h2
            id="news-sources-heading"
            className="flex items-center gap-2 font-headline text-sm font-bold uppercase tracking-wider text-on-surface"
          >
            <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>{t('news.quellenUeberschrift')}</span>
          </h2>
          <ul className="mt-3 space-y-2">
            {validSources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{source.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {post.related_game_type && shopEnabled && (
        <section className="flex flex-col justify-between gap-4 rounded-2xl border border-primary/35 bg-primary/10 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('news.passendesSpielLabel')}</span>
            </p>
            <p className="font-headline text-base font-bold text-on-surface">
              {t('news.passendesSpielHinweis', { game: post.related_game_type })}
            </p>
          </div>
          <Link
            to={`/shop/${post.related_game_type}`}
            className={buttonClasses('primary', 'sm', 'shrink-0 gap-1.5 self-start sm:self-auto')}
          >
            <span>{t('news.serverKonfigurieren')}</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      )}
    </article>
  )
}
