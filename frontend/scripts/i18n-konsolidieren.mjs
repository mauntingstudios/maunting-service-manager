import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Führt wortgleiche Übersetzungsschlüssel in `common.*` zusammen.
 *
 * Nur Gruppen, deren deutscher und englischer Text exakt gleich ist. Die
 * sichtbare Sprache ändert sich dadurch nicht; die alten Schlüssel fallen aus
 * beiden Sprachdateien und kommen in die Liste der abgelösten Schlüssel.
 */
/**
 * Einmalwerkzeug für einen reviewten Batch. Die Liste der abgelösten
 * Schlüssel ist ein Vertrag und wird hier bewusst nicht angefasst.
 */
const gruppen = {
  save: [
    'ai.skills.save', 'settings.steamAccountSave', 'settings.save', 'settings.oauth.save',
    'credentials.save', 'social.groupRoles.generalSave', 'browser.workspaces.speichern',
    'browser.formular.speichern',
  ],
  cancel: [
    'server.authSetup.cancel', 'mss.aufraeumen.nein', 'mss.wakeword.abbrechen',
    'mss.gefahrenzone.abbrechen', 'mss.einstellungen.computerUse.abbrechen',
    'mss.einstellungen.artefakte.abbrechen', 'mss.schliessen.abbrechen',
    'browser.workspaces.abbrechen', 'browser.aufnahme.abbrechen',
    'browser.drittanbieterHinweis.abbrechen',
  ],
  delete: [
    'blueprints.delete', 'blueprints.deleteConfirm', 'docs.comments.delete', 'users.delete',
    'settings.oauth.delete', 'browser.einstellungen.loeschen',
  ],
  remove: [
    'mods.remove', 'settings.steamAccountRemove', 'settings.supportWidget.installIdRemove',
    'profile.removeAvatar', 'profile.mailboxes.delete', 'profile.calendars.delete',
    'profile.e2eeDevices.remove', 'profile.zweitfaktoren.entfernen',
    'social.groupRoles.backgroundRemove', 'browser.liste.entfernen',
    'browser.einstellungen.eintragEntfernen', 'browser.erweiterungen.entfernen',
    'browser.uebersetzung.entfernen',
  ],
  copy: [
    'nodes.enrollment.copy', 'docs.share.copy', 'servers.consoleCopy',
    'blueprintBuilder.postInstall.copy', 'docsCommon.copy', 'mss.textmenue.kopieren',
    'browser.menue.copy', 'browser.entwickler.kopieren',
    'browser.msmSuche.zusammenfassungKopierenKurz',
  ],
  copied: [
    'ai.memory.import.copied', 'nodes.enrollment.copied', 'docs.copiedExample',
    'docsSelfHosting.install.copied', 'webhook.copied', 'docsCommon.copied',
    'browser.msmSuche.zusammenfassungKopiert',
  ],
  close: [
    'panelBackups.restoreModalClose', 'mss.fenster.schliessen', 'browser.fenster.schliessen',
    'browser.msmSuche.schliessen', 'browser.msmSuche.medienVorschauSchliessen',
  ],
  edit: [
    'ai.memory.import.edit', 'docs.roles.editor', 'settings.oauth.edit',
    'mss.vault.bearbeiten.knopf', 'browser.start.bearbeiten',
  ],
  add: [
    'ai.memory.add', 'mods.add', 'browser.einstellungen.ausnahmeHinzufuegen',
    'browser.entwickler.anwendung.hinzufuegen',
  ],
  name: [
    'ai.providers.name', 'ai.skills.name', 'ai.actions.fields.name', 'nodes.name', 'servers.name',
    'roles.name', 'files.searchByName', 'errors.validation.fields.name', 'hoster.name',
    'mss.vault.dateien.spalteName', 'mss.vault.fotos.info.name', 'social.groupRoles.generalName',
    'postgresStudio.columns.name', 'browser.start.name', 'browser.entwickler.elemente.ax.name',
    'browser.entwickler.netz.spalte.name',
  ],
  password: [
    'auth.password', 'settings.steamAccountPassword', 'profile.e2eeDevices.removePassword',
    'profile.e2eeDevices.resetPassword', 'errors.validation.fields.password', 'databases.password',
    'mss.vault.passwort', 'postgresStudio.roles.password', 'browser.anmeldung.passwort',
  ],
  settings: [
    'nav.settings', 'backups.scheduling', 'settings.title', 'panelBackups.settingsButton',
    'mss.app.einstellungen', 'browser.leiste.einstellungen', 'browser.einstellungen.titel',
  ],
  active: [
    'notes.activeView', 'users.active', 'settings.seasonal.statusActive', 'webhook.active',
    'hoster.states.active', 'popups.statusActive',
  ],
  description: [
    'ai.skills.descriptionLabel', 'roles.description', 'teams.roleDescription',
    'social.groupRoles.generalDescription', 'social.groupRoles.descLabel',
    'postgresStudio.instance.description', 'browser.entwickler.elemente.ax.beschreibung',
  ],
  all: [
    'calendar.filterAll', 'ai.memory.origins.all', 'ai.memory.import.selectAll',
    'ai.attachments.filterAll', 'blueprints.filterAll', 'docs.tree.all', 'mods.typeAll',
    'mss.vault.alle', 'browser.entwickler.netz.typ.alle',
  ],
  preview: [
    'notes.tabPreview', 'settings.seasonal.preview', 'popups.previewBtn', 'social.info.preview',
    'browser.entwickler.netz.vorschau', 'browser.msmSuche.vorschauBadge',
  ],
  retry: [
    'nodes.enrollment.retryCommand', 'browser.einstellungen.import.erneut',
    'browser.einstellungen.wetterErneut', 'browser.uebersetzung.nochmal',
    'browser.msmSuche.erneut', 'browser.msmSuche.zusammenfassungWiederholen',
  ],
  saved: [
    'files.editor.saved', 'settings.messenger.saved', 'teams.memberSaved',
    'mss.vault.gespeichert', 'mss.vault.zahlung.gespeichert', 'postgresStudio.data.saved',
  ],
  camera: [
    'mss.vault.qr.reiterKamera', 'mss.vault.fotos.info.kamera', 'mss.vault.fotos.quelle.kamera',
    'calls.camera', 'social.story.camera', 'browser.einstellungen.rechtName.kamera',
  ],
  reload: [
    'captcha.altcha.reload', 'errorBoundary.reload', 'browser.nav.neuLaden',
    'browser.einstellungen.knopf.neuLaden', 'browser.menue.reload',
  ],
  never: [
    'calendar.recurrence.endsNever', 'profile.messengerLock.never', 'common.autoLock.never',
    'browser.einstellungen.frist.immer', 'browser.einstellungen.nie',
  ],
  auto: [
    'ai.providers.realtime.auto', 'ai.providers.realtime.vadValues.auto',
    'docs.history.reasons.autosave', 'settings.seasonal.modeAuto', 'social.status.auto',
  ],
  continue: [
    'ai.memory.import.analyze', 'auth.continue', 'profile.linkedAccounts.linkContinue',
    'mss.card.welcomeContinue', 'benutzername.weiter',
  ],
  offline: [
    'ai.profile.deviceInactive', 'nodes.status.offline', 'servers.guardian.tab.status.offline',
    'mss.vault.dateien.kurz.offline', 'social.status.offline',
    'browser.entwickler.netz.drossel.offline',
  ],
}

