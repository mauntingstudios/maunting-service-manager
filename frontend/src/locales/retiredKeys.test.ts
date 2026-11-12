import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'

/**
 * Abgelöste Schlüssel müssen verschwinden, nicht nur unbenutzt herumliegen.
 *
 * Beim Umbau des Gedächtnisbereichs sind `ai.memory.title`, `.description`,
 * `.teamTitle` und `.teamDescription` durch die Bereichsform
 * `ai.memory.titles.<kind>` / `ai.memory.descriptions.<kind>` ersetzt worden —
 * AiMemoryManager.tsx:204-205 bildet den Schlüssel zur Laufzeit aus
 * `scope.kind`. `teams.personalHint` wurde von `teams.personalKnowledgeHint`
 * abgelöst (Teams.tsx). Die alten Zeilen blieben stehen, wortgleich mit ihren
 * Nachfolgern: wer den Teamtext ändert, ändert mit hoher Wahrscheinlichkeit
 * den toten Zwilling und wundert sich, dass die Oberfläche gleich bleibt.
 *
 * Warum eine gepflegte Liste und keine allgemeine „jeder Schlüssel wird
 * benutzt"-Regel: die Oberfläche setzt Schlüssel zur Laufzeit zusammen, eine
 * solche Regel wäre entweder löchrig oder bestünde aus Ausnahmen.
 * `scripts/check-i18n.mjs` prüft die Gegenrichtung (benutzt, aber nicht
 * übersetzt); dies hier ist die fehlende Hälfte.
 *
 * Der ganze Namensraum `permissions` ist entfallen: 34 Kurzbeschriftungen für
 * Rechte, die kein `t()`-Aufruf je gelesen hat, weil der PermissionEditor seine
 * Texte fest verdrahtet im Quelltext trug. Jetzt liest er sie aus
 * `permissionDetails.<schlüssel mit _ statt .>` — und zwei Fassungen desselben
 * Rechtetextes wären schlimmer als die eine deutsche von vorher.
 *
 * `ai.providers.voices` und `ai.providers.realtimeHint` sind am 16.08.2026 mit
 * OpenAIs Realtime-API gefallen. Die acht Stimmen gehörten dem Modell und
 * hatten deshalb eine Beschriftung im Panel („Ash — ruhig, tief"); eine
 * ElevenLabs-Stimme gehört dem Konto des Betreibers, MSM kennt sie nicht und
 * kann sie folglich nicht beschriften. Aus dem Auswahlfeld ist ein Textfeld
 * geworden.
 *
 * Diese beiden sind der Grund, warum es diese Liste gibt: acht wortreiche
 * Hörprofile, die niemand mehr liest, sähen in der Sprachdatei aus wie
 * gepflegte Texte — und der Nächste, der eine Stimme beschreiben will, fände
 * sie und schriebe daran weiter.
 */
