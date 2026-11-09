import { useMemo, useState } from 'react'
import {
  BookOpen,
  Calendar,
  ChevronRight,
  Code2,
  Folder,
  Lightbulb,
  PenLine,
  Server,
  Sparkles,
  X,
} from 'lucide-react'
import {
  getSingraTimeOfDay,
  SINGRA_STARTER_CATEGORIES,
  type SingraStarterCategory,
} from './singraTemplates'

function CategoryIcon({
  name,
  className = 'h-5 w-5',
}: {
  name: SingraStarterCategory['iconName']
  className?: string
}) {
  switch (name) {
    case 'lightbulb':
      return <Lightbulb className={className} aria-hidden="true" />
    case 'code':
      return <Code2 className={className} aria-hidden="true" />
    case 'book':
      return <BookOpen className={className} aria-hidden="true" />
    case 'pen':
      return <PenLine className={className} aria-hidden="true" />
    case 'sparkles':
      return <Sparkles className={className} aria-hidden="true" />
    case 'server':
      return <Server className={className} aria-hidden="true" />
    case 'folder':
      return <Folder className={className} aria-hidden="true" />
    case 'calendar':
      return <Calendar className={className} aria-hidden="true" />
  }
}

export function SingraScenicBackground({ visible }: { visible: boolean }) {
  const timeInfo = useMemo(() => getSingraTimeOfDay(), [])
  if (!visible) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden transition-opacity duration-500"
      aria-hidden="true"
    >
      <img
        src={timeInfo.bgImage}
        alt=""
        className="h-full w-full object-cover object-center scale-[1.01] transition-transform duration-700"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/50 via-surface/70 to-surface" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(251,191,36,0.08),transparent_65%)]" />
    </div>
  )
}

interface SingraEmptyStateProps {
  userName?: string | null
  onSelectPrompt: (prompt: string) => void
  activeProjectName?: string | null
}

export function SingraEmptyState({
  userName,
  onSelectPrompt,
  activeProjectName,
}: SingraEmptyStateProps) {
  const timeInfo = useMemo(() => getSingraTimeOfDay(), [])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [showAllCategories, setShowAllCategories] = useState(false)

  const cleanName = (userName || '').trim()
  const greetingTitle = cleanName
    ? `${timeInfo.greetingPrefix} ${cleanName},`
    : `${timeInfo.greetingPrefix},`

  const visibleCategories = showAllCategories
    ? SINGRA_STARTER_CATEGORIES
    : SINGRA_STARTER_CATEGORIES.slice(0, 5)

  const selectedCategory =
    SINGRA_STARTER_CATEGORIES.find((c) => c.id === selectedCategoryId) ?? null

  return (
    <div className="relative z-10 flex flex-col items-center justify-center px-3 py-8 sm:px-6 sm:py-14 text-center">
      {/* Glowing Singra Logo Emblem */}
      <div className="mb-5 flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full border border-primary/40 bg-black/70 shadow-[0_0_36px_rgba(56,189,248,0.35)] backdrop-blur-md overflow-hidden p-1.5">
        <img
          src="/singra-logo.png"
          alt="Singra Logo"
          className="h-full w-full object-contain rounded-full drop-shadow-[0_0_20px_rgba(56,189,248,0.65)]"
        />
      </div>

      {/* Personal Time-of-Day Greeting */}
      <h2 className="font-headline text-2xl sm:text-4xl font-semibold tracking-tight text-white drop-shadow-sm">
        {greetingTitle}
      </h2>
      <p className="mt-2 text-sm sm:text-lg text-white/80 font-normal">
        {activeProjectName
          ? `woran möchten wir im Projekt „${activeProjectName}“ arbeiten?`
          : 'wie kann ich dir heute helfen?'}
      </p>

      {/* Starter Category Cards */}
      <div className="mt-7 sm:mt-9 w-full max-w-4xl">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
          {visibleCategories.map((cat, idx) => {
            const isSelected = selectedCategoryId === cat.id
            // On mobile (2-col grid), show 4 cards cleanly unless expanded
            const hideOnMobile = !showAllCategories && idx === 4
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() =>
                  setSelectedCategoryId((prev) => (prev === cat.id ? null : cat.id))
                }
                className={[
                  hideOnMobile ? 'hidden sm:flex' : 'flex',
                  'group flex-col items-center justify-center gap-2.5 rounded-2xl border px-3.5 py-4 sm:py-5 text-center transition-all duration-200 backdrop-blur-md',
                  isSelected
                    ? 'border-primary/60 bg-black/75 text-white shadow-[0_8px_28px_rgba(0,0,0,0.45)] scale-[1.01]'
                    : 'border-white/15 bg-black/50 text-white/90 hover:border-primary/45 hover:bg-black/65 hover:text-white',
                ].join(' ')}
              >
                <div
                  className={[
                    'flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
                    isSelected
                      ? 'bg-primary/20 text-primary'
                      : 'bg-white/10 text-primary/90 group-hover:bg-primary/15 group-hover:text-primary',
                  ].join(' ')}
                >
                  <CategoryIcon name={cat.iconName} className="h-5 w-5" />
                </div>
                <span className="text-xs sm:text-sm font-medium leading-snug">
                  <span className="sm:hidden">{cat.shortTitle}</span>
                  <span className="hidden sm:inline">{cat.title}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* Toggle for remaining categories */}
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAllCategories((v) => !v)}
            className="text-xs text-white/65 hover:text-white transition-colors underline underline-offset-4"
          >
            {showAllCategories
              ? 'Weniger Kategorien anzeigen'
              : 'Weitere Bereiche (Server, Dokumente, Planung) einblenden'}
          </button>
        </div>

        {/* Expanded Prompt Suggestions for Selected Category */}
        {selectedCategory && (
          <div className="mt-4 rounded-2xl border border-white/15 bg-black/70 p-4 text-left backdrop-blur-xl shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-white/10">
              <div className="flex items-center gap-2">
                <CategoryIcon
                  name={selectedCategory.iconName}
                  className="h-4 w-4 text-primary"
                />
                <span className="text-xs font-semibold text-white">
                  {selectedCategory.title}
                </span>
                <span className="hidden sm:inline text-xs text-white/60">
                  • {selectedCategory.description}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCategoryId(null)}
                className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Vorschläge schließen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedCategory.prompts.map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectPrompt(prompt)}
                  className="group flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-left text-xs text-white/85 hover:border-primary/40 hover:bg-white/10 hover:text-white transition-all"
                >
                  <span className="line-clamp-2 leading-relaxed">{prompt}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/40 group-hover:text-primary transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