const de = JSON.parse(readFileSync('src/locales/de.json', 'utf8'))
const en = JSON.parse(readFileSync('src/locales/en.json', 'utf8'))

function lesen(baum, pfad) {
  return pfad.split('.').reduce((knoten, teil) => (knoten && typeof knoten === 'object' ? knoten[teil] : undefined), baum)
}

function setzen(baum, pfad, wert) {
  const teile = pfad.split('.')
  let knoten = baum
  for (const teil of teile.slice(0, -1)) {
    if (!knoten[teil] || typeof knoten[teil] !== 'object') knoten[teil] = {}
    knoten = knoten[teil]
  }
  knoten[teile[teile.length - 1]] = wert
}

function loeschen(baum, pfad) {
  const teile = pfad.split('.')
  let knoten = baum
  for (const teil of teile.slice(0, -1)) {
    if (!knoten || typeof knoten !== 'object') return false
    knoten = knoten[teil]
  }
  const blatt = teile[teile.length - 1]
  if (knoten && Object.prototype.hasOwnProperty.call(knoten, blatt)) {
    delete knoten[blatt]
    return true
  }
  return false
}

const mapping = new Map()
const neueCommon = new Map()
for (const [name, alte] of Object.entries(gruppen)) {
  const ziel = `common.${name}`
  const vorhanden = lesen(de, ziel)
  if (vorhanden === undefined) {
    const quelle = alte.find((pfad) => lesen(de, pfad) !== undefined)
    if (!quelle) continue
    neueCommon.set(ziel, { de: lesen(de, quelle), en: lesen(en, quelle) })
  }
  for (const alt of alte) mapping.set(alt, ziel)
}

