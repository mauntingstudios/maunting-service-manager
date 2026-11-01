import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import i18n, { textBereit } from '@/i18n'

// Die Sprachdateien laden seit 27.09.2026 nach (`config/locales.ts`). Ein Test,
// der sofort rendert oder die Sprache wechselt, sähe sonst Schlüssel statt Text.
await textBereit
await i18n.loadLanguages(['de', 'en'])
// Erkannt würde über Nodes `navigator.language`, und das ist die Systemsprache:
// lokal Deutsch, auf dem CI-Runner Englisch. Die Tests erwarten deutsche Texte.
await i18n.changeLanguage('de')

beforeEach(() => {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Falls Storage in bestimmter Umgebung nicht vorhanden
  }
})
