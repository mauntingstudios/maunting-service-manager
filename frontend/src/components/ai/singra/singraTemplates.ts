export type SingraTimeOfDay = 'morning' | 'day' | 'evening' | 'night'

export interface SingraStarterCategory {
  id: string
  title: string
  shortTitle: string
  iconName: 'lightbulb' | 'code' | 'book' | 'pen' | 'sparkles' | 'server' | 'folder' | 'calendar'
  description: string
  prompts: string[]
}

export function getSingraTimeOfDay(date: Date = new Date()): {
  period: SingraTimeOfDay
  bgImage: string
  greetingPrefix: string
} {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) {
    return {
      period: 'morning',
      bgImage: '/assets/singra/singra-bg-morning.jpg',
      greetingPrefix: 'Guten Morgen',
    }
  }
  if (hour >= 11 && hour < 17) {
    return {
      period: 'day',
      bgImage: '/assets/singra/singra-bg-day.jpg',
      greetingPrefix: 'Hallo',
    }
  }
  if (hour >= 17 && hour < 21) {
    return {
      period: 'evening',
      bgImage: '/assets/singra/singra-bg-evening.jpg',
      greetingPrefix: 'Guten Abend',
    }
  }
  return {
    period: 'night',
    bgImage: '/assets/singra/singra-bg-night.jpg',
    greetingPrefix: 'Guten Abend',
  }
}

export const SINGRA_STARTER_CATEGORIES: SingraStarterCategory[] = [
  {
    id: 'ideas',
    title: 'Ideen entwickeln',
    shortTitle: 'Ideen entwickeln',
    iconName: 'lightbulb',
    description: 'Konzepte, Strategien und neue Ansätze durchdenken',
    prompts: [
      'Hilf mir, ein neues Feature-Konzept Schritt für Schritt zu strukturieren und kritische Engpässe früh zu erkennen.',
      'Welche Architektur-Optionen eignen sich für einen dienstübergreifenden Hintergrund-Worker mit hoher Ausfallsicherheit?',
      'Lass uns gemeinsam Ideen sammeln, wie wir den Onboarding-Ablauf für neue Teammitglieder vereinfachen können.',
      'Erstelle mir fünf konkrete Vorschläge, wie wir unsere Server-Überwachung übersichtlicher gestalten können.',
      'Analysiere Vor- und Nachteile einer lokalen Sandbox im Vergleich zu einer Container-Lösung für Entwickler-Teams.',
      'Hilf mir beim Brainstorming für eine klare Projektstruktur inklusive Meilensteinen und Verantwortlichkeiten.',
    ],
  },
  {
    id: 'code',
    title: 'Etwas programmieren',
    shortTitle: 'Programmieren',
    iconName: 'code',
    description: 'Code schreiben, debuggen, testen oder im Projekt ausführen',
    prompts: [
      'Erstelle ein neues Coding-Projekt in meiner Sandbox und richte eine saubere TypeScript- oder Python-Struktur ein.',
      'Analysiere den aktuellen Git-Status in meinem Projekt, prüfe die letzten Änderungen und schlage einen sauberen Commit vor.',
      'Schreibe ein robustes Python-Skript mit Fehlerbehandlung und passenden Unit-Tests und führe die Tests direkt aus.',
      'Hilf mir beim Refactoring einer komplexen React-Komponente, damit State und Nebenläufigkeit übersichtlich bleiben.',
      'Untersuche einen Performance-Engpass in einer SQL-Abfrage und zeige mir konkrete Index- und Query-Optimierungen.',
      'Baue einen sicheren API-Endpunkt in FastAPI mit strikter Pydantic-Validierung und Berechtigungsprüfung.',
    ],
  },
  {
    id: 'explain',
    title: 'Etwas erklären',
    shortTitle: 'Etwas erklären',
    iconName: 'book',
    description: 'Zusammenhänge, Technik und komplexe Themen verständlich aufbereiten',
    prompts: [
      'Erkläre mir verständlich, wie das Zusammenspiel zwischen WebCrypto, Argon2id und Schlüssel-Wrapping funktioniert.',
      'Wie unterscheidet sich ein ereignisbasierter Stream-Aufbau (SSE) von klassischen WebSockets im Produktivbetrieb?',
      'Fasse mir die wichtigsten Sicherheitsregeln für Docker-Container und Linux-Netzwerk-Isolation kompakt zusammen.',
      'Erkläre mir anhand eines klaren Beispiels, wie Git-Rebase, Merge und Cherry-Pick in Team-Workflows zusammenwirken.',
      'Wie funktionieren moderne Sprachmodelle beim Werkzeugaufruf (Function Calling) und worauf sollte man beim Prompt achten?',
      'Erkläre mir die Unterschiede zwischen verschiedenen DNS-Einträgen (A, AAAA, CNAME, TXT, SRV) und typischen Fehlerquellen.',
    ],
  },
  {
    id: 'write',
    title: 'Texte schreiben',
    shortTitle: 'Texte schreiben',
    iconName: 'pen',
    description: 'Dokumentation, E-Mails, Ankündigungen und Berichte verfassen',
    prompts: [
      'Formuliere ein klares, sachliches Release-Changelog für unser aktuelles Update ohne künstliche Werbefloskeln.',
      'Schreibe eine präzise technische Dokumentation für ein neues Modul inklusive Konfigurationsbeispielen.',
      'Entwirf eine kurze, freundliche E-Mail an das Team über geplante Wartungsarbeiten am Wochenende.',
      'Überarbeite meinen Entwurf so, dass er kürzer, direkter und leicht verständlich klingt.',
      'Erstelle eine strukturierte Vorlage für Post-Mortem-Berichte nach einer Server-Störung.',
      'Verfasse eine verständliche Schritt-für-Schritt-Anleitung für neue Administratoren.',
    ],
  },
  {
    id: 'creative',
    title: 'Kreativ sein',
    shortTitle: 'Kreativ sein',
    iconName: 'sparkles',
    description: 'Design-Richtungen, Namen, Formulierungen und ungewöhnliche Perspektiven',
    prompts: [
      'Entwickle fünf prägnante, eigenständige Namensvorschläge für ein neues internes Entwickler-Werkzeug.',
      'Wie können wir eine technische Statusseite so gestalten, dass sie ruhig, vertrauenswürdig und sofort erfassbar wirkt?',
      'Schlage mir ein stimmiges Farb- und Lichtkonzept für eine abendliche Arbeits-Oberfläche vor.',
      'Entwirf eine anschauliche Metapher, um Nicht-Technikern unser Sicherheits- und Backup-Konzept zu erklären.',
      'Lass uns drei unterschiedliche Richtungen für das Layout unseres neuen Projekt-Dashboards skizzieren.',
      'Formuliere kurze, natürliche Mikro-Texte für leere Zustände (Empty States) in unserer Anwendung.',
    ],
  },
  {
    id: 'servers',
    title: 'Server & Infrastruktur',
    shortTitle: 'Server & Infra',
    iconName: 'server',
    description: 'Serverstatus, Logs, Backups, Ports und Guardian-Vorfälle prüfen',
    prompts: [
      'Gib mir einen Überblick über alle meine Server und zeige mir, ob aktuell Warnungen oder Störungen vorliegen.',
      'Prüfe die letzten Log-Einträge meines Servers auf Fehlermeldungen oder ungewöhnliche Neustarts.',
      'Wie sieht die aktuelle Auslastung (CPU, Arbeitsspeicher und Speicherplatz) auf meinen Systemen aus?',
      'Prüfe den Backup-Stand meiner Server und sage mir, wann die letzte erfolgreiche Sicherung lief.',
      'Welche Guardian-Vorfälle oder automatischen Heilungen gab es in den letzten 24 Stunden?',
      'Kontrolliere die offenen Ports und die Netzwerkkonfiguration meines Spieleservers.',
    ],
  },
  {
    id: 'docs',
    title: 'Dokumente & Projekte',
    shortTitle: 'Dokumente',
    iconName: 'folder',
    description: 'Maunting Docs durchsuchen, Notizen zusammenfassen und Wissen ordnen',
    prompts: [
      'Durchsuche meine Dokumente und Notizen nach offenen Aufgaben und erstelle eine kompakte Übersicht.',
      'Fasse die wichtigsten Entscheidungen aus unseren letzten Projektdokumenten strukturiert zusammen.',
      'Lege eine neue Wissensnotiz mit den wichtigsten Zugangs- und Aufbauregeln für unser Team an.',
      'Vergleiche zwei Dokumente in meinem Bestand und zeige mir inhaltliche Abweichungen oder offene Punkte.',
      'Hilf mir, ein technisches Handbuch in übersichtliche Kapitel für Maunting Docs zu gliedern.',
      'Welche Skills und Erinnerungen sind aktuell für mein Team hinterlegt?',
    ],
  },
  {
    id: 'planning',
    title: 'Alltag & Planung',
    shortTitle: 'Alltag & Planung',
    iconName: 'calendar',
    description: 'Termine, geplante Aufgaben und regelmäßige Abläufe koordinieren',
    prompts: [
      'Zeige mir meine anstehenden Kalendereinträge und geplanten KI-Aufgaben für diese Woche.',
      'Richte eine tägliche Aufgabe ein, die jeden Morgen um 08:00 Uhr den Zustand meiner Server prüft und mir kurz berichtet.',
      'Hilf mir, meinen Arbeitstag in drei fokussierte Blöcke mit realistischen Prioritäten einzuteilen.',
      'Erstelle eine Checkliste für das monatliche Einspielen von Sicherheitsupdates und Backups.',
      'Fasse mir zusammen, welche Hintergrund-Aufträge und regelmäßigen Checks aktuell aktiv sind.',
      'Plane mit mir einen realistischen Zeitplan für den Rollout unseres nächsten größeren Updates.',
    ],
  },
]

