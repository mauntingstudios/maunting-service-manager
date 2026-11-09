import { useTranslation } from 'react-i18next'
import {
  Ban,
  Bell,
  BellOff,
  Camera,
  LogOut,
  Phone,
  Share2,
  Settings2,
  ShieldCheck,
  Timer,
  Trash2,
  UserRound,
  Video,
} from 'lucide-react'
import { Blatteintrag } from '@maunting/ui'

/** Was das Menü über den offenen Direktchat wissen muss. */
export interface MenueKontakt {
  istFreund: boolean
  blockiert: boolean
}

/** Was das Menü über die offene Gruppe wissen muss. */
export interface MenueGruppe {
  hatEinladung: boolean
  istEigentuemer: boolean
  istAdmin: boolean
}

interface ChatActionsMenuProps {
  /** Schliesst das Blatt; jede Wahl ruft es vor ihrer Aktion. */
  schliessen: () => void
  /** `null`, solange der Chat kein Postfach hat: dann gibt es nichts stummzuschalten. */
  stumm: boolean | null
  kontakt: MenueKontakt | null
  gruppe: MenueGruppe | null
  /** Die heutige Frist als Text, etwa „Aus" oder „1 Tag". */
  verfallStufe: string
  verfallErlaubt: boolean
  onStumm: () => void
  onProfil: () => void
  onSicherheitsnummer: () => void
  onVerfall: () => void
  onVideoanruf: () => void
  /** Fehlt außerhalb einer Freundschaft; dann gibt es keinen Sprachanruf. */
  onSprachanruf?: () => void
  /** Nur in Gruppen; ohne Recht erscheint der Eintrag gesperrt. */
  onGruppenanruf?: { erlaubt: boolean; onStarten: () => void }
  /** Kamera für einen Augenblick; nur bei Freunden. */
  onAugenblick?: () => void
  onHintergrund?: () => void
  onEinladung: () => void
  /** Öffnet die Gruppen-Einstellungen: Allgemein, Mitglieder, Rollen, Hintergrund. */
  onEinstellungen: () => void
  onLoeschen: () => void
  onVerlassen: () => void
  onBlockieren: () => void
  /** Nimmt den Direktchat aus der Liste, samt örtlichem Verlauf. */
  onChatEntfernen: () => void
}

/**
 * Die Einträge im Menü des offenen Chats.
 *
 * Wer welchen Eintrag sieht, ist hier nur Anzeige: Löschen, Rollen und Logo
 * prüft der Server ohnehin. Das Menü blendet aus, was ohne Recht sicher
 * scheitern würde.
 */
export function ChatActionsMenu({
  schliessen,
  stumm,
  kontakt,
  gruppe,
  verfallStufe,
  verfallErlaubt,
  ...aktion
}: ChatActionsMenuProps) {
  const { t } = useTranslation()
  const tu = (f: () => void) => () => {
    schliessen()
    f()
  }

  return (
    <div className="space-y-0.5">
      {/* 1. Bereich: Profil, Identität & Gruppe */}
      {kontakt && (
        <Blatteintrag
          icon={<UserRound className="w-4 h-4 text-on-surface-variant" />}
          label={t('social.profile.show')}
          onClick={tu(aktion.onProfil)}
        />
      )}
      {kontakt && (
        <Blatteintrag
          icon={<ShieldCheck className="w-4 h-4 text-on-surface-variant" />}
          label={t('messenger.verifySafetyNumber')}
          onClick={tu(aktion.onSicherheitsnummer)}
        />
      )}
      {gruppe && (
        <Blatteintrag
          icon={<Settings2 className="w-4 h-4 text-on-surface-variant" />}
          label={t('messenger.groupSettings')}
          onClick={tu(aktion.onEinstellungen)}
        />
      )}
      {gruppe && gruppe.hatEinladung && (
        <Blatteintrag
          icon={<Share2 className="w-4 h-4 text-on-surface-variant" />}
          label={t('messenger.copyInvite')}
          onClick={tu(aktion.onEinladung)}
        />
      )}

      {/* Trennlinie */}
      <div className="my-1 border-t border-outline-variant/20" />

      {/* 2. Bereich: Medien & Anrufe */}
      {kontakt?.istFreund && (
        <Blatteintrag
          icon={<Video className="w-4 h-4 text-on-surface-variant" />}
          label={t('messenger.videoCall')}
          onClick={tu(aktion.onVideoanruf)}
        />
      )}
      {aktion.onSprachanruf && (
        <Blatteintrag
          icon={<Phone className="w-4 h-4 text-on-surface-variant" />}
          label={t('messenger.startVoiceCall')}
          onClick={tu(aktion.onSprachanruf)}
        />
      )}
      {kontakt?.istFreund && aktion.onAugenblick && (
        <Blatteintrag
          icon={<Camera className="w-4 h-4 text-on-surface-variant" />}
          label={t('messenger.moment.take')}
          onClick={tu(aktion.onAugenblick)}
        />
      )}
      {gruppe && aktion.onGruppenanruf && (
        <Blatteintrag
          icon={<Phone className="w-4 h-4 text-on-surface-variant" />}
          label={t('messenger.startGroupCall')}
          hinweis={aktion.onGruppenanruf.erlaubt ? undefined : t('messenger.noStartCallRight')}
          disabled={!aktion.onGruppenanruf.erlaubt}
          onClick={tu(aktion.onGruppenanruf.onStarten)}
        />
      )}

      {/* 3. Bereich: Chat-Einstellungen & Benachrichtigungen */}
      <Blatteintrag
        icon={<Timer className="w-4 h-4 text-on-surface-variant" />}
        label={t('messenger.disappearingMessages')}
        hinweis={verfallErlaubt ? verfallStufe : `${verfallStufe} · ${t('messenger.retentionNoRight')}`}
        disabled={!verfallErlaubt}
        onClick={tu(aktion.onVerfall)}
      />
      {stumm !== null && (
        <Blatteintrag
          icon={stumm ? <Bell className="w-4 h-4 text-status-warning" /> : <BellOff className="w-4 h-4 text-on-surface-variant" />}
          label={stumm ? t('messenger.unmute') : t('messenger.mute')}
          onClick={tu(aktion.onStumm)}
        />
      )}

      {/* Trennlinie vor Gefahrenzone */}
      <div className="my-1 border-t border-outline-variant/20" />

      {/* 4. Bereich: Entfernen & Gefahrenzone */}
      {kontakt && (
        <Blatteintrag
          icon={<Trash2 className="w-4 h-4 text-status-destructive" />}
          label={t('messenger.removeChatFromList')}
          gefahr
          onClick={tu(aktion.onChatEntfernen)}
        />
      )}
      {kontakt && (
        <Blatteintrag
          icon={<Ban className="w-4 h-4 text-status-destructive" />}
          label={kontakt.blockiert ? t('messenger.unblockContact') : t('messenger.blockContact')}
          gefahr={!kontakt.blockiert}
          onClick={tu(aktion.onBlockieren)}
        />
      )}
      {gruppe && (gruppe.istEigentuemer ? (
        <Blatteintrag
          icon={<Trash2 className="w-4 h-4 text-status-destructive" />}
          label={t('messenger.deleteGroup')}
          gefahr
          onClick={tu(aktion.onLoeschen)}
        />
      ) : (
        <Blatteintrag
          icon={<LogOut className="w-4 h-4 text-status-destructive" />}
          label={t('messenger.leaveGroup')}
          gefahr
          onClick={tu(aktion.onVerlassen)}
        />
      ))}
    </div>
  )
}