const ABGELOESTE_SCHLUESSEL = [
  // 09/2026: vier Schlüssel sagten dasselbe wie `common.apply` und
  // `common.reset` — auf Deutsch Wort für Wort, auf Englisch in vier
  // Fassungen („Apply", „Use it", „Adopt", „Reset"). Der fünfte Zwilling,
  // `ai.guardian.takeOver`, bleibt: „übernehmen" heißt dort nicht
  // „anwenden", sondern „die Steuerung an sich nehmen", und heißt seitdem
  // auch so.
  'profile.timezoneAdopt',
  'ai.providers.recommendationApply',
  'mss.wakeword.zuruecksetzen',
  'databaseConsole.reset',
  // 09/2026: die Panel-Datenbank öffnet das PostgreSQL-Studio
  // (`postgresStudio.*`); die eigene Konsole ist mit ihren Texten entfallen.
  'databaseConsole',
  'panelDatabase.workspace',
  'panelDatabase.rowsDeleted',
  'ai.memory.title',
  'ai.memory.description',
  'ai.memory.teamTitle',
  'ai.memory.teamDescription',
  'teams.personalHint',
  'permissions',
  'ai.providers.voices',
  'ai.providers.realtimeHint',
  // 09/2026: die KI hat kein Werkzeug mehr, das den Messenger anfasst. Die
  // Beschriftungen der beiden Suchen und der Text des Rechts
  // `ai.social.message_friend` beschrieben ab da etwas, das es nicht gibt —
  // und ein Rechtetext ist im Rechteeditor eine Zusage, keine Dekoration.
  'ai.tools.search_messenger_contacts',
  'ai.tools.search_messenger_groups',
  'ai.toolsRunning.search_messenger_contacts',
  'ai.toolsRunning.search_messenger_groups',
  'permissionDetails.ai_social_message_friend',
  // 09/2026: 342 Schlüssel, die kein Aufruf je gelesen hat (11 % der Datei),
  // gefunden mit scripts/find-orphan-keys.mjs. Nicht alle stehen hier — eine
  // Liste mit 342 Zeilen wäre selbst Ballast. Hier steht, was jemand aus
  // Versehen neu anlegen würde, weil ein lebender Zwilling daneben liegt:
  //
  // `verifyEmail.*` beschrieb eine Seite, die es nie gab. Der echte Ablauf
  // liegt unter `setup.verifyEmail*` — wer die Bestätigungsseite anfasst,
  // findet über die Suche sonst fünf plausible Schlüssel, die nirgends
  // erscheinen.
  'verifyEmail.title',
  'verifyEmail.loading',
  'verifyEmail.success',
  'verifyEmail.error',
  'verifyEmail.noToken',
  // `nav.social` ("Social & Hub") hat keine Route in navigation.tsx.
  'nav.social',
  // `shell.openUserMenu` neben den lebenden `shell.mainNavigation` und
  // `shell.closeNavigation`.
  'shell.openUserMenu',
  // 09/2026: Die Videonotiz hat keine Wischgeste mehr. Sie hing am
  // Vollbildrahmen und fing die Berührung des Sendeknopfs darin ab; abbrechen
  // und senden gehen jetzt nur noch über die beiden Knöpfe. Ein Hinweis, der
  // eine Geste erklärt, die es nicht gibt, ist schlimmer als keiner.
  'social.videoNote.swipeToLock',
  // 09/2026: Mit GPT-Live trägt OpenAI zwei Sprachwege, und welcher gilt,
  // entscheidet das Modell, nicht der Anbieter. Die Texte stehen seitdem je
  // Weg unter `ai.providers.realtime.wege.<weg>`; die alten Paare aus
  // OpenAI-Text und `google…`-Zwilling hätten für GPT-Live einen dritten
  // Zwilling gebraucht. `reasoningValues` sagte Wort für Wort dasselbe wie
  // `ai.reasoning.levels` und kannte die Stufen von GPT-Live nicht.
  'ai.providers.realtime.title',
  'ai.providers.realtime.googleTitle',
  'ai.providers.realtime.hint',
  'ai.providers.realtime.googleHint',
  'ai.providers.realtime.voice',
  'ai.providers.realtime.googleVoice',
  'ai.providers.realtime.reasoningHint',
  'ai.providers.realtime.googleReasoningHint',
  'ai.providers.realtime.reasoningValues',
  // 09/2026: Der Link zur Szene fiel mit dem neuen Copernicus-Katalog. Seine
  // Adresse lädt bei CREODIAS nur die kleine Vorschau als Datei herunter, die
  // der Reiter schon zeigt — Vollauflösung war das nie. Eine echte
  // Vollansicht bräuchte einen eigenen Weg, etwa den Copernicus Browser.
  'ai.geo.openFullScene',
  // 25.09.2026: jede Karte bestätigt nur noch der Klick, auch im Sprachmodus.
  // Die Unterscheidung „sag Ja" / „klick hier" / „klick im Chat" gibt es
  // nicht mehr; `ai.voice.vorschlag.hint` sagt jetzt das eine.
  'ai.voice.vorschlag.hintKlick',
  'ai.voice.vorschlag.hintKlickChat',
  // 27.09.2026: Profil und App-Einstellungen haben weniger Reiter. Passwort,
  // 2FA, Messenger-PIN und Tresor stehen unter „Sicherheit", verknüpfte
  // Konten und Zugangsdaten unter „Verbindungen", das Wake-Word unter Audio.
  // Die alten `?tab=`-Werte führen weiter an den neuen Ort; ihre Beschriftungen
  // brauchte nur die Reiterleiste.
  'profile.tabs.password',
  'profile.tabs.setPassword',
  'profile.tabs.2fa',
  'profile.tabs.linked',
  'profile.tabs.credentials',
  'profile.tabs.messenger',
  'profile.tabs.vault',
  'mss.einstellungen.tab.wakeword',
  // 28.09.2026: Das Geheimnisfeld der eigenen Zugangsdaten heißt je Art
  // anders (Steam-Passwort, GitHub-Token); ein neutrales „Geheimnis" ließ
  // offen, was hineingehört.
  'credentials.secret',
  'credentials.secretHint',
  // 28.09.2026: Die Nutzungszeit hat eine Fassung (`Nutzungszeit.tsx`) für
  // Browser, App und fremdes Profil. Das tote `AchievementsModal` trug die
  // übrigen Kacheltexte; die Gesamtzeit heißt jetzt `statActivity`.
  'social.milestones.platformActivity',
  'social.milestones.progress',
  'social.milestones.statAi',
  'social.milestones.statAdmin',
  'social.milestones.statCommands',
  'mss.social.gesamtaktivitaet',
  // 29.09.2026: Ein Konto hat mehrere zweite Faktoren. Die Wahl „App oder
  // Passkey“ und die Umschalter zwischen genau zwei Wegen sind gefallen.
  'profile.2faSetup',
  'profile.2faChooseMethod',
  'profile.2faMethodTotp',
  'profile.2faMethodTotpDesc',
  'profile.2faMethodPasskey',
  'profile.2faMethodPasskeyDesc',
  'profile.2faPasskeySetupBtn',
  'profile.2faPasskeySuccess',
  'profile.2faPasskeyFailed',
  'profile.2faDisableWithPasskey',
  'profile.dataExport.passkeyHint',
  'profile.dataExport.passkeyHintApp',
  'profile.linkedAccounts.linkPasskeyHint',
  'auth.use2FAInstead',
  'auth.usePasskeyInstead',
  // 04.10.2026: der Wechsel „Stattdessen …" ist einer sichtbaren Wahl
  // gewichen (`auth.zweitfaktor.wegPasskey`/`wegTotp`, wie beim Login).
  'auth.zweitfaktor.usePasskey',
  'auth.zweitfaktor.useCode',

  // 04.11.2026: wortgleiche Duplikate in `common.*` zusammengeführt;
  // dynamisch zusammengesetzte Schlüssel bleiben erhalten.
  'ai.skills.save',
  'settings.steamAccountSave',
  'settings.save',
  'settings.oauth.save',
  'credentials.save',
  'social.groupRoles.generalSave',
  'browser.workspaces.speichern',
  'browser.formular.speichern',
  'server.authSetup.cancel',
  'mss.aufraeumen.nein',
  'mss.wakeword.abbrechen',
  'mss.gefahrenzone.abbrechen',
  'mss.einstellungen.computerUse.abbrechen',
  'mss.einstellungen.artefakte.abbrechen',
  'mss.schliessen.abbrechen',
  'browser.workspaces.abbrechen',
  'browser.drittanbieterHinweis.abbrechen',
  'blueprints.delete',
  'blueprints.deleteConfirm',
  'docs.comments.delete',
  'users.delete',
  'settings.oauth.delete',
  'browser.einstellungen.loeschen',
  'mods.remove',
  'settings.steamAccountRemove',
  'settings.supportWidget.installIdRemove',
  'profile.removeAvatar',
  'profile.mailboxes.delete',
  'profile.calendars.delete',
  'profile.e2eeDevices.remove',
  'profile.zweitfaktoren.entfernen',
  'social.groupRoles.backgroundRemove',
  'browser.liste.entfernen',
  'browser.einstellungen.eintragEntfernen',
  'browser.erweiterungen.entfernen',
  'browser.uebersetzung.entfernen',
  'nodes.enrollment.copy',
  'docs.share.copy',
  'servers.consoleCopy',
  'blueprintBuilder.postInstall.copy',
  'docsCommon.copy',
  'mss.textmenue.kopieren',
  'browser.entwickler.kopieren',
  'browser.msmSuche.zusammenfassungKopierenKurz',
  'ai.memory.import.copied',
  'nodes.enrollment.copied',
  'docs.copiedExample',
  'docsSelfHosting.install.copied',
  'webhook.copied',
  'docsCommon.copied',
  'browser.msmSuche.zusammenfassungKopiert',
  'panelBackups.restoreModalClose',
  'mss.fenster.schliessen',
  'browser.fenster.schliessen',
  'browser.msmSuche.schliessen',
  'browser.msmSuche.medienVorschauSchliessen',
  'browser.msmSuche.anSingraUebergeben',
  'ai.memory.import.edit',
  'settings.oauth.edit',
  'mss.vault.bearbeiten.knopf',
  'browser.start.bearbeiten',
  'ai.memory.add',
  'mods.add',
  'browser.einstellungen.ausnahmeHinzufuegen',
  'browser.entwickler.anwendung.hinzufuegen',
  'ai.providers.name',
  'ai.skills.name',
  'nodes.name',
  'servers.name',
  'roles.name',
  'files.searchByName',
  'hoster.name',
  'mss.vault.dateien.spalteName',
  'mss.vault.fotos.info.name',
  'social.groupRoles.generalName',
  'postgresStudio.columns.name',
  'browser.start.name',
  'browser.entwickler.elemente.ax.name',
  'auth.password',
  'settings.steamAccountPassword',
  'profile.e2eeDevices.removePassword',
  'profile.e2eeDevices.resetPassword',
  'databases.password',
  'mss.vault.passwort',
  'postgresStudio.roles.password',
  'browser.anmeldung.passwort',
  'nav.settings',
  'backups.scheduling',
  'settings.title',
  'panelBackups.settingsButton',
  'mss.app.einstellungen',
  'browser.leiste.einstellungen',
  'browser.einstellungen.titel',
  'notes.activeView',
  'users.active',
  'settings.seasonal.statusActive',
  'webhook.active',
  'popups.statusActive',
  'ai.skills.descriptionLabel',
  'roles.description',
  'teams.roleDescription',
  'social.groupRoles.generalDescription',
  'social.groupRoles.descLabel',
  'postgresStudio.instance.description',
  'browser.entwickler.elemente.ax.beschreibung',
  'calendar.filterAll',
  'ai.memory.import.selectAll',
  'ai.attachments.filterAll',
  'blueprints.filterAll',
  'docs.tree.all',
  'mods.typeAll',
  'mss.vault.alle',
  'notes.tabPreview',
  'settings.seasonal.preview',
  'popups.previewBtn',
  'social.info.preview',
  'browser.entwickler.netz.vorschau',
  'browser.msmSuche.vorschauBadge',
  'nodes.enrollment.retryCommand',
  'browser.einstellungen.import.erneut',
  'browser.einstellungen.wetterErneut',
  'browser.uebersetzung.nochmal',
  'browser.msmSuche.erneut',
  'browser.msmSuche.zusammenfassungWiederholen',
  'files.editor.saved',
  'settings.messenger.saved',
  'teams.memberSaved',
  'mss.vault.gespeichert',
  'mss.vault.zahlung.gespeichert',
  'postgresStudio.data.saved',
  'mss.vault.qr.reiterKamera',
  'mss.vault.fotos.info.kamera',
  'calls.camera',
  'social.story.camera',
  'captcha.altcha.reload',
  'errorBoundary.reload',
  'browser.nav.neuLaden',
  'calendar.recurrence.endsNever',
  'profile.messengerLock.never',
  'common.autoLock.never',
  'browser.einstellungen.nie',
  'ai.providers.realtime.auto',
  'settings.seasonal.modeAuto',
  'ai.memory.import.analyze',
  'auth.continue',
  'profile.linkedAccounts.linkContinue',
  'mss.card.welcomeContinue',
  'benutzername.weiter',
  'ai.profile.deviceInactive',
  'mss.vault.dateien.kurz.offline',
  // 11/2026: Google Programmable Search (Custom Search JSON API) wegen Einstellung der API entfernt.
  'searchEngineSettings.googleTitle',
  'searchEngineSettings.googleDescription',
  'searchEngineSettings.googleApiKey',
  'searchEngineSettings.googleApiKeyPlaceholder',
  'searchEngineSettings.googleCx',
  'searchEngineSettings.googleCxPlaceholder',
  'searchEngineSettings.googleRemoveConfirm',
  // 11/2026: die Maunting-Search-Oberfläche zeigt die Quelle als Wikipedia-Zeile,
  // die Vorschläge als flache Liste und keinen Modellnamen. Die fünf Schlüssel
  // hatten danach keinen Aufruf mehr.
  'browser.msmSuche.wissensgraphBadge',
  'browser.msmSuche.dazuSuchenNutzer',
  'browser.msmSuche.kontextGeneriert',
  'browser.msmSuche.kontextVorschlaege',
  'browser.msmSuche.zusammenfassungSynthese',
  // 11/2026: inline Quellen-Zeile nutzt direkt `quellenLabel`, und der
  // KI-Prüfhinweis steht an der Zusammenfassung selbst (`zusammenfassungDisclaimer`).
  'browser.msmSuche.quellenAnzahl',
  'browser.msmSuche.footerKi',
  // 11/2026: Redaktionelle & Produkt-Straffung von Maunting Search: Konto-Knopf,
  // Slogan/Einstellungs-/AGPLv3-Fußzeilentexte (Lizenzhinweis bleibt in der
  // Datenschutzerklärung) und Ephemer-Hinweis in der KI-Box sind entfallen;
  // die drei älteren unbenutzten Schlüssel lagen bereits ohne Aufruf im Katalog.
  'browser.msmSuche.kontoAnsehen',
  'browser.msmSuche.footerDienst',
  'browser.msmSuche.footerLizenz',
  'browser.msmSuche.zusammenfassungEphemerHinweis',
  'browser.msmSuche.zusammenfassungSchliessen',
  'browser.msmSuche.weitereFragenHinweis',
  'browser.msmSuche.imKiChatWeiter',
  // 11/2026: Denkstufe ist feste Anbieter-Einstellung (kein UI-Dropdown mehr),
  // Singra-Transfer ersetzt altes Clipboard-Weiterführen.
  'browser.msmSuche.zusammenfassungDenkstufe',
  'browser.msmSuche.imChatWeiterfuehren',
  'browser.msmSuche.imChatWeiterKopiert',
]

