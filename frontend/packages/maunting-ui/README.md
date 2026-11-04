# @maunting/ui

Die Design-Bibliothek des Maunting-Ökosystems. Sie trägt die gemeinsame
Sprache von Web-Panel, Maunting Smart System (MSS) und Pontis: Farben, Form,
Typografie, Bewegung und die Bausteine, aus denen die Oberflächen bestehen.

## Aufbau

```
src/tokens.css      Farben, Flächen, Linien, Radien, Schatten (dark only)
src/tokens.ts       dieselben Werte für Code und den WebGL-Schwarm
src/styles.css      Komponenten-Rezepte (.msm-*)
src/index.ts        ein Barrel für Komponenten, Hooks und Typen
src/swarm/          der Sprachschwarm (WebGL, eigener Unterpfad)
src/intern/         cx, Formatierung, stille Fehler
```

## Verwenden

```ts
import { Button, Card, Dialog, Dropdown, PageHeader, TabBar } from '@maunting/ui'
import '@maunting/ui/tokens.css'
import '@maunting/ui/styles.css'
```

Der Schwarm wird nachgeladen, nie in das Startbündel gezogen:

```ts
const { createSwarm } = await import('@maunting/ui/swarm')
```

## Regeln

- Das Paket kennt nur React, `react-i18next`, Lucide, Motion, Radix und seine
  eigenen relativen Dateien. Keine `@/`-Importe, keine Stores, kein Router,
  kein Tauri. `scripts/check-paketgrenzen.mjs` hält die Grenze.
- Texte kommen über i18n oder als Props. Ein Baustein trägt keinen festen
  sichtbaren Text und kein `title`.
- Native Formularelemente sind verboten. Auswahl, Datum, Schalter und Dialoge
  kommen aus diesem Paket.
- Farbe und Form stehen in `tokens.css`, nicht in einzelnen Komponenten.

## Prüfen

Im MSM-Frontend:

```bash
npm run check
npx tsc --noEmit
npx vitest run packages/maunting-ui/src
node scripts/check-paketgrenzen.mjs
```

## Herkunft

Quelle der Wahrheit ist `frontend/packages/maunting-ui` im
`maunting-server-manager`-Repository. Das private Repository `maunting-ui`
spiegelt dieses Paket; es wird nicht von Hand weiterentwickelt.
