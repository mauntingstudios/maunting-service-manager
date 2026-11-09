import { KeyRound } from 'lucide-react'

export type AnbieterMarke =
  | 'Google'
  | 'Discord'
  | 'GitHub'
  | 'Microsoft'
  | 'X'
  | 'Steam'
  | 'Apple'
  | 'GitLab'
  | 'Twitch'

interface Markenpfad {
  farbe?: string
  pfad?: string
  teile?: Array<{ d: string; fill: string }>
}

/**
 * Nur die Anbieter, die als externe Anmeldung vorkommen. Die Pfade stammen
 * unveraendert aus dem Marken-Katalog der Design-DNA (`brandCatalog.tsx`);
 * hier liegen sie einzeln, damit die Anmeldeseite nicht den kompletten
 * Katalog mit ueber tausend Marken in ihr Startbuendel zieht.
 */
const PFADE: Record<Exclude<AnbieterMarke, 'Microsoft'>, Markenpfad> = {
  Google: { teile: [{ d: "M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z", fill: "#4285F4" }, { d: "M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z", fill: "#34A853" }, { d: "M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z", fill: "#FBBC05" }, { d: "M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z", fill: "#EA4335" }] },
  Discord: { farbe: "#5865F2", pfad: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" },
  GitHub: { farbe: "currentColor", pfad: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" },
  X: { farbe: "currentColor", pfad: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" },
  Steam: { farbe: "#66C0F4", pfad: "M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" },
  Apple: { farbe: "currentColor", pfad: "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" },
  GitLab: { farbe: "#FC6D26", pfad: "m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z" },
  Twitch: { farbe: "#9146FF", pfad: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" },
}

/**
 * Schreibvarianten, die in Slugs und Anzeigenamen vorkommen. Verglichen wird
 * ohne Satzzeichen und in Kleinschreibung, damit „GitHub Enterprise“,
 * „X (Twitter)“ und „Microsoft Entra ID“ denselben Eintrag treffen.
 */
const ALIASE: Record<string, AnbieterMarke> = {
  google: 'Google',
  googleworkspace: 'Google',
  gmail: 'Google',
  discord: 'Discord',
  github: 'GitHub',
  githubenterprise: 'GitHub',
  microsoft: 'Microsoft',
  microsoftentra: 'Microsoft',
  microsoftentraid: 'Microsoft',
  microsoft365: 'Microsoft',
  office365: 'Microsoft',
  outlook: 'Microsoft',
  twitter: 'X',
  x: 'X',
  xtwitter: 'X',
  twitterx: 'X',
  steam: 'Steam',
  steamopenid: 'Steam',
  apple: 'Apple',
  appleid: 'Apple',
  gitlab: 'GitLab',
  twitch: 'Twitch',
}

function normalisiere(wert: string): string {
  return wert.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Ordnet einen Provider seinem Symbol zu. Der Slug hat Vorrang vor dem
 * Anzeigenamen, weil Administratoren den Namen frei vergeben.
 */
export function anbieterMarke(slug: string, name: string): AnbieterMarke | null {
  return ALIASE[normalisiere(slug)] ?? ALIASE[normalisiere(name)] ?? null
}

/** Sehr dunkle Markenfarben werden auf dunkler Oberfläche aufgehellt. */
function lesbareFarbe(farbe: string): string {
  if (farbe === 'currentColor') return '#F4F6FA'
  const hex = farbe.replace(/^#/, '')
  if (hex.length !== 6) return farbe
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return farbe
  const leuchtkraft = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return leuchtkraft < 0.16 ? '#F4F6FA' : farbe
}

function MicrosoftSymbol({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  )
}

export interface AnbieterSymbolProps {
  slug: string
  name: string
  className?: string
}

/**
 * Symbol eines externen Anmeldeanbieters. Unbekannte Anbieter bekommen einen
 * neutralen Schluessel statt eines fremden oder erfundenen Logos.
 */
export function AnbieterSymbol({ slug, name, className = 'h-5 w-5' }: AnbieterSymbolProps) {
  const marke = anbieterMarke(slug, name)

  if (marke === 'Microsoft') {
    return (
      <span className="inline-flex shrink-0" data-anbieter={marke} aria-hidden="true">
        <MicrosoftSymbol className={className} />
      </span>
    )
  }

  if (marke) {
    const symbol = PFADE[marke]
    return (
      <span className="inline-flex shrink-0" data-anbieter={marke} aria-hidden="true">
        {symbol.teile ? (
          <svg viewBox="0 0 24 24" className={className}>
            {symbol.teile.map((teil) => (
              <path key={teil.d} d={teil.d} fill={teil.fill} />
            ))}
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className={className} fill={lesbareFarbe(symbol.farbe ?? 'currentColor')}>
            <path d={symbol.pfad} />
          </svg>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex shrink-0" data-anbieter="neutral" aria-hidden="true">
      <span
        className={`inline-flex items-center justify-center rounded-md border border-outline-variant/40 bg-surface-container-high text-on-surface-variant ${className}`}
      >
        <KeyRound className="h-3.5 w-3.5" />
      </span>
    </span>
  )
}
