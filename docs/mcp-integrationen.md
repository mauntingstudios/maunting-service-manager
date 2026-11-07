# MCP-Integrationen & Server-Katalog (Model Context Protocol)

In Maunting Server Manager (Singra) können Betreiber, Teams und Benutzer externe Dienste nahtlos über das **Model Context Protocol (MCP)** anbinden. Dadurch erhält die KI Zugriff auf spezialisierte Werkzeuge (z. B. Deployments, Datenbankabfragen, Design-Assets, Shop-Bestellungen oder Ticketing), ohne dass Kernfunktionen der Anwendung modifiziert werden müssen.

---

## 1. Architektur & Sicherheitsprinzipien

1. **Modulare Isolation & Scopes:**
   - **Persönlich (`scope: user`):** Nur der jeweilige Benutzer kann den MCP-Server sehen und nutzen. Ideal für persönliche Accounts und individuelle Entwickler-Tokens.
   - **Team (`scope: team`):** Alle Mitglieder eines Teams teilen sich die Schnittstelle mit teamweiten Zugangsdaten (z. B. ein gemeinsamer Supabase- oder Stripe-Account).
   - **Global (`scope: global`):** Für alle Benutzer des Systems aktiv (erfordert Administrator-Rechte `panel.settings.write`).

2. **Tresor-Sicherheit (DIS-Schutz):**
   - Zugangsschlüssel und Tokens (`auth_header`) werden mit DIS (`ai_text`) in der Datenbank verschlüsselt gespeichert.
   - Bei Protokollen ohne Authentifizierung (z. B. lokales Puppeteer oder Dateisystem) wird kein Header gespeichert.

3. **Automatische Kontext-Erkennung:**
   - Der MSM-Backend-Dienst `ai_context_service.py` injiziert aktive MCP-Server automatisch als Kontextblock in das System.
   - Die KI erkennt dadurch in 90 % der Fälle selbstständig, wann ein angebundener Dienst für die Anfrage des Benutzers relevant ist.

4. **Native E-Mail- und Kalender-Trennung:**
   - E-Mails (IMAP/SMTP) und Termine (CalDAV) sind **nativ** in Maunting Server Manager integriert und erfordern keinen externen MCP-Server. Sie werden direkt unter *Einstellungen → Verbindungen* verwaltet.

---

## 2. Übersicht der 30 unterstützten Integrationen