/** Die Nachfolger muss es geben — sonst wäre das Löschen ein Verlust. */
const NACHFOLGER = [
  'credentials.secrets.steam_account',
  'credentials.secrets.github_token',
  'credentials.secretHints.steam_account',
  'credentials.secretHints.github_token',
  'profile.tabs.security',
  'profile.tabs.connections',
  'ai.memory.titles.user',
  'ai.memory.titles.team',
  'ai.memory.titles.panel',
  'ai.memory.descriptions.user',
  'ai.memory.descriptions.team',
  'ai.memory.descriptions.panel',
  'teams.personalKnowledgeHint',
  'permissionDetails.users_read.title',
  'permissionDetails.users_read.desc',
  'permissionDetails.server_databases_admin.title',
  'permissionEditor.groups.users',
  // Die Nachfolger des Sprachmodus-Umbaus. `ttsHint` erklärt den Stimmzugang
  // dort, wo `realtimeHint` den Sprachzugang erklärte; die beiden
  // Transkript-Schlüssel sind neu und haben keinen Vorgänger — sie stehen hier
  // trotzdem, weil ein Formularfeld ohne Beschriftung genau so aussieht wie
  // eines, dessen Beschriftung jemand beim Umbau vergessen hat.
  'ai.providers.ttsHint',
  'ai.providers.defaultVoice',
  'ai.providers.defaultVoiceHint',
  'ai.providers.transcriptionModel',
  'ai.providers.transcriptionModelHint',
  'ai.providers.protokoll.tts',
  'ai.providers.protokoll.chat_completions',
  // Der Nachfolger des Wegfalls: die Datenschutzerklärung sagt jetzt
  // ausdrücklich, dass der Messenger für die KI nicht erreichbar ist. Ohne
  // diesen Satz wäre aus der Oberfläche nicht zu erkennen, ob der Zugriff
  // entfernt wurde oder nur unerwähnt blieb.
  'privacyPolicy.sections.ai.items.noMessenger',
  // Die Nachfolger der Sprachweg-Texte — je Weg, den das Backend kennt
  // (`services/ai_voice/sprachwege.py`).
  ...['openai_realtime', 'openai_live', 'gemini_live'].flatMap((weg) =>
    ['title', 'hint', 'voice', 'reasoningHint'].map((feld) => `ai.providers.realtime.wege.${weg}.${feld}`)),
  'ai.reasoning.levels.low',
  'ai.reasoning.levels.medium',
  'ai.reasoning.levels.high',
  'auth.zweitfaktor.wahl',
  'auth.zweitfaktor.wegPasskey',
  'auth.zweitfaktor.wegTotp',
  'auth.zweitfaktor.passkeyHint',
  'auth.zweitfaktor.passkeyHintApp',
  'profile.zweitfaktoren.appEinrichten',
  'profile.zweitfaktoren.passkeyHinzufuegen',
  'browser.msmSuche.quellenLabel',
  'browser.msmSuche.verwandteThemen',
  'browser.msmSuche.kopierenFehlgeschlagen',
  'browser.msmSuche.topErgebnis',
  'browser.msmSuche.meintestDu',
  'browser.msmSuche.nachrichtenZumThema',
  'browser.msmSuche.footerClaim',
  'browser.msmSuche.footerDatenschutz',
]