function dateien(dir, ziel = []) {
  for (const name of readdirSync(dir)) {
    const voll = path.join(dir, name)
    const stat = statSync(voll)
    if (stat.isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist' && name !== 'dist-desktop' && name !== 'dist-browser') dateien(voll, ziel)
    } else if (/\.(ts|tsx)$/.test(name) && name !== 'retiredKeys.test.ts') {
      ziel.push(voll)
    }
  }
  return ziel
}

for (const [ziel, werte] of neueCommon) {
  setzen(de, ziel, werte.de)
  setzen(en, ziel, werte.en)
}

const sortiert = [...mapping.entries()].sort((a, b) => b[0].length - a[0].length)
let dateienGeaendert = 0
for (const datei of [...dateien('src'), ...dateien('packages/maunting-ui/src')]) {
  let inhalt = readFileSync(datei, 'utf8')
  const vorher = inhalt
  for (const [alt, ziel] of sortiert) {
    const muster = new RegExp(`(['"\`])${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g')
    inhalt = inhalt.replace(muster, (_treffer, quote) => `${quote}${ziel}${quote}`)
  }
  if (inhalt !== vorher) {
    writeFileSync(datei, inhalt, 'utf8')
    dateienGeaendert += 1
  }
}

for (const alt of mapping.keys()) {
  loeschen(de, alt)
  loeschen(en, alt)
}

writeFileSync('src/locales/de.json', `${JSON.stringify(de, null, 2)}\n`, 'utf8')
writeFileSync('src/locales/en.json', `${JSON.stringify(en, null, 2)}\n`, 'utf8')

const retiredPfad = 'src/locales/retiredKeys.test.ts'
let retired = readFileSync(retiredPfad, 'utf8')
const start = retired.indexOf('const ABGELOESTE_SCHLUESSEL = [')
const ende = retired.indexOf(']', start)
const altListe = retired.slice(start, ende)
const neu = [...mapping.keys()].filter((key) => !altListe.includes(`'${key}'`))
if (neu.length) {
  const block = `\n  // 04.11.2026: wortgleiche Duplikate in \`common.*\` zusammengeführt.\n${neu.map((key) => `  '${key}',`).join('\n')}\n`
  retired = `${retired.slice(0, ende)}${block}${retired.slice(ende)}`
  writeFileSync(retiredPfad, retired, 'utf8')
}

console.log(`i18n: ${mapping.size} alte Schlüssel, ${neueCommon.size} neue common-Schlüssel, ${dateienGeaendert} Dateien geändert.`)