| Dienst | Kategorie | Transport | Auth-Typ | Schlüssel / Token | Dashboard / Quelle |
|---|---|---|---|---|---|
| **Stripe** | E-Commerce | stdio | Token | Restricted API Key (`rk_live_...`) | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| **Shopify** | E-Commerce | stdio | Token | Admin API Access Token (`shpat_...`) | [Shopify Admin App Develop](https://help.shopify.com/manual/apps/custom-apps) |
| **Supabase** | Code & Cloud | stdio | OAuth / Token | Personal Access Token (`sbp_...`) | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| **Vercel** | Code & Cloud | stdio | OAuth / Token | Vercel Access Token | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| **Netlify** | Code & Cloud | stdio | OAuth / Token | Personal Access Token (`nfp_...`) | [app.netlify.com/user/applications](https://app.netlify.com/user/applications#personal-access-tokens) |
| **Railway** | Code & Cloud | stdio | Token | Railway API Token | [railway.app/account/tokens](https://railway.app/account/tokens) |
| **Base44** | Code & Cloud | stdio | Token | Base44 API Key (`b44_...`) | [base44.com](https://base44.com) |
| **Lovable** | Code & Cloud | stdio | Token | Workspace API Key | [lovable.dev](https://lovable.dev) |
| **GitHub** | Code & Cloud | stdio | OAuth / Token | Personal Access Token (`ghp_...`) | [github.com/settings/tokens](https://github.com/settings/tokens) |
| **GitLab** | Code & Cloud | stdio | Token | Personal Access Token (`glpat-...`) | [gitlab.com/-/profile/personal_access_tokens](https://gitlab.com/-/profile/personal_access_tokens) |
| **PostgreSQL** | Code & Cloud | stdio | Verbindungs-URL | URI (`postgresql://...`) | Lokale oder gehostete Datenbank |
| **Puppeteer** | Code & Cloud | stdio | Kein Schlüssel | Lokaler Headless-Browser | Lokal vorinstalliert |
| **Canva** | Design & Medien | stdio | Token | Integration Token | [canva.com/developers](https://www.canva.com/developers) |
| **Figma** | Design & Medien | stdio | Token | Personal Access Token (`figd_...`) | [figma.com/settings](https://www.figma.com/settings) |
| **Adobe Creative Cloud** | Design & Medien | stdio | Token | IMS Token | [developer.adobe.com/console](https://developer.adobe.com/console) |
| **Notion** | Produktivität | stdio | Token | Integration Secret (`secret_...`) | [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| **Linear** | Produktivität | stdio | Token | Personal API Key (`lin_api_...`) | [linear.app/settings/api](https://linear.app/settings/api) |
| **Atlassian Jira/Confluence** | Produktivität | stdio | Token | Atlassian API Token | [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| **Google Docs** | Produktivität | stdio | OAuth / Token | Google OAuth 2.0 Token | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| **Google Sheets** | Produktivität | stdio | OAuth / Token | Google OAuth 2.0 Token | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| **Slack** | Kommunikation | stdio | Token | Bot User OAuth Token (`xoxb-...`) | [api.slack.com/apps](https://api.slack.com/apps) |
| **Discord** | Kommunikation | stdio | Token | Discord Bot Token | [discord.com/developers/applications](https://discord.com/developers/applications) |
| **HubSpot** | Kommunikation | stdio | Token | Private App Token (`pat-na1-...`) | [app.hubspot.com](https://app.hubspot.com) |
| **Drip** | Kommunikation | stdio | Token | Drip API Token | [drip.com](https://www.drip.com) |
| **Dropbox** | Dateien | stdio | Token | App Access Token (`sl....`) | [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) |
| **Google Drive** | Dateien | stdio | OAuth / Token | Google OAuth 2.0 Token | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| **Lokales Dateisystem** | Dateien | stdio | Kein Schlüssel | Pfadangabe als Parameter | Lokales Dateisystem |
| **Spotify** | Medien | stdio | Token | Spotify Web API Token | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) |
| **Apple Music** | Medien | stdio | Token | MusicKit JWT Entwickler-Token | [developer.apple.com/musickit](https://developer.apple.com/musickit) |
| **Booking** | Services | stdio | Token | Partner / Affiliate API Key | [partner.booking.com](https://partner.booking.com) |

---

## 3. Detailanleitungen nach Kategorien

### Code & Cloud
- **Supabase Cloud MCP (`@supabase/mcp-server`):**
  - Ermöglicht Abfragen von Postgres-Tabellen, das Prüfen von Auth-Registrierungen und Logs von Edge Functions.
  - Token unter `Account -> Access Tokens` generieren. Als persönliches oder Team-Token speicherbar.
- **Vercel Deployment MCP (`@vercel/mcp-server`):**
  - Prüft Preview-Deployments, Build-Status, Domains und Umgebungsvariablen.
  - Token in den Vercel Account Settings erstellen.
- **PostgreSQL MCP (`@modelcontextprotocol/server-postgres`):**
  - Kein Auth-Header erforderlich. Die Verbindung erfolgt über die Verbindungszeichenkette `postgresql://benutzer:passwort@host:port/datenbank` in den Argumenten.
- **Puppeteer Browser MCP (`@modelcontextprotocol/server-puppeteer`):**
  - Komplett schlüsselfrei. Startet eine lokale, sandboxed Chromium-Instanz zur automatischen Inspektion von Webseiten.

### Design & Medien
- **Figma Layout MCP (`@figma/mcp-server`):**
  - Liest Frames, Design-Tokens und Komponenten für automatisiertes Code-Connect aus.
  - Personal Access Token unter `Settings -> Account -> Personal access tokens` erzeugen.
- **Canva Assets MCP (`@canva/mcp-server`):**
  - Sucht Vorlagen, Markenvorlagen und exportierte Grafiken.
  - Integration Token im Canva Developer Portal erstellen.

### Produktivität & Office
- **Notion MCP (`@modelcontextprotocol/server-notion`):**
  - Durchsucht und editiert Datenbanken und Seiten.
  - Interne Integration auf `notion.so/my-integrations` anlegen und der Integration Seiten freigeben.
- **Linear MCP (`@linear/mcp-server`):**
  - Tickets, Sprints, Backlogs und Zyklen verwalten.
  - Personal API Key unter `Settings -> Account -> API` erstellen.

---

## 4. Modulare Erweiterung im Quellcode

Die MCP-Vorlagen sind vollständig modular strukturiert:
```
frontend/src/components/ai/singra/mcp/
├── types.ts                    # Typdefinitionen (McpAuthType, SingraMcpPreset)
├── categories.ts               # Kategorien (Code & Cloud, Design, etc.)
├── presets/
│   ├── codeCloud.ts            # 10 Cloud- & Entwickler-Vorlagen
│   ├── designMedia.ts          # 3 Design- & Medien-Vorlagen
│   ├── productivity.ts         # 5 Office- & Produktivitäts-Vorlagen
│   ├── commerceFinance.ts      # 2 E-Commerce- & Zahlungs-Vorlagen
│   ├── communication.ts        # 4 Team-Chat- & CRM-Vorlagen
│   ├── storageFiles.ts         # 3 Datei- & Cloud-Speicher-Vorlagen
│   └── mediaLifestyle.ts       # 3 Medien- & Service-Vorlagen
└── index.ts                    # Aggregierter Export
```
Neue Integrationen können einfach in der passenden Presets-Datei ergänzt werden, ohne andere Module zu berühren.