export interface SingraMcpPreset {
  id: string
  name: string
  description: string
  transport: 'http' | 'sse' | 'stdio'
  endpoint_url?: string
  command?: string
  args?: string[]
  auth_header?: string
  badge: string
}

export const SINGRA_MCP_PRESETS: SingraMcpPreset[] = [
  {
    id: 'github',
    name: 'GitHub MCP Server',
    description: 'Repositories, Branches, Commits, Issues und Pull Requests direkt anbinden.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    auth_header: 'Bearer <GITHUB_PERSONAL_ACCESS_TOKEN>',
    badge: 'Code & Repos',
  },
  {
    id: 'gitlab',
    name: 'GitLab MCP Server',
    description: 'GitLab-Projekte, Merge Requests, Snippets und CI/CD Pipelines abfragen.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    auth_header: 'Bearer <GITLAB_PERSONAL_ACCESS_TOKEN>',
    badge: 'Code & CI/CD',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL Database MCP',
    description: 'Schema-Inspektion, Tabellenstrukturen und schreibgeschützte SQL-Abfragen.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://user:pass@localhost:5432/dbname'],
    badge: 'Datenbank',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer Web Scraper MCP',
    description: 'Headless-Browser zum Laden, Rendern und Extrahieren externer Webseiten.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    badge: 'Web & Scraping',
  },
  {
    id: 'filesystem',
    name: 'Lokales Dateisystem MCP',
    description: 'Sicherer Stdio-Zugriff auf ausgewählte lokale Ordner auf deinem Rechner.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Projects'],
    badge: 'Lokale Dateien',
  },
]
