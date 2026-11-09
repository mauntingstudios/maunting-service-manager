import { Globe2, Image as ImageIcon, Plus, RotateCw, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Blatteintrag, Blattmenue } from '@maunting/ui'

interface AiChatMenueProps {
  offen: boolean
  onSchliessen: () => void
  onNewChat?: () => void
  onOpenHistorySearch?: () => void
  onOpenGeo: () => void
  onOpenWallpaper: () => void
  onClearHistory: () => void
  singraShell: boolean
  busy: boolean
  streaming: boolean
  reloading: boolean
  empty: boolean
  geoOpen: boolean
  hasGeoData: boolean
  onReload: () => void
}

export function AiChatMenue({
  offen,
  onSchliessen,
  onNewChat,
  onOpenHistorySearch,
  onOpenGeo,
  onOpenWallpaper,
  onClearHistory,
  singraShell,
  busy,
  streaming,
  reloading,
  empty,
  geoOpen,
  hasGeoData,
  onReload,
}: AiChatMenueProps) {
  const { t } = useTranslation()

  return (
    <Blattmenue
      offen={offen}
      onSchliessen={onSchliessen}
      titel={t('ai.chat.title')}
      className="bg-surface-container-high/95 backdrop-blur-2xl border border-outline-variant/30 text-on-surface shadow-2xl"
    >
      <div className="px-4 pt-3 pb-2 text-xs font-semibold text-on-surface-variant truncate border-b border-outline-variant/20">
        {t('ai.chat.title')}
      </div>
      <div className="py-1">
        {onNewChat && (
          <Blatteintrag
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            label={t('ai.chat.newChat', 'Neuer Chat')}
            onClick={() => {
              onSchliessen()
              onNewChat()
            }}
          />
        )}
        <Blatteintrag
          icon={<RotateCw className={`h-4 w-4 ${reloading ? 'animate-spin' : ''}`} aria-hidden="true" />}
          label={t('common.refresh', 'Aktualisieren')}
          disabled={busy || streaming}
          onClick={() => {
            onSchliessen()
            onReload()
          }}
        />
        {singraShell && onOpenHistorySearch && (
          <Blatteintrag
            icon={<Search className="h-4 w-4" aria-hidden="true" />}
            label={t('ai.chat.searchConversations')}
            onClick={() => {
              onSchliessen()
              onOpenHistorySearch()
            }}
          />
        )}
        {hasGeoData && !geoOpen && (
          <Blatteintrag
            icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
            label={t('ai.geo.open')}
            onClick={() => {
              onSchliessen()
              onOpenGeo()
            }}
          />
        )}
        <Blatteintrag
          icon={<ImageIcon className="h-4 w-4" aria-hidden="true" />}
          label={t('social.wallpaper.title')}
          onClick={() => {
            onSchliessen()
            onOpenWallpaper()
          }}
        />
        <Blatteintrag
          icon={<Trash2 className="h-4 w-4 text-status-destructive" aria-hidden="true" />}
          label={t('ai.chat.clear')}
          gefahr
          disabled={busy || empty}
          onClick={() => {
            onSchliessen()
            onClearHistory()
          }}
        />
      </div>
    </Blattmenue>
  )
}