// Die beiden Panelsprachen — seit 09/2026 gibt es keine weiteren. Die neun
// Teilübersetzungen sind gefallen, weil sie über die Spracherkennung des
// Browsers aktiv wurden, ohne je vollständig gewesen zu sein.
const SPRACHEN: Record<string, unknown> = { de, en }

function blatt(baum: unknown, pfad: string): unknown {
  return pfad.split('.').reduce<unknown>(
    (knoten, teil) =>
      knoten && typeof knoten === 'object'
        ? (knoten as Record<string, unknown>)[teil]
        : undefined,
    baum,
  )
}

describe('abgelöste Übersetzungsschlüssel', () => {
  it.each(Object.keys(SPRACHEN))('%s hat keinen abgelösten Schlüssel mehr', (sprache) => {
    const uebrig = ABGELOESTE_SCHLUESSEL.filter(
      (pfad) => blatt(SPRACHEN[sprache], pfad) !== undefined,
    )
    expect(uebrig).toEqual([])
  })

  it.each(Object.keys(SPRACHEN))('%s kennt alle Nachfolger', (sprache) => {
    const fehlend = NACHFOLGER.filter(
      (pfad) => typeof blatt(SPRACHEN[sprache], pfad) !== 'string',
    )
    expect(fehlend).toEqual([])
  })
})
