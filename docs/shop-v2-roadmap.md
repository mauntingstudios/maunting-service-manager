# MSM Shop & Hosting-Ökosystem 2.0: Master-Roadmap

Stand: 23.11.2026  
Arbeitsgrundlage für den Umbau von Storefront, RBAC-Sichtbarkeit, Multi-Node-Standortwahl, Ankündigungen, News-System und Kundenkonto. Baut direkt auf dem Stand aus [native-shop-roadmap.md](native-shop-roadmap.md) (Phasen 1 bis 8) auf.

---

## Inhaltsübersicht

1. [Zielbild & Die 3 Betriebsmodi (Koexistenz ohne Bruchstellen)](#1-zielbild--die-3-betriebsmodi-koexistenz-ohne-bruchstellen)
2. [Weiterentwicklung der Maunting Design-DNA (v2.1) & Anti-AI-Slop-Regeln](#2-weiterentwicklung-der-maunting-design-dna-v21--anti-ai-slop-regeln)
3. [Paket 1: Strikte RBAC-Sichtbarkeit, Support-Widget-Fix & Modus-Trennung (umgesetzt, 24.11.2026)](#paket-1-strikte-rbac-sichtbarkeit-support-widget-fix--modus-trennung-umgesetzt-24112026)
4. [Paket 2: Nodes 2.0, Private Hybrid-Nodes, CPU-Sichtbarkeit & Standort-Wahl (umgesetzt, 24.11.2026)](#paket-2-nodes-20-private-hybrid-nodes-cpu-sichtbarkeit--standort-wahl-umgesetzt-24112026)
5. [Paket 3: Pop-up- & Ankündigungs-System 2.0 (unten rechts in Shop & Panel) (umgesetzt, 24.11.2026)](#paket-3-pop-up--ankündigungs-system-20-unten-rechts-in-shop--panel-umgesetzt-24112026)
6. [Paket 4: Integriertes News-System (`/news`, Shop-Teaser, Panel & Admin-CMS) (umgesetzt, 24.11.2026)](#paket-4-integriertes-news-system-news-shop-teaser-panel--admin-cms-umgesetzt-24112026)
7. [Paket 5: Shop-Storefront, Katalog, Trustpilot-Option & Konfigurator 2.0 (umgesetzt, 24.11.2026)](#paket-5-shop-storefront-katalog-trustpilot-option--konfigurator-20-umgesetzt-24112026)
8. [Paket 6: Konto- & Abo-Zentrale 2.0 (`/konto` & `/profile` aus einem Guss)](#paket-6-konto--abo-zentrale-20-konto--profile-aus-einem-guss)
9. [Umsetzungsreihenfolge & Globale Qualitäts-Gates](#9-umsetzungsreihenfolge--globale-qualitäts-gates)

---

## 1. Zielbild & Die 3 Betriebsmodi (Koexistenz ohne Bruchstellen)

MSM darf weder nach „Self-Hosted-Panel mit angeklebtem Shop“ noch nach „Bastelprojekt“ aussehen. Alle drei Betriebsarten müssen auf derselben Codebasis logisch zusammenspielen, ohne sich gegenseitig im Weg zu stehen:

| Bereich / Verhalten | 1. Rein Self-Hosted (`shop_enabled = false`) | 2. Rein Commercial Hosting (`shop_enabled = true`) | 3. Hybrid-Betrieb (Privat + Shop gleichzeitig) |
|---|---|---|---|
| **Startroute `/`** | Leitet über `ShopWeiche.tsx` direkt auf `/dashboard` (bzw. `/login`). | Öffentliche Storefront 2.0 (`ShopStart.tsx`). | Öffentliche Storefront 2.0 (`ShopStart.tsx`), Betreiber erreicht Panel über `/dashboard` und Topbar-Link. |
| **Topbar & Navigation** | Zeigt alle für den Benutzer freigegebenen Module (`usePanelNavigation.ts`). Kein Shop-Rauschen, solange weder `shop_enabled` noch `external_shop_url` gesetzt ist. | Ein reiner Kunde sieht nur: Dashboard, Server, News, sein Konto (`/konto/*`), Support und Rechtliches. Kalender, Notizen, Docs, Messenger, Teams und KI-Chat erscheinen nur bei vorhandenem Recht. | Betreiber & Team nutzen private Module (`messenger.use`, `calendar.use`, `notes.use`, `docs.use`, `ai.chat.use`) wie gewohnt; Shop-Kunden sehen davon nichts, außer ein Tarif/Add-on vergibt das Recht explizit. |
| **Nodes & Infrastruktur** | Alle Nodes gehören zum eigenen Cluster. `NodeCapacityCard` und `/admin/nodes` sind für Berechtigte (`nodes.read` / `nodes.manage`) sichtbar. | Kunden sehen keine internen Node-Kapazitäten auf dem Dashboard und keine Blueprint-Interna. Im Shop sehen sie nur zum Verkauf freigegebene Standorte (`nodes.shop_enabled = true`). | Einzelne Nodes können per `shop_enabled = false` rein privat bleiben (z. B. 1 private Node, 9 Shop-Nodes). Private Nodes tauchen weder im Shop noch in der automatischen Shop-/Hoster-Platzierung auf. |
| **Serverliste (`Servers.tsx`)** | Nur eigene Server ohne unnötige Kunden-Tabs. | Mietserver heißen schlicht „Server“. Keine leere Tab-Leiste `Eigene Server (0) | Kundenserver (1)`. | Reiter `Eigene Server | Kundenserver` erscheinen nur für Betreiber (`is_owner` oder `servers.hoster_customers.view`), wenn Kundenserver vorliegen. |
| **Dokumentation (`/docs`)** | Volle Betreiber-Dokumentation (Blueprints, Self-Hosting, OAuth, Hoster-API) für Nutzer mit Operator-Rechten. | Standardkunden sehen unter Hilfe keine internen Server-Installations- oder Hoster-API-Anleitungen, sondern nur Rechtliches (`/privacy`, Impressum) und Support. | Operator-Rollen behalten vollen Zugriff auf `/docs/*`, während Kunden von interner Betreiber-Doku abgeschirmt bleiben. |
| **Konto (`/konto` & `/profile`)** | Fokussiert auf Profil, Sicherheit (Passwort, 2FA, Passkeys, Geräte), Verknüpfungen, Audio/KI. Abrechnungstabs bleiben verborgen, sofern keine historischen Bestellungen/Abos existieren. | Gemeinsame Konto-Zentrale ohne doppelte Rahmen: Abos, Bestellungen, Rechnungen, Zahlungsmethoden, Profil & Sicherheit an einem Ort. | Betreiber hat Zugang zu eigenem Profil/Sicherheit und sieht eigene Bestellungen/Abos getrennt von den Admin-Umsätzen unter `/settings?tab=shop`. |

**Grundregel für Sichtbarkeit im gesamten Panel:**  
**„Kein Recht = nicht sichtbar.“** Weder Topbar noch App-Dashboard, noch Profil-Reiter, noch Kontext-Buttons dürfen einen Menüpunkt oder eine Kachel rendern, wenn dem Benutzer das dahinterliegende Recht oder Modul-Flag fehlt.

---

## 2. Weiterentwicklung der Maunting Design-DNA (v2.1) & Anti-AI-Slop-Regeln

Wir entwickeln die bestehende Maunting Design-DNA (`E:\Github-Projekte\maunting-design-dna` und `frontend/packages/maunting-ui/src/`) weiter, statt ein visuell fremdes Produkt danebenzustellen. Die Erkennungsmerkmale bleiben erhalten: Deep-Ink-Untergrund (`206 31% 4%`), geschichtete Elevation-Surfaces (`--el-0` bis `--el-4`), Ice-Cyan-Akzente (`193 45% 86%`), Mint-Erfolgsstatus (`158 64% 52%`) sowie die Schriften `Manrope`, `Inter` und `JetBrains Mono`.

### 2.1 Was an der Design-DNA konkret geschärft wird

1. **Typografische Hierarchie statt gleichförmiger Schriftgrößen:**
   - Hero- und Hauptsektionen erhalten eng gesetztes `Manrope`-Display-Tracking (`letter-spacing: -0.03em`) und klaren Kontrast zur ruhigen Fließtext-Spalte in `Inter`.
   - Alle Kennzahlen (Preise, Live-Ping in `ms`, RAM-GB, vCPU-Kerne, Slots, Countdowns, Prozentwerte) tragen verbindlich `font-mono tabular-nums`, damit nichts beim Zählen oder Umschalten springt.
2. **Lichtführung & Tiefenstaffelung (`border-edge` + Ambient Artwork Glow):**
   - Wichtige Karten und interaktive Konfigurator-Felder nutzen eine feine 1-Pixel-Oberkante (`border-edge`) und abgestufte `bg-surface-container-*`-Flächen statt identischer Rahmen auf jeder Box.
   - Der Hero-Bereich und die Spiel-Detailseite ziehen eine stark gedämpfte Hintergrund-Atmosphäre aus dem aktuellen Spiel-Artwork, damit jede Spielseite spürbar Charakter hat, ohne die Lesbarkeit der Texte zu stören.
3. **Physikalische Compositor-Animationen (ohne Performance-Verlust):**
   - **Nur Compositor-Eigenschaften animieren:** Bewegungen laufen ausschließlich über `transform` (`translate`, `scale`) und `opacity` (`prefers-reduced-motion` stets respektiert via `MotionProvider` und `@media (prefers-reduced-motion: no-preference)`). Keine Animation von `width`, `height`, `top` oder `margin`.
   - **Top-Layer-Übergänge (`[popover]`, Dialoge, Ankündigungen):** Ein- und Ausblendung mit `@starting-style` sowie `transition-behavior: allow-discrete` als eigene CSS-Regel *nach* `transition` (damit ältere Browser die gesamte Transition nicht verwerfen).
   - **Scroll-Reveals als Progressive Enhancement:** Einstiegs-Animationen von Katalog- und Feature-Blöcken über natives CSS `animation-timeline: view()`, streng gekapselt in `@media (prefers-reduced-motion: no-preference)` und `@supports ((animation-timeline: view()) and (animation-range: entry))` (kein schweres `scroll-timeline-polyfill`).
   - **Wischbare Katalog-Schienen (`Carousel`):** Native horizontale Scroll-Container (`scroll-snap-type: x mandatory`) mit `overscroll-behavior-x: contain` (ausschließlich auf der X-Achse, damit das vertikale Scrollen der Seite nicht blockiert), `touch-action: manipulation`, nativen `<button>`-Pfeilen (Mindest-Klickziel `24×24 px`, Mobil `44×44 px`), `role="region"` / `aria-roledescription="carousel"` und einer visuell versteckten `aria-live="polite"`-Statuszeile.
   - **Auto-rotierender Hero-Showcase:** Ein sichtbarer Pause/Play-`<button>` direkt am Slider (WCAG 2.2.2; *ohne* `aria-pressed`, wenn sich die Beschriftung zwischen „Pause“ und „Play“ ändert) sowie automatischer Stopp bei Hover und Tastaturfokus.
   - **Direkte Eingabe-Rückmeldung:** Jede interaktive Karte und jeder Konfigurator-Schalter liefert getrennte Zustände für `:hover`, `:active` (`scale: 0.98`) und `:focus-visible`.

### 2.2 Konkrete Anti-AI-Slop-Streichliste für den aktuellen Shop

Im bestehenden `frontend/src/shop/pages/ShopStart.tsx` fallen folgende typische KI-Schablonen auf, die komplett entfernt oder neu aufgebaut werden:

1. **Redundante Zwischenbänder streichen:** Die drei austauschbaren Füll-Sektionen `katalogBand` (Zeile 799–823), `shortcuts` (Zeile 927–996) und `abschluss` (Zeile 1000–1037) wiederholen lediglich Links nach `#shop-spiele` und `/konto`, die bereits oben und unten stehen. Sie blähen die Seite künstlich auf und verschwinden ersatzlos.
2. **Keine Einheits-Sektionsköpfe:** Nicht mehr jeder Abschnitt bekommt dieselbe Schablone aus „zentriertem Pill-Badge + zentrierter Großüberschrift + 2-Zeilen-Untertitel“. Sektionen wechseln bewusst zwischen asymmetrischem Split-Layout, horizontaler Schiene und kompaktem Grid.
3. **Ehrliche Aussagen statt leerer Werbefloskeln:** Kein „revolutionär“, „nahtlos“, „bahnbrechend“ (verboten laut `docs/agent-rules/text-und-sprache.md`). Aussagen bleiben konkret und überprüfbar (z. B. echte Setup-Schätzung in Sekunden, konfigurierte Erstattungsfrist in Tagen, gemessene Ping-Latenz in `ms`).
4. **Keine erfundenen Bewertungen oder Partner:** Trustpilot oder Community-Badges werden nur gerendert, wenn der Betreiber sie in den Einstellungen aktiv verknüpft hat.

---

## Paket 1: Strikte RBAC-Sichtbarkeit, Support-Widget-Fix & Modus-Trennung (umgesetzt, 24.11.2026)

### Ist-Zustand & konkrete Befunde im Code

1. **Support-Widget auf Shop- & Konto-Routen deaktiviert (`App.tsx`):**
   - `frontend/src/App.tsx` (Zeile 80–83) definiert `istShopRoute` für `/`, `/shop*` und `/konto*`.
   - Zeile 320–321 rendert `<PrivacyAcknowledgementNotice>` nur bei `!istShopRoute` und `<SupportWidgetLoader enabled={!privacyNoticeVisible && !istShopRoute} />`.
   - Ergebnis: Auf allen Shop- und Konto-Seiten wird der Discord-/Singra-Support-Bot komplett abgeschaltet (`privacyNoticeVisible` startet zudem als `true` und wird ohne gemountete `PrivacyAcknowledgementNotice` nie `false`). Außerdem gibt es im Shop-UI keinen eigenen Button/Link, der den Widget-Launcher bei Bedarf gezielt öffnet.
2. **Kalender, Notizen & Messenger ignorieren Berechtigungen in der Navigation:**
   - Im Backend prüfen `backend/routers/calendar.py` (`_check_calendar_access`, Zeile 96–104) und `backend/routers/notes.py` (`_check_notes_access`, Zeile 36–44) zwar korrekt `calendar.use` bzw. `notes.use` (`403 Forbidden`), aber `frontend/src/components/layout/navigation.tsx` (Zeile 56–58) blendet `/calendar` und `/notes` für **jeden** angemeldeten Benutzer ein, solange das Modul global aktiv ist (`calendarEnabled`, `notesEnabled`). Kunden klicken darauf und laufen direkt in einen 403-Fehler.
   - `frontend/src/services/routeAccess.ts` (Zeile 5–19) enthält weder Regeln für `calendar`, `notes`, `chat`, `teams` noch für `docs`.
   - Für den Messenger (`/chat`, `/api/social/*`) existiert bislang **gar kein** globales Recht in `backend/services/permission_catalog.py`. Sobald `social_enabled = true` ist, darf jeder frisch registrierte Shop-Kunde Nachrichten schicken, Freundschaftsanfragen senden und WebSockets öffnen (`Shell.tsx` Zeile 172–174 lädt automatisch `FreundschaftsWache` und `MessengerHintergrund`).
3. **Teams-Sichtbarkeit hat zwei Fehler (`navigation.tsx` Zeile 67):**
   - Aktuell: `access.owner || access.canUseAi || access.canUseSkills || access.canCreateTeams || (access.teamInvitationCount ?? 0) > 0`.
   - Fehler A: Ein Kunde mit `ai.chat.use` (`canUseAi`) ohne `teams.create` oder `ai.skills.use` sieht `/teams` unnötigerweise.
   - Fehler B: Ein Mitspieler ohne `teams.create`, der über eine Einladung einem Team beigetreten ist, verliert den Menüpunkt `/teams`, sobald `teamInvitationCount` nach der Annahme wieder `0` ist! Es fehlt ein Flag `has_team_membership` in `GET /api/permissions/me`.
4. **`/docs` und `Dashboard.tsx` leaken Betreiber-Interna an Shop-Kunden:**
   - `frontend/src/components/layout/navigation.tsx` (Zeile 77) zeigt `/docs` pauschal jedem eingeloggten Benutzer (`online ? ... : []`), und `routeAccess.ts` setzt `docs: null`. Dadurch sieht jeder Shop-Kunde die internen Anleitungen für Self-Hosting, Caddy, Blueprints, OAuth-Setup und Hoster-API.
   - `frontend/src/pages/Dashboard.tsx` (Zeile 501–584) zeigt jedem Benutzer die Kachel „Unterstützte Spiele“ (`/api/system/games`), also alle Host-Blueprints inkl. interner Varianten, die der Shop gar nicht anbietet.
   - `Dashboard.tsx` `SystemStatusSection` (Zeile 233–326) zeigt `svc.detail` (z. B. Docker-Serverversion, Node-Zähler) ungefiltert jedem Kunden.
   - `UpdateBanner.tsx` (Zeile 17–27) ruft auf jedem Dashboard `GET /api/system/update/status` auf, obwohl der Endpunkt `panel.settings.read` verlangt (erzeugt bei jedem Kunden einen 403-Request im Netzwerk-Log).
   - Leerzustände in `Dashboard.tsx` (Zeile 605–620) und `Servers.tsx` (Zeile 476–486) verweisen bei 0 Servern nicht auf den Shop, wenn `shop_enabled = true` ist.
5. **Doppelte `Servers.tsx`-Tabs bei Kunden:**
   - Kundenserver aus dem Shop tragen `is_hoster_managed = true`. Ein normaler Kunde mit eigenem Mietserver hat 0 „Eigene Server“ und 1 „Kundenserver“. Zwar springt `Servers.tsx` (Zeile 400–407) initial auf `customers`, zeigt dem Kunden aber trotzdem eine Tab-Leiste „Eigene Server | Kundenserver“ (`hasCustomerServers`, Zeile 375 und 488) statt schlicht „Server“.

### Ziel-Zustand & Fachlogik

1. **Support-Widget überall funktional:**
   - `SupportWidgetLoader` läuft auf allen Web-Routen inkl. Shop (`/`, `/shop/*`, `/konto/*`), sobald kein DSGVO-Banner blockiert (im Shop ohne zwingendes Panel-Datenschutz-Overlay sofort aktiv; `PrivacyAcknowledgementNotice` bleibt auf Panel-Routen oder wird mit `ShopRahmen` sauber abgestimmt, damit auf Shop-Seiten niemals `privacyNoticeVisible === true` den Bot aussperrt).
   - `supportWidgetLoader.ts` erhält eine sichere Hilfsfunktion `openSupportWidget()`, die anbieterabhängig (`singra`, `crisp`, `tawk`, `custom`) den Chat/Bot öffnet oder bei deaktiviertem Widget auf eine konfigurierbare Support-URL bzw. `/news` / Kontakt hinweist. Zusätzlicher Support-Trigger im Shop-Header/Footer und im Hilfe-Menü des Panels.
   - Fix für dynamisches Nachladen: Bei verzögerter Script-Injektion nach `DOMContentLoaded` prüfen, ob das Widget-Script den Ready-Zustand direkt initialisiert, und CSP-Konsole im Browser explizit auf Fehler von `singrabot.mauntingstudios.de` prüfen.
2. **Vollständige RBAC-Matrix für alle Ökosystem-Module:**
   - Neues Recht `messenger.use` (Gruppe `panel` bzw. `social`) in `backend/services/permission_catalog.py` sowie Aufnahme in `SHOP_ALLOWED_ROLE_PERMISSIONS` (`backend/services/shop_fulfillment_service.py`).
   - Backend-Durchsetzung: Gemeinsame Dependency `_require_messenger_access` (in `backend/routers/social/basis.py`, `routers/social_calls.py`, `services/chat_media_service.py` sowie `routers/social/ws.py` beim WebSocket-Connect) prüft neben `SocialService.assert_social_enabled(db)` zwingend `has_global_permission(db, user, "messenger.use")`.
   - **Abwärtskompatibilität für Bestandsinstallationen:** Eine Alembic-Migration ergänzt `messenger.use` einmalig für alle nicht-Shop-Bestandsrollen, die vor der Migration bereits aktiv genutzt wurden (bzw. für alle System-/Standardrollen in bestehenden Self-Hosted-Instanzen ohne aktiven Shop), und dokumentiert dies sauber. Neue Shop-Standardrollen (`user`) bleiben minimal ohne `messenger.use`, `calendar.use`, `notes.use`, `docs.use` und `ai.chat.use`.
   - `GET /api/permissions/me` (`backend/routers/permissions.py`, `backend/schemas/permission.py`, `frontend/src/types/permissions.ts`) liefert zusätzlich `has_team_membership: bool` (existiert ein `TeamMember`-Eintrag für `user.id`).
   - Zentrale Policy-Funktionen in `frontend/src/services/routeAccess.ts` und `frontend/src/components/layout/navigation.tsx`:
     - `/calendar`: `calendarEnabled && (owner || canUseCalendar)` (`calendar.use`)
     - `/notes`: `notesEnabled && (owner || canUseNotes)` (`notes.use`)
     - `/chat`: `socialEnabled && (owner || canUseMessenger)` (`messenger.use`)
     - `/dokumente`: `docsEnabled && (owner || canUseDocs)` (`docs.use`)
     - `/teams`: `owner || canCreateTeams || hasTeamMembership || (teamInvitationCount ?? 0) > 0 || canUseSkills` (kein `canUseAi`!)
     - `/ai`: `owner || canUseAi` (`ai.chat.use || ai.skills.manage`)
     - `/docs` (Betreiber-Doku): eigene Policy `canViewOperatorDocs` (`owner || panel.settings.read || blueprints.manage || nodes.read || servers.create || panel.hoster.read || shop.read`). Ohne Operator-Recht wird `/docs` aus `navigation.tsx` ausgeblendet, `/docs/blueprints`, `/docs/oauth`, `/docs/self-hosting` und `/docs/hoster-api` erhalten `RequirePermission`, und normale Kunden erhalten in Topbar/Footer einen klaren Punkt **„Rechtliches & Support“** (`/privacy`, Impressum, Support-Öffner) sowie **„Neuigkeiten“** (`/news`).
   - `Shell.tsx` mountet `FreundschaftsWache` und `MessengerHintergrund` nur bei `socialEnabled && (owner || canUseMessenger)`; `DesktopApp.tsx` übernimmt exakt dieselben Berechtigungen für seine Routen und Offline-Fallbacks.
   - `Profile.tsx`: Reiter `social` (Freunde/Privatsphäre) und `audio` (Sprach-/Anruf-Einstellungen, sofern kein KI-Sprachrecht vorliegt) nur bei `canUseMessenger` bzw. `canUseAi || canUseMessenger`.
3. **Kunden-freundliches Dashboard & Server-Ansicht:**
   - `UpdateBanner.tsx`: `fetchStatus()` nur ausführen, wenn `useHasPermission('panel.settings.read')` wahr ist (keine unnötigen 403-Requests bei Kunden).
   - `Dashboard.tsx`:
     - Kachel „Unterstützte Spiele“ (`/system/games`) nur rendern, wenn der Nutzer Operator-Rechte hat (`canCreateServer || canViewOperatorDocs`); normale Kunden bekommen stattdessen eine kompakte 2-Spalten-Übersicht (Ihre Server-Aktivität + Systemstatus ohne Infrastruktur-Versionsstrings wie Docker-Version, falls `system.view` fehlt, oder einen Shop-Schnellzugriff „Weiteren Server mieten“ wenn `shop_enabled`).
     - Empty-State bei 0 Servern: Bei `shop_enabled && !canCreateServer` führt der Hauptbutton nach `/` („Server im Shop mieten“), bei `canCreateServer` nach `/servers`.
   - `Servers.tsx`:
     - Die Tab-Leiste `Eigene Server | Kundenserver` wird nur angezeigt, wenn der Benutzer Betreiber ist (`isOwner || hasPermission('servers.hoster_customers.view')`) **und** beide Kategorien relevant sind (`hasCustomerServers`). Ein Kunde sieht all seine Server direkt unter einer einheitlichen Liste ohne Hoster-Tab.
     - Empty-State bei `shop_enabled && !canCreateServer`: direkter CTA „Server im Shop konfigurieren“.

### Betroffene Dateien

- **Backend:**
  - `backend/services/permission_catalog.py` (`messenger.use`)
  - `backend/services/shop_fulfillment_service.py` (`SHOP_ALLOWED_ROLE_PERMISSIONS`)
  - `backend/routers/social/basis.py`, `backend/routers/social/ws.py`, `backend/routers/social_calls.py`, `backend/services/chat_media_service.py`
  - `backend/routers/permissions.py`, `backend/schemas/permission.py`
  - `backend/migrations/versions/<neu>_messenger_permission_and_hygiene.py`
- **Frontend:**
  - `frontend/src/App.tsx`, `frontend/src/lib/supportWidgetLoader.ts`
  - `frontend/src/types/permissions.ts`, `frontend/src/services/routeAccess.ts`, `frontend/src/components/layout/navigation.tsx`, `frontend/src/components/layout/usePanelNavigation.ts`
  - `frontend/src/components/layout/Topbar.tsx`, `frontend/src/components/layout/Shell.tsx`, `frontend/src/desktop/DesktopApp.tsx`, `frontend/src/desktop/hilfe/HilfeBereich.tsx`
  - `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Servers.tsx`, `frontend/src/pages/Profile.tsx`, `frontend/src/components/UpdateBanner.tsx`

### Stolpersteine & Invarianten

- **Lektion 252 (`AGENTS.md`):** Sobald `usePanelNavigation` oder `useEffectivePermissions` neue Felder liest, müssen alle `vi.mock`-Fabriken (`DashboardBereich.test.tsx`, `DesktopApp.test.tsx`, `DashboardReiter.test.tsx`) auf `importOriginal` geprüft und ggf. ergänzt werden.
- **`navigation.test.ts`:** Bestehende Tests wie Zeile 144–160 (`hides calendar from navigation when calendarEnabled is false`) müssen auf explizite Permission-Flags (`canUseCalendar: true`, `canUseNotes: true`, `canUseMessenger: true`) umgestellt und um Negativtests erweitert werden.
- **Tauri-/Android-Offline-Pfade:** `getErlaubteOfflineRouten` in `DesktopApp.tsx` muss im eingeloggten Offline-Zustand die zuletzt bekannten Berechtigungen respektieren, ohne dass die App beim Start mangels Netz in eine leere weiße Fläche läuft (Fallback auf `/einstellungen` bleibt sicher erhalten).
- **Keine Secrets im Support-Loader:** `supportWidgetLoader.ts` behält die strikte Origin-Allowlist `ALLOWED_WIDGET_ORIGINS` und wirft nie HTML via `innerHTML` ins DOM.

### Tests & Laufzeit-Abnahme

- Backend (`pytest`): Negative + positive RBAC-Tests für `messenger.use` auf Social-HTTP- und WebSocket-Routen, Test auf `has_team_membership` in `/api/permissions/me`, Self-Heal der `admin`-Rolle.
- Frontend (`vitest`): `navigation.test.ts`, `routeAccess`-Tests, `supportWidgetLoader.test.ts`, `Dashboard.test.tsx`, `Servers.test.tsx`, `Topbar`- & `Profile.test.tsx`.
- Laufzeitprobe im Browser:
  1. Shop-Kunde ohne Zusatzrechte: `/`, `/shop/:id`, `/dashboard`, `/servers`, `/profile` öffnen -> Support-Widget sichtbar & klickbar, kein `/calendar`/`/notes`/`/chat`/`/docs` in Topbar, kein 403-Fehler in der Browser-Konsole.
  2. Self-Hosted-Admin: Alle Module und `/docs/*` voll erreichbar.

### Umsetzungsstand & Erkenntnisse (Paket 1)

- **Backend-Umsetzung:**
  - `messenger.use` in `backend/services/permission_catalog.py` (`GLOBAL_PERMISSIONS`) und `backend/services/shop_fulfillment_service.py` (`SHOP_ALLOWED_ROLE_PERMISSIONS`) ergänzt.
  - Migration `backend/migrations/versions/20261124_01_messenger_permission_and_hygiene.py` (`down_revision = "20261122_04"`) angelegt: fügt `messenger.use` idempotent zur Rolle `admin` hinzu und vergibt es bei `shop_enabled != "true"` an bestehende Rollen mit `calendar.use`, `notes.use` oder `docs.use`.
  - `/api/permissions/me` (`backend/schemas/permission.py`, `backend/routers/permissions.py`) um `has_team_membership` erweitert; persönliche 1-Personen-KI-Teams (`Team.personal_for_user_id IS NOT NULL`) werden dabei ausgeklammert.
  - `backend/routers/social/basis.py` um `_require_messenger_access(db, user)` erweitert und auf die Messenger-Routen (`chats.py`, `messages.py`, `friends.py`, `profiles.py`, `push.py`, `stories.py`, `groups.py`, `media.py`, `e2ee_keys.py` `/e2ee/chat-keys`, `ws.py` sowie `social_calls.py` `router`) gelegt; `_check_social_enabled` bleibt als reiner Modul-Schalter bestehen.
- **Frontend-Umsetzung:**
  - `PermissionEditor.tsx`, `types/permissions.ts`, `routeAccess.ts`, `navigation.tsx`, `usePanelNavigation.ts`, `App.tsx`, `Shell.tsx`, `BrowserApp.tsx` und `DesktopApp.tsx` auf striktes RBAC-Gating für `/calendar`, `/notes`, `/chat*`, `/user/:userId`, `/teams` (`has_team_membership` ohne `canUseAi`-Fallback), `/docs*` (Betreiberrechte) sowie Social-Hintergrundkomponenten (`FreundschaftsWache`, `MessengerHintergrund`, `AnrufEbene`, `usePresenceAndActivity`, `CrossDeviceCallBanner`) umgestellt.
  - `UpdateBanner.tsx` auf `panel.settings.read` beschränkt, `Profile.tsx` / `profile/DevicesTab.tsx` bereinigt und `Dashboard.tsx` sowie `Servers.tsx` für Kunden ohne Betreiberrechte von unterstützten Spielen, Service-Details und Kundenserver-Tabs getrennt (mit direktem Shop-Hinweis, wenn `!canCreateServer && shopEnabled`).
  - `supportWidgetLoader.ts`, `SupportWidgetLoader.tsx`, `Topbar.tsx`, `ShopKopf.tsx` und `ShopRahmen.tsx` um `isSupportWidgetActive`, `subscribeSupportWidgetState`, `openSupportWidget` sowie sichtbare `/privacy`- und Support-Trigger (Nicht-Betreiber und Shop) erweitert.
  - i18n-Schlüssel in `de.json` und `en.json` ergänzt (`npm run check`: `en/de parity: 11287 keys`).
- **Verifikation:**
  - **Backend (`pytest` gegen PostgreSQL auf Port 15499):** Shop-Suite (`tests/test_shop_fulfillment.py`, `tests/test_shop_cpu_and_role_addons.py`, `tests/test_shop_orders.py`) `17 passed`; zuvor im identischen Stand `248 passed` über Permissions-/Social-/Messenger-Suiten sowie `6 passed` im Katalog-Contract-Lauf (1 vorbestehender Fehler wegen fehlendem `ai.projects.preview` in `PermissionEditor.tsx` abgewählt).
  - **Frontend (`vitest`, nach letztem Edit):** 12 Testdateien mit `154 passed` (`Topbar.test.tsx`, `Shell.test.tsx`, `UpdateBanner.test.tsx`, `Dashboard.test.tsx`, `Servers.test.tsx`, `Profile.test.tsx`, `navigation.test.ts`, `routeAccess.test.ts`, `supportWidgetLoader.test.ts`, `DashboardReiter.test.tsx`, `DashboardBereich.test.tsx`, `DesktopApp.test.tsx`).
  - **Frontend-Builds (nach letztem Edit):** `npm run build` (`npm run check && tsc && vite build`) und `npm run build:desktop` jeweils mit Exit-Code `0`.
  - **Noch offen:** Die manuelle Browser-Laufzeitprobe (Kundenkonto vs. Self-Hosted-Admin gegen einen laufenden Dev-Stack) steht noch aus.
- **Erkenntnisse & vorbestehende Befunde:**
  1. **Geteilte E2EE-Endpunkte:** `e2ee_keys.py` (`/e2ee/account*`, `/e2ee/account/bundle*`) und `devices.py` (`/e2ee/devices/*`) werden von Notizen, Kalender und Team-Tresor mitgenutzt (`notesCalendarCrypto.ts`) und bleiben deshalb ohne `messenger.use`. Ebenfalls ungesperrt bleiben `GET /groups/invite/{invite_code}` (öffentliche Einladungsvorschau) und `GET /media/{media_id}/download` (signierte HMAC-URL).
  2. **Singra-Widget-Loader:** `supportWidgetLoader.ts` setzt zusätzlich zu `async = true` weiterhin `script.defer = true` (`supportWidgetLoader.test.ts`).
  3. **Vorbestehende Altbefunde (nicht durch Paket 1 verursacht):** `ai.projects.preview` fehlt in `PermissionEditor.tsx` (`test_permission_catalog_ui_contract.py`), `blueprints.write` in Routern weicht von `blueprints.manage` im Katalog ab (`test_permission_catalog.py`), und `src/locales/schreibweise.test.ts` meldet 4 bestehende Title-Case-Keys in `en.json` (`serverVariables.dateiTabOeffnen`, `settings.shop.betrieb.betreiberAnsichtBadge`, `shop.konto.rechnungen.kontextBadge`, `hoster.products.openShopSettings`).
- **Ideen für Folgepakete:**
  - **Support-Fallback ohne Widget:** Wenn kein Singra- oder Custom-Widget aktiv ist, fehlt aktuell ein konfigurierbarer Support-Link als Fallback (z. B. E-Mail/Ticket-URL).
  - **E2EE-Nachsync gezielter laden:** `useKontoBundNachholen(isAuthenticated)` in `App.tsx` bei reinen Shop-Kunden ohne Notizen, Kalender oder Messenger perspektivisch nur bei Bedarf ausführen.
  - **Optische Einbindung in Paket 5:** Die ergänzten Datenschutz- und Support-Einträge im `ShopKopf` bei der Neugestaltung von Navigation und Drawer in Paket 5 einheitlich mitnehmen.

---

## Paket 2: Nodes 2.0, Private Hybrid-Nodes, CPU-Sichtbarkeit & Standort-Wahl (umgesetzt, 24.11.2026)

### Ist-Zustand & konkrete Befunde im Code

1. **Gequetschter „Node bearbeiten“-Dialog (`frontend/src/pages/AdminNodes.tsx`):**
   - `DialogContent` (`frontend/packages/maunting-ui/src/Dialog.tsx`, Zeile 150–200) setzt kein eigenes Innen-Padding, damit `DialogHeader` (`p-6`) und `DialogFooter` (`p-4`) bündig abschließen.
   - In `AdminNodes.tsx` (Zeile 495–642) sitzt das `<form onSubmit={handleSave} className="space-y-4">` jedoch **direkt ohne Padding und ohne Scrollbereich** in `<DialogContent className="max-w-lg">`. Dadurch kleben alle Felder ohne linken, rechten, oberen und unteren Abstand am Kartenrand; die 3er-Reihe (`sm:grid-cols-3`, Zeile 522) quetscht Standort, RAM-Typ und Storage-Typ auf `512px` Breite zusammen, und bei mehr Feldern läuft der Dialog aus kleinen Viewports heraus.
2. **Fehlende Node-Felder für Hybrid-Betrieb, CPU-Anzeige & optionale Standort-Preisklassen:**
   - `backend/models/node.py` kennt bisher weder eine Shop-Freigabe (`shop_enabled`) noch eine Steuerung für die CPU-Sichtbarkeit (`shop_show_cpu`) noch Standort-/Hardware-Klassen mit optionalem Aufpreis (`hardware_tier_label`, `shop_surcharge_cents`).
   - Im Hybrid-Betrieb (z. B. 1 private Node + 9 Shop-Nodes) listet `public_node_statuses()` (`backend/services/shop_catalog_service.py`, Zeile 454) aktuell **alle** Nodes ungefiltert auf, und `node_placement_service.py` (Zeile 169 und 219) platziert Shop-Kunden ggf. auch auf einer privaten Node.
   - `public_node_statuses()` und `_plan_hardware_summary()` liefern `cpu_model` immer unmasked aus; Betreiber können das CPU-Modell aktuell nicht ausblenden.
3. **Ping-Test ohne Übernahme in den Checkout:**
   - `ShopStart.tsx` (Zeile 73–127, 487–579) misst zwar echte Latenzen (`public_ping_url` direkt aus dem Browser per `fetch(..., { mode: 'no-cors' })` oder Fallback über `GET /api/shop/nodes/{node_id}/ping`), der Nutzer kann das Ergebnis aber nicht auswählen.
   - `ShopSpiel.tsx`, `Konfigurator.tsx`, `ShopKasse.tsx` und `ShopOrderCreate` (`backend/schemas/shop.py` Zeile 229) haben noch kein Feld `preferred_node_id`.
   - `shop_fulfillment_service.py` (Zeile 403) setzt bei der Servererstellung starr `node_id=plan.node_id if plan is not None else None`, statt eine vom Kunden gewählte `preferred_node_id` zu übernehmen.

### Ziel-Zustand & Fachlogik

1. **Aufgeräumter „Node bearbeiten“-Dialog (`AdminNodes.tsx`):**
   - Breite auf `max-w-2xl` (mit sauberem `max-h-[90dvh]` am Dialog-Container).
   - Das `<form>` umschließt einen eigenen scrollbaren Innenbereich `px-6 py-5 space-y-6 overflow-y-auto` vor dem feststehenden `<DialogFooter>`, sodass oben, unten, links und rechts großzügig Luft bleibt.
   - Klare Sektionierung durch ruhige Abschnitts-Überschriften und `sm:grid-cols-2`-Raster:
     1. **Verbindung & Sicherheit** (Name, Agent-Host, TLS-Fingerprint, Agent-Token).
     2. **Standort & Hardware** (Standort-Anzeigename, RAM-Typ, Storage-Typ, öffentliche Ping-URL).
     3. **DDoS-Schutz** (Anbieter, Profil, Game-Aware-Schalter).
     4. **Shop-Vermietung & Hybrid-Steuerung** (Schalter „Im Shop zur Vermietung freigeben“, Schalter „CPU-Modell im Shop anzeigen“, optionale Hardware-Klassen-Bezeichnung z. B. „Standard“ oder „Performance“, optionaler monatlicher Standort-Aufpreis in € mit Standard `0,00 €`).
2. **Datenmodell & Migration (`nodes` und `shop_order_items`):**
   - `backend/models/node.py` (mit Alembic-Migration, sichere Defaults für Bestandsdaten):
     - `shop_enabled: bool` (Default `True`, `server_default=true()`, nicht null): `False` = rein private/interne Node.
     - `shop_show_cpu: bool` (Default `True`, `server_default=true()`, nicht null): `False` = `cpu_model` wird im öffentlichen Shop maskiert (`None`).
     - `hardware_tier_label: str | None` (`String(64)`, nullable): optionale Klassenbezeichnung im Shop.
     - `shop_surcharge_cents: int` (Default `0`, `server_default="0"`, `CheckConstraint("shop_surcharge_cents >= 0")`): optionaler monatlicher Aufpreis in Cent bei Wahl dieses Standorts/dieser Hardware-Klasse (`0` = kostenlose Standortwahl).
   - `backend/models/shop.py` (`ShopOrderItem` & `ShopEntitlement`):
     - `preferred_node_id: int | None` (`ForeignKey("nodes.id", ondelete="SET NULL")`, nullable): gemerkter Wunsch-Standort für Bestellung, Verlängerung und Provisionierung.
     - `node_surcharge_cents: int` (Default `0`, `server_default="0"`): unveränderlicher Preis-Snapshot des Standort-Aufpreises zum Kaufzeitpunkt.
3. **Schutz privater Nodes & Preis-/Kapazitäts-Logik im Backend:**
   - `shop_catalog_service.public_node_statuses()`:
     - Filtert strikt `Node.shop_enabled.is_(True)`.
     - Setzt `cpu_model=None`, wenn `node.shop_show_cpu` `False` ist.
     - Gibt `hardware_tier_label` und `shop_surcharge_cents` im `ShopPublicNodeStatusResponse` mit aus.
   - `shop_catalog_service.ping_public_node(db, node_id)`:
     - Lehnt Nodes mit `shop_enabled == False` wie nicht existierende Nodes mit `None` (`404`) ab, damit niemand private Nodes über ID-Enumeration anpingen kann.
   - `shop_catalog_service._plan_hardware_summary` und `_plan_ddos_summary`:
     - Berücksichtigen nur Nodes mit `shop_enabled.is_(True)` und respektieren `shop_show_cpu`.
   - `node_placement_service.py`:
     - `find_candidate_nodes(..., shop_only: bool = False)` und `check_plan_availability(..., preferred_node_id: int | None = None, shop_only: bool = True)`:
       - Bei `shop_only=True` werden ausschließlich Nodes mit `Node.shop_enabled.is_(True)` bewertet.
       - Ist `preferred_node_id` übergeben, wird ausschließlich diese eine Node geprüft (`node_not_available_for_shop`, `node_offline` oder Kapazitätsengpass `insufficient_node_ram`/`cpu`/`disk`).
       - **Wichtig für kostenlose vs. kostenpflichtige Standorte bei automatischer Wahl (`preferred_node_id is None`):** Im Modus „Automatisch / Bester Standort“ werden standardmäßig zuerst kostenlose Shop-Nodes (`shop_surcharge_cents == 0`) gewählt, damit kein Kunde bei „Automatisch“ still auf einer Aufpreis-Node oder ein Betreiber durch Gratis-Abgabe einer teureren Hardware-Klasse Verlust macht. (Ausnahme: wenn ein Plan bereits fest über `plan.node_id` an genau eine Node gebunden ist.)
       - **Pro-Standort-Verfügbarkeit für den Konfigurator:** `POST /api/shop/availability` liefert neben dem Gesamtergebnis optional `nodes: list[{ node_id, available, reason }]`, sodass der Konfigurator bei RAM-/CPU-Änderung sofort zeigt, welcher Standort frei und welcher bei dieser Größe ausgebucht ist.
   - `shop_order_service.py` & `shop_fulfillment_service.py`:
     - `_resolve_plan_spec` validiert eine angegebene `preferred_node_id`: Node muss existieren, `shop_enabled == True` sein, bei einem Plan mit fester `plan.node_id` mit diesem übereinstimmen (sonst `422`), und freie Kapazität für die gewählten RAM/CPU-Werte haben (sonst `409 ShopCapacityError`).
     - Preisberechnung ausschließlich serverseitig: Der monatliche Bruttopreis addiert `node.shop_surcharge_cents` (bei Lifetime-Modus analog `* 12`, rabattiert nach Laufzeit-/Abo-Regeln wie der übrige Tarif) und speichert `preferred_node_id` + `node_surcharge_cents` auf `ShopOrderItem`.
     - `shop_fulfillment_service.py` übergibt bei der Server-Provisionierung (`server_provisioning_service.provision_server`) `node_id = item.preferred_node_id or (plan.node_id if plan else None)` und erzwingt `shop_only=True` (gilt auch für `hoster_service_lifecycle.py`), sodass weder Shop noch Hoster-API jemals auf einer privaten Node landen können.
     - Bei `AdminNodes` und im Server-Create-Dialog (`/servers`) bleibt `shop_only=False`: Betreiber können ihre privaten Nodes wie bisher voll verwalten und dort eigene Server erstellen.
4. **Durchgängige Standort-Auswahl im Frontend:**
   - Neuer schlanker Client-Store `frontend/src/shop/shopStandortStore.ts` speichert `ausgewaehlteNodeId: number | null` (null = „Automatisch / Bester freier Standort“) sowie die zuletzt gemessenen Ping-Werte je Node (`pingMsByNodeId`), damit Messergebnisse von der Startseite direkt im Konfigurator sichtbar bleiben.
   - Auf `ShopStart`: Klick auf eine gemessene oder gelistete Standort-Karte im Ping-Bereich wählt diesen Standort direkt aus (Button „Standort wählen“ / „Ausgewählt“) und merkt ihn für den Konfigurator. Ausgebuchte oder Offline-Nodes sind klar als nicht buchbar markiert.
   - In `Konfigurator.tsx` & `ShopSpiel.tsx`: Neuer Abschnitt „Standort & Hardware“ mit Option „Automatisch (kostenlos · bester freier Standort)“ sowie Karten für jeden freigeschalteten Standort inkl. Ping-Badge, Auslastung, DDoS-Hinweis, optionalem CPU-Modell (falls `cpu_model !== null`), optionalem Aufpreis (`Inklusive` oder `+X,XX €/Monat`) und Live-Status („Verfügbar“ vs. „Für diese Größe ausgebucht“).
   - `PreisPanel.tsx` und `ShopKasse.tsx` führen den gewählten Standort und einen eventuellen Standort-Aufpreis transparent als eigene Position auf.

### Betroffene Dateien

- **Backend:**
  - `backend/models/node.py`, `backend/models/shop.py`
  - `backend/migrations/versions/<neu>_nodes_shop_controls_and_order_node.py`
  - `backend/schemas/node.py`, `backend/schemas/shop.py`
  - `backend/routers/nodes.py`, `backend/routers/shop.py`
  - `backend/services/node_service.py`, `backend/services/node_placement_service.py`, `backend/services/shop_catalog_service.py`, `backend/services/shop_order_service.py`, `backend/services/shop_fulfillment_service.py`, `backend/services/server_provisioning_service.py`, `backend/services/hoster_service_lifecycle.py`
- **Frontend:**
  - `frontend/src/types/index.ts`, `frontend/src/api/shop.ts`, `frontend/src/shop/typen.ts`, `frontend/src/shop/preis.ts`
  - `frontend/src/shop/shopStandortStore.ts`
  - `frontend/src/pages/AdminNodes.tsx`
  - `frontend/src/shop/pages/ShopStart.tsx`, `frontend/src/shop/pages/ShopSpiel.tsx`, `frontend/src/shop/components/Konfigurator.tsx`, `frontend/src/shop/components/PreisPanel.tsx`, `frontend/src/shop/pages/ShopKasse.tsx`

### Stolpersteine & Invarianten

- **Kapazitäts-Race bei Checkout:** Zwischen Konfigurator und Stripe-Webhook können Sekunden vergehen. `server_provisioning_service._lock_and_allocate_node` sperrt bereits die Node-Zeile per `SELECT ... FOR UPDATE`; wenn eine Wunsch-Node zwischenzeitlich voll läuft, darf die Order nicht still auf eine andere Node umgebogen werden, sondern bricht vor Checkout (HTTP 409) bzw. im Fulfillment als sauber diagnostizierbarer `entitlement.provisioning_error` ab, damit der Betreiber eingreifen oder erstatten kann.
- **CPU-Maskierung konsequent:** Ist `shop_show_cpu = false`, darf das CPU-Modell nirgendwo in öffentlichen Responses (`/api/shop/nodes/status`, `/api/shop/catalog`) durchsickern.
- **Standort-Aufpreis und Gutscheine/Laufzeitrabatte:** Der Standort-Aufpreis wird in `_monthly_gross` bzw. in `_resolve_plan_spec` eingerechnet, bevor Laufzeitrabatte und Coupons berechnet werden, und muss in Frontend (`preisAufschluesselung`) und Backend (`shop_order_service.py`) auf den Cent identisch sein.

### Tests & Laufzeit-Abnahme

- Backend (`pytest`):
  - Private Node (`shop_enabled=False`) taucht in `/api/shop/nodes/status` nicht auf, `/api/shop/nodes/{id}/ping` liefert 404, `POST /api/shop/orders` mit dieser Node liefert 422, automatische Platzierung überspringt sie, Admin-`POST /api/servers` kann weiterhin auf ihr provisionieren.
  - `shop_show_cpu=False` setzt `cpu_model=None` in öffentlichen Endpunkten, nicht aber in `/api/nodes` für Admins.
  - `preferred_node_id` mit `shop_surcharge_cents > 0` erhöht den serverseitigen Preis exakt; volle Wunsch-Node liefert HTTP 409 (`shop_out_of_capacity`).
- Frontend (`vitest`): `AdminNodes.test.tsx` (Layout/Felder), `Konfigurator`- & `preis.ts`-Tests, `ShopKasse`-Checkout-Payload inkl. `preferred_node_id`.
- Browser-Probe: `/admin/nodes` -> „Node bearbeiten“ visuell auf Abstände/Scrolling auf Desktop & schmalem Viewport prüfen; Ping-Test auf `/` -> Standort wählen -> `/shop/:id` -> `/shop/:id/kasse` komplett durchklicken.

### Umsetzungsstand & Erkenntnisse (Paket 2)

- **Backend-Umsetzung:**
  - `backend/models/node.py` um `shop_enabled` (Default `True`), `shop_show_cpu` (Default `True`), `hardware_tier_label` (`String(64)`) und `shop_surcharge_cents` (`>= 0`) erweitert; `backend/models/shop.py` um `preferred_node_id` + `node_surcharge_cents` (`ShopOrderItem`) sowie `preferred_node_id` (`ShopEntitlement`) ergänzt.
  - Alembic-Migration `backend/migrations/versions/20261124_02_nodes_shop_controls_and_order_node.py` (`down_revision = "20261124_01"`) angelegt; Single-Head-Prüfung `['20261124_02']` bestanden.
  - `backend/schemas/node.py`, `backend/services/node_service.py` und `backend/routers/nodes.py` um die neuen Felder samt Validierung erweitert.
  - `backend/services/node_placement_service.py` um `shop_only`-Isolierung, Bevorzugung kostenloser Shop-Nodes (`shop_surcharge_cents == 0`) im Automatik-Modus, Prüfung gewählter `preferred_node_id` und Pro-Standort-Verfügbarkeit (`NodeAvailabilityEntry`) erweitert.
  - `backend/services/shop_catalog_service.py` und `backend/routers/shop.py`: `/api/shop/nodes/status`, `/api/shop/nodes/{id}/ping`, `_plan_hardware_summary` und `_plan_ddos_summary` strikt auf `shop_enabled=True` eingegrenzt; `cpu_model` wird bei `shop_show_cpu=False` in allen öffentlichen Endpunkten auf `None` maskiert; `POST /api/shop/availability` gibt Standortstatus je Node zurück.
  - `backend/services/shop_order_service.py`, `backend/services/shop_fulfillment_service.py`, `backend/services/server_provisioning_service.py` und `backend/services/hoster_service_lifecycle.py` validieren `preferred_node_id`, rechnen `node_surcharge_cents` vor Laufzeit-, Abo- und Coupon-Rabatten sowie beim Lifetime-Faktor (`* 12`) ein und erzwingen `shop_only=True` bei Shop- und Hoster-Provisionierung.
- **Frontend-Umsetzung:**
  - `frontend/src/pages/AdminNodes.tsx`: Dialog „Node bearbeiten“ / manuell anlegen auf `max-w-2xl max-h-[90dvh]` mit scrollbarem, gepolstertem Innenbereich (`px-6 py-5 space-y-6 overflow-y-auto`) vor dem feststehenden Footer in vier klaren Sektionen umgebaut; Hybrid-, CPU-Sichtbarkeits-, Hardware-Klassen- und Aufpreis-Felder sowie Karten-Badges ergänzt.
  - `frontend/src/shop/shopStandortStore.ts`, `frontend/src/types/index.ts`, `frontend/src/api/shop.ts`, `frontend/src/shop/typen.ts` und `frontend/src/shop/preis.ts` (`standortCent`) umgesetzt.
  - `frontend/src/shop/pages/ShopStart.tsx`, `frontend/src/shop/pages/ShopSpiel.tsx`, `frontend/src/shop/components/Konfigurator.tsx`, `frontend/src/shop/components/PreisPanel.tsx` und `frontend/src/shop/pages/ShopKasse.tsx` für durchgängige Ping-/Standort-/Aufpreis-Auswahl vom Startbereich bis zum Checkout verbunden; Übersetzungen in `de.json` und `en.json` ergänzt (`en/de parity: 11315 keys`).
- **Verifikation (nach letztem Code-Edit):**
  - **Backend (`pytest` gegen PostgreSQL auf Port 15499):** Placement-, Node- und Shop-Suiten (`test_multi_node_placement_and_capacity.py`, `test_nodes_router.py`, `test_shop_phase6_transparency.py`, `test_shop_orders.py`, `test_shop_fulfillment.py`, `test_shop_catalog.py`, `test_shop_phase7_bestof.py`) `55 passed`; Hoster- & Node-Kapazitäts-Suiten (`test_hoster_v2_apply.py`, `test_node_capacity.py`) `16 passed`.
  - **Frontend (`vitest`):** 5 Paket-2-Testdateien mit `31 passed` (`AdminNodes.test.tsx`, `preis.test.ts`, `ShopStart.test.tsx`, `ShopSpiel.test.tsx`, `ShopKasse.test.tsx`). Zuvor bestätigte `src/locales/schreibweise.test.ts` auf unverändertem `en.json`-Stand weiterhin nur die 4 vorbestehenden Alt-Keys ohne neue Verstöße.
  - **Frontend-Builds:** `npm run build` (`npm run check && tsc && vite build`) und `npm run build:desktop` (`npm run check && tsc && vite build --config vite.desktop.config.ts`) jeweils mit Exit-Code `0`.
  - **Noch offen:** Die visuelle Browser-Probe für den umgebauten „Node bearbeiten“-Dialog auf Desktop und schmalem Viewport sowie der Klickpfad `/` -> `/shop/:id` -> `/shop/:id/kasse` stehen noch aus.
- **Erkenntnisse:**
  1. **Deutsches Komma bei Aufpreisen (`type="text" inputMode="decimal"`):** `<input type="number">` verwirft Eingaben mit Dezimalkomma wie `4,50` im Browser/jsdom als ungültig. Ein Textfeld mit `inputMode="decimal"` erlaubt sowohl `4,50` als auch `4.50` ohne stilles Zurücksetzen auf `0`.
  2. **Automatik-Modus vs. Bezahl-Klassen:** Wenn kostenlose Shop-Nodes voll sind und nur noch Aufpreis-Nodes Platz haben, darf der Shop-Automatikpfad nicht still auf die teurere Node ausweichen. Gleichzeitig liefert `catalog_plan` das Spiel weiterhin als verfügbar, solange mindestens eine Shop-Node im Konfigurator wählbar ist.
  3. **Badge-Varianten (`@maunting/ui`):** `Badge` kennt `"default" | "success" | "warning" | "destructive" | "info"` (kein `"neutral"`).
- **Ideen für Folgepakete:**
  - **Startseiten-Ping & Konfigurator-Design in Paket 5:** Die neue Standort-Auswahl und Ping-Karten werden in Paket 5 visuell an die überarbeitete Storefront angepasst.
  - **Kundenwechsel von Node nach Kauf (Support/Upgrade):** Falls Kunden später von Standard- auf Performance-Hardware wechseln möchten, ließe sich ein tarifierter Node-Umzug im Konto-Upgrade (Paket 6) vorsehen.

---

## Paket 3: Pop-up- & Ankündigungs-System 2.0 (unten rechts in Shop & Panel) (umgesetzt, 24.11.2026)

### Ist-Zustand & konkrete Befunde im Code

1. **Blockierendes Riesen-Modal statt dezentem Pop-up (`PanelPopupModal.tsx`):**
   - `frontend/src/components/popups/PanelPopupModal.tsx` (Zeile 94–103) rendert ein zentriertes Vollbild-Overlay (`msm-modal-overlay z-50 flex items-center justify-center p-4`) mit `max-w-2xl`.
   - Das unterbricht Nutzer mitten in der Arbeit im Panel und wäre auf einer Shop-Startseite als Erstkontakt zu aufdringlich.
2. **Fehlt auf Shop-Routen und funktioniert nicht für Gäste:**
   - `PanelPopupModal` ist derzeit nur in `frontend/src/components/layout/Shell.tsx` (Zeile 177) und `DesktopApp.tsx` (Zeile 36) eingebunden, fehlt jedoch in `frontend/src/shop/ShopRahmen.tsx`.
   - `GET /api/popups/active` (`backend/routers/popups.py`, Zeile 29–33) erzwingt `Depends(get_current_user)` und funktioniert für unregistrierte Shop-Besucher gar nicht.
   - `PanelPopup` (`backend/models/panel_popup.py`) unterscheidet nicht, ob eine Meldung für den Shop, nur für eingeloggte Panel-Nutzer oder für beide gedacht ist.
3. **Kollisionsgefahr unten rechts:**
   - Unten rechts liegen bereits potenziell der Support-Widget-Launcher, `AiRunNotice.tsx` (`fixed bottom-4 right-4` im Panel) und mobil `var(--msm-unten-sicher)` (Android-Gestenleiste). Wenn die neue Pop-up-Karte blind nach `bottom-4 right-4` gesetzt wird, verdeckt sie den Discord-/Support-Button.

### Ziel-Zustand & Fachlogik

1. **Zielgruppen & Tonalität im Backend (`panel_popups`):**
   - `PanelPopup` (`backend/models/panel_popup.py`) und `schemas/popup.py` werden um zwei optionale, abwärtskompatible Spalten erweitert:
     - `audience: Literal['all', 'shop', 'panel']` (Default `'all'`, `server_default='all'`): Steuert, ob die Ankündigung im öffentlichen Shop, nur im internen Panel oder auf beiden Oberflächen erscheint.
     - `tone: Literal['info', 'promo', 'maintenance']` (Default `'info'`, `server_default='info'`): Steuert die dezente Akzentfarbe (Ice-Cyan, Mint/Rabatt oder Warn-Amber).
   - Neuer öffentlicher Endpunkt `GET /api/popups/public/active?surface=shop|panel` (`shop_public_rate_limit`, `get_optional_user`):
     - Filtert aktive Pop-ups mit passendem Zeitfenster und passender `audience` (`'all'` oder `surface`).
     - Bei eingeloggtem User wird zusätzlich wie gewohnt gegen `UserPopupState` (`dismissed_permanently` + 24h Snooze) gefiltert.
     - Bei nicht eingeloggtem Gast liefert der Endpunkt die priorisierten aktiven Kandidaten (`limit=5`, keine User-IDs oder internen Felder); der Browser filtert clientseitig anhand seiner gespeicherten Gast-Dismissals (`localStorage`: `msm.popup.dismissed.v1`, `{ [id]: { mode: 'snooze' | 'permanent', at: number } }`), sodass ein Gast-Wegdrücken auch bei 5 aktiven Pop-ups direkt das nächste nicht weggedrückte Pop-up oder keins mehr anzeigt.
   - `GET /api/popups/active` bleibt für bestehende Aufrufer (z. B. `DesktopApp.tsx`) voll abwärtskompatibel erhalten.
2. **Kompakte, hochwertige Karte unten rechts (`PanelPopupCard` / `PanelPopupModal` Redesign):**
   - **Gestaltung in der Design-DNA:** Schlanke Glass-Karte (`w-[min(24rem,calc(100vw-2rem))]`, `bg-surface-container-high/92 backdrop-blur-2xl border-edge shadow-2xl rounded-2xl`), kompakter Header mit Icon je `tone`, Titel, Schließen-`X` (`size="icon"`), kompaktem scrollbarem Markdown-Text (`max-h-48`), optionalem CTA-Link (sicherheitsvalidiert auf `https://`, `http://` oder relativen `/`-Pfad, keine `javascript:`-URLs) und dezenten Aktions-Buttons („Später“ / „Verstanden“ und „Nicht mehr anzeigen“).
   - **Moderne Web-Plattform-Umsetzung (gemäß `modern-web-guidance` `persistent-toast-notifications` & `motion`):**
     - Verwendet ein benanntes Landmark-Element (`role="region"` mit `aria-label="Ankündigungen"`), kein `aria-modal="true"` (da es die Seite nicht blockiert!).
     - Einstiegs- und Ausstiegs-Animation über `@starting-style` sowie separatem `transition-behavior: allow-discrete` nach `transition` (reine Compositor-Eigenschaften: `translate` von unten rechts und `opacity`), respektiert `@media (prefers-reduced-motion: no-preference)`.
     - Keine Light-Dismiss bei Klicks auf die restliche Seite (`popover="manual"` im Top-Layer mit Feature-Check bzw. sicherem Fallback für JSDOM/ältere Browser, damit die Karte auch bei Interaktion mit dem Shop-Katalog ruhig offen bleibt, bis der Nutzer sie wegdrückt).
     - Steht niemals über offenen modalen Dialogen (`[aria-modal="true"]` im DOM unterdrückt/versteckt das nicht-modale Pop-up vorübergehend, damit Fokus-Fallen sauber bleiben) und stiehlt beim Einblenden **niemals** den Fokus vom aktuellen Eingabefeld.
     - Saubere Platzierung unten rechts mit Abstand nach unten für das Support-Widget (`bottom-[5.25rem]` auf `right-4` bzw. koordiniert über CSS-Variable `--msm-unten-rechts-offset` mit `var(--msm-unten-sicher)`), damit der Support-Button darunter jederzeit frei klickbar bleibt.
3. **Admin-Oberfläche & Live-Vorschau (`PopupTab.tsx`):**
   - Neue `Dropdown`-Auswahl (kein natives `<select>`) für `Zielbereich` (`Shop & Panel`, `Nur Shop`, `Nur Panel`) und `Darstellung` (`Hinweis`, `Aktion / Angebot`, `Wartung`).
   - Klick auf „Vorschau“ rendert exakt die neue kompakte Karte unten rechts über dem Editor, sodass der Admin vor dem Veröffentlichen die echte Größe und Lesbarkeit sieht.

### Betroffene Dateien

- **Backend:** `backend/models/panel_popup.py`, `backend/schemas/popup.py`, `backend/routers/popups.py`, `backend/migrations/versions/<neu>_popup_audience_and_tone.py`
- **Frontend:**
  - `frontend/src/api/popups.ts`
  - `frontend/src/components/popups/PanelPopupModal.tsx` (Umbau auf kompakte Bottom-Right-Karte + Export `PanelPopupCard` für klare Benennung)
  - `frontend/src/shop/ShopRahmen.tsx`, `frontend/src/components/layout/Shell.tsx`, `frontend/src/desktop/DesktopApp.tsx`
  - `frontend/src/pages/settings/PopupTab.tsx`
  - `frontend/src/locales/de.json`, `frontend/src/locales/en.json`

### Stolpersteine & Invarianten

- **URL-XSS-Schutz bei `button_url`:** Vor dem Rendern und in `schemas/popup.py` (`PanelPopupCreate` / `Update`) strikt prüfen, dass `button_url` nur relative `/` oder `http://` / `https://` URLs annimmt (`javascript:` und `data:` ablehnen).
- **Keine Doppel-Anzeige beim Routenwechsel:** Beim Wechsel zwischen `/` (Shop) und `/dashboard` (Panel) wird das Dismiss-Ergebnis sauber im State synchronisiert, sodass ein soeben weggedrücktes `audience='all'`-Pop-up im Panel nicht sofort wieder aufpoppt.
- **Mobile 320px-Viewport & Android-Gestenleiste:** Breite `w-[min(24rem,calc(100vw-2rem))]` und `bottom-[calc(5.25rem+var(--msm-unten-sicher))]` halten die Karte auf Smartphones vollständig im sichtbaren Bereich.

### Tests & Laufzeit-Abnahme

- Backend (`pytest`): Filterung nach `audience` (`shop` vs. `panel` vs. `all`), Gast-Abruf ohne Auth auf `/api/popups/public/active`, DB-Dismissal für eingeloggte Nutzer, Abweisung unsicherer `button_url`-Schemas (422).
- Frontend (`vitest`): Unit-Tests für `localStorage`-Snooze/Permanent bei Gästen, Tastatur-Erreichbarkeit ohne Fokus-Raub, Unterdrückung bei offenem modalen `<Dialog>`, korrekte Vorschau in `PopupTab.test.tsx`.
- Browser-Probe: Auf `/` (unangemeldet) und `/dashboard` (angemeldet) testen, dass die Karte unten rechts animiert erscheint, den Support-Launcher nicht verdeckt, sich per „Verstanden“ / „Nicht mehr anzeigen“ / `X` schließen lässt und nach Reload weggedrückt bleibt.

### Umsetzungsstand & Erkenntnisse (Paket 3)

- **Backend-Umsetzung:**
  - `backend/models/panel_popup.py` um `audience` (`'all' | 'shop' | 'panel'`, Default `'all'`) und `tone` (`'info' | 'promo' | 'maintenance'`, Default `'info'`) samt Check-Constraints erweitert.
  - Alembic-Migration `backend/migrations/versions/20261124_03_popup_audience_and_tone.py` (`down_revision = "20261124_02"`) ergänzt; Single-Head-Prüfung `['20261124_03']` bestanden.
  - `backend/schemas/popup.py`: `POPUP_CONTENT_MAX_LENGTH = 600` für `PanelPopupCreate` und `PanelPopupUpdate` eingeführt (`PanelPopupResponse` bleibt für lesbare Altdaten ungekürzt) sowie `_validate_popup_button_url` ergänzt (erlaubt relative Pfade mit `/` ohne `//` sowie `http://` und `https://`; weist Leerzeichen, Steuerzeichen, `javascript:` und `data:` ab).
  - `backend/routers/popups.py`: Öffentlichen, rate-limitierten Endpunkt `GET /api/popups/public/active?surface=shop|panel` mit `get_optional_user` und `limit=5` ergänzt; `GET /api/popups/active` filtert abwärtskompatibel auf `surface="panel"`.
  - **KI-Pop-up-Tools & Prompt aktualisiert:** `backend/services/ai_proposals/task_proposals.py` (`_popup_set_payload`, `_ausfuehren_popup_set`), `backend/services/ai_tools/personal_tools.py` (`popups_read`, `propose_popup_set`) und `backend/services/ai_prompt.py` (`POPUPS_UND_ANKUENDIGUNGEN`) um `audience`, `tone`, Link-Prüfung sowie die 600-Zeichen-Obergrenze erweitert; die eingefrorenen SHA-256-Katalog-Snapshots in `backend/tests/test_ai_werkzeug_mengen.py` wurden entsprechend angepasst.
- **Frontend-Umsetzung:**
  - `frontend/src/api/popups.ts` um `PopupAudience`, `PopupTone`, `POPUP_CONTENT_MAX_LENGTH = 600` und `getPublicActivePopups` erweitert.
  - `frontend/src/index.css` (`.msm-popup-card` mit Compositor-Übergängen per `@starting-style`, `transition-behavior: allow-discrete` unter `prefers-reduced-motion: no-preference` und Anker-Reset `top: auto; left: auto; margin: 0;` gegen User-Agent-`[popover]`-Zentrierung).
  - `frontend/src/components/popups/PanelPopupModal.tsx` (`PanelPopupCard` / `PanelPopupModal`): Umbau vom Vollbild-Overlay auf eine kompakte Bottom-Right-Glass-Karte (`right-4 bottom-[calc(5.25rem+var(--msm-unten-sicher,0px))] z-40`), `role="region"` ohne Fokus-Raub, optionales `popover="manual"` mit Feature-Check, vorübergehende Unterdrückung bei offenem `[aria-modal="true"]` / `dialog:modal`, Queue-Fortschaltung, Client-URL-Prüfung (`sanitizePopupUrl` / `isSafePopupUrl`) und Gast-Dismissal über `localStorage` (`msm.popup.dismissed.v1`, 24h-Snooze oder dauerhaft).
  - Einbindung in `frontend/src/shop/ShopRahmen.tsx` (`surface="shop"`) und `frontend/src/components/layout/Shell.tsx` (`surface="panel"`; `BrowserApp.tsx` und `DesktopApp.tsx` nutzen den Default `surface="panel"`).
  - `frontend/src/pages/settings/PopupTab.tsx`: `@maunting/ui`-`Dropdown` für Zielbereich und Darstellung (kein natives `<select>`), `buttonUrl` auf `type="text"` für interne `/...`-Pfade umgestellt, `maxLength={600}` samt Live-Zeichenzähler (`text-on-surface-variant` / `text-status-warning` / `text-status-destructive`) und Speicherprüfung ergänzt sowie Zielbereich-/Darstellungs-Badges in der Liste ergänzt. Übersetzungen in `de.json` und `en.json` ergänzt (`en/de parity: 11328 keys`).
- **Verifikation (nach letztem Code-Edit):**
  - **Backend (`pytest` gegen PostgreSQL auf Port 15499):** `tests/test_popups.py`, `tests/test_ai_tool_registry.py`, `tests/test_ai_tool_handler_contract.py` und `tests/test_ai_werkzeug_mengen.py`: `109 passed`.
  - **Frontend (`vitest`):** `PopupTab.test.tsx`, `PanelPopupModal.test.tsx`, `ShopStart.test.tsx` und `Shell.test.tsx` (`4 test files, 28 passed`) sowie `keinNativesTitle.test.ts` (`2 passed`). Zuvor bestätigte `schreibweise.test.ts` (`6 passed | 1 failed`), dass keine neuen Verstöße zu den 4 vorbestehenden fremden `en.json`-Keys hinzukamen.
  - **Frontend-Builds:** `npm run build` (`npm run check && tsc && vite build`) und `npm run build:desktop` (`npm run check && tsc && vite build --config vite.desktop.config.ts`) jeweils mit Exit-Code `0`.
  - **Noch offen:** Die manuelle Browser-Probe auf `/` (unangemeldet) und `/dashboard` bzw. `/settings` (angemeldet, inkl. Support-Launcher-Abstand unten rechts und Live-Vorschau) steht noch aus.
- **Erkenntnisse:**
  1. **User-Agent-Styles für `[popover]`:** Browser setzen per Default `inset: 0px; margin: auto;` auf `[popover]`, wodurch eine `fixed`-Karte ohne explizites `top: auto; left: auto; margin: 0;` in der Bildschirmmitte statt unten rechts landet.
  2. **Frontend-Klassenwächter (`check-classes.mjs`):** Roh-Palettenfarben wie `amber-*` schlagen beim Build-Check fehl; für Warn-Töne (`maintenance`) und Zeichenzähler-Schwellen greifen ausschließlich semantische Tokens (`status-warning`, `status-destructive`, `primary`).
- **Ideen für Folgepakete:**
  - **Storefront-Abstimmung in Paket 5:** Die Tonalität `promo` kann auf der Startseite gezielt zeitlich begrenzte Einführungsangebote mit Direktlink auf ein Spiel (`/shop/:slug`) hervorheben.

---

## Paket 4: Integriertes News-System (`/news`, Shop-Teaser, Panel & Admin-CMS) (umgesetzt, 24.11.2026)

### Ist-Zustand & konkrete Befunde im Code

- Weder im Backend noch im Frontend von `maunting-server-manager` existiert aktuell ein News- oder Ankündigungs-Blog-System.
- In `docs/native-shop-roadmap.md` und dem gewünschten Shop-Aufbau fehlt ein redaktioneller Ort für Anbieter-Neuigkeiten, Wartungshinweise, Spiel-Updates (z. B. neues Blueprint/Mod-Update) und Shop-Aktionen, der sowohl für Besucher im Shop als auch direkt aus dem Panel erreichbar ist.

### Ziel-Zustand & Fachlogik

1. **Datenmodell (`backend/models/news_post.py` & Migration):**
   - Tabelle `news_posts`:
     - `id: int` (PK)
     - `slug: str` (`String(140)`, eindeutig, URL-sicher `^[a-z0-9-]+$`)
     - `title: str` (`String(200)`)
     - `summary: str` (`String(400)`)
     - `content_markdown: str` (`Text`)
     - `category: str` (`String(32)`: `'announcement' | 'game_update' | 'infrastructure' | 'maintenance' | 'promo'`)
     - `related_game_type: str | None` (`String(64)`, nullable, z. B. `'palworld'` zur Verlinkung aus dem News-Artikel direkt zum Server-Konfigurator)
     - `cover_image_filename: str | None` (`String(255)`, nullable: gespeichert und ausgeliefert über dieselbe sichere WebP-Sanitisierung wie `wallpaper_service` / `bild_upload`)
     - `cover_version: str | None` (`String(64)`, nullable, für `?v=`-Cache-Busting gemäß Lektion 255)
     - `is_published: bool` (Default `False`)
     - `is_pinned: bool` (Default `False`)
     - `published_at: datetime | None`
     - `author_user_id: int | None` (`ForeignKey("users.id", ondelete="SET NULL")`)
     - `created_at`, `updated_at`
   - **Privatsphäre:** Öffentliche News-Responses geben keine internen E-Mail-Adressen oder User-IDs preis (maximal ein neutraler Autoren-Anzeigename oder der Markenname des Anbieters).
2. **Berechtigungen & Backend-API (`backend/routers/news.py`, `backend/services/news_service.py`):**
   - Neues globales Recht `panel.news.manage` in `permission_catalog.py` (Admin-Built-in erhält es per Self-Heal; außerdem kompatibel mit `panel.settings.write` oder `shop.write`, falls das Team dieselbe Rolle für Shop/Content nutzt — sauber getrennt in einer Helper-Dependency `_require_news_manage`).
   - Öffentliche Routen (auch im Self-Hosted-Betrieb nutzbar, falls ein Admin News für seine Spieler-Community veröffentlicht, oder über einen optionalen Schalter `news_enabled` in den Panel-Einstellungen steuerbar, Standard `true` bei aktivem Shop):
     - `GET /api/news?category=...&game_type=...&limit=...&offset=...`: Liefert ausschließlich `is_published == True` (und `published_at <= now`), angepinnte Beiträge zuerst, dann absteigend nach `published_at`.
     - `GET /api/news/{slug}`: Einzelner veröffentlichter Beitrag (inkl. 404 bei Entwürfen für Unberechtigte).
     - `GET /api/news/{slug}/cover`: Content-versioniertes Cover-Bild (`immutable` bei `?v=`, `no-cache` sonst).
   - Admin-Routen (`_require_news_manage`, CSRF, Audit-Log):
     - `GET /api/news/admin/list`, `POST /api/news/admin`, `PUT /api/news/admin/{id}`, `DELETE /api/news/admin/{id}`
     - `POST /api/news/admin/{id}/cover` (Upload via `wallpaper_service.sanitize_and_compress_wallpaper`), `DELETE /api/news/admin/{id}/cover`
3. **Frontend-Integration überall erreichbar:**
   - **Öffentliche Routen in `App.tsx`:**
     - `/news` (`NewsOverview.tsx`) und `/news/:slug` (`NewsDetail.tsx`).
     - Wichtig für **alle Betriebsmodi**: Wenn `shop_enabled = true`, laufen `/news` und `/news/:slug` im `ShopRahmen.tsx` (öffentliche Storefront-Navigation). Ist `shop_enabled = false` (rein Self-Hosted), sind `/news` und `/news/:slug` für angemeldete Panel-Mitglieder trotzdem innerhalb von `Shell.tsx` (oder einer passenden Hülle) erreichbar, sobald es veröffentlichte Beiträge gibt oder der Betreiber News nutzt! So bleiben Wartungs- und Update-News auch für Self-Hosted-Communities nutzbar.
   - **Einstiegspunkte:**
     - Link „Neuigkeiten“ in `ShopKopf.tsx` und im Shop-Footer.
     - Magazin-Sektion (aktuelle 3 Beiträge) auf `ShopStart.tsx`.
     - Kontext-Hinweis „Passende Spiel-News“ auf `ShopSpiel.tsx`, wenn für dieses `game_type` veröffentlichte News vorliegen.
     - Kompakter News-Link im Profil-/Hilfe- bzw. Topbar-Bereich von `Shell.tsx` (ohne die mittlere Haupt-Tabbar zu überladen; z. B. im User-Menü und im mobilen `Blattmenue` sowie als optionaler Link vom Dashboard aus, sobald mindestens 1 veröffentlichter Beitrag existiert).
   - **Admin-Verwaltung (`frontend/src/pages/settings/NewsTab.tsx`):**
     - Hochwertiges Editorial-CMS unter **Einstellungen → Neuigkeiten** (bzw. direkt verlinkt aus Shop-Einstellungen): Liste aller Entwürfe/Beiträge, Kategorie-`Dropdown`, optionales Spiel-`Dropdown` (`related_game_type`), automatische Slug-Erzeugung mit Editiermöglichkeit, strukturierter Artikel-Editor mit Live-Vorschau (`AiMarkdown`), Quellen-/Link-Angaben und Cover-Bildupload (deutlich reifer als der kompakte Pop-up-Editor).
   - **Singularity-KI-Tools, Aufgaben-Automatisierung & Welt-/Branchen-News-Kuration:**
     - Eigene KI-Werkzeuge (`news_read` zum Lesen vorhandener Entwürfe/Beiträge und `propose_news_upsert` zum Vorschlagen neuer Beiträge oder Updates über das Freigabe-System), nutzbar sowohl direkt im Chat als auch geplant über das KI-Aufgabensystem (`ai_task_service`).
     - Für Betreiber und kleine Teams entsteht ein KI-gestützter Kuratierungs-Workflow für relevante Spiele-, Tech- und Welt-Neuigkeiten (über die vorhandene Websuche/Web-Lese-Tools werden reale Quellen ausgewertet und als Entwurf zur menschlichen Freigabe vorgeschlagen, niemals mit erfundenen Quellen oder Blindveröffentlichung ohne Review).

### Betroffene Dateien

- **Backend:** `backend/models/news_post.py`, `backend/schemas/news.py`, `backend/services/news_service.py`, `backend/routers/news.py`, `backend/main.py` (Router-Einbindung), `backend/services/permission_catalog.py`, `backend/migrations/versions/<neu>_news_posts.py`
- **Frontend:**
  - `frontend/src/api/news.ts`
  - `frontend/src/pages/NewsOverview.tsx`, `frontend/src/pages/NewsDetail.tsx`
  - `frontend/src/pages/settings/NewsTab.tsx`, `frontend/src/pages/Settings.tsx`
  - `frontend/src/App.tsx`, `frontend/src/shop/ShopKopf.tsx`, `frontend/src/shop/ShopRahmen.tsx`, `frontend/src/components/layout/Topbar.tsx`
  - `frontend/src/locales/de.json`, `frontend/src/locales/en.json`

### Stolpersteine & Invarianten

- **Markdown-Sicherheit:** `AiMarkdown` darf niemals rohes HTML ausführen (XSS-Schutz bleibt aktiv); Cover-Uploads laufen ausschließlich über die bestehende Bild-Sanitisierung (`sanitize_and_compress_wallpaper`), niemals rohes Durchreichen von SVGs oder fremden Dateiendungen.
- **Entwürfe strikt schützen:** Unveröffentlichte Beiträge (`is_published = false` oder zukünftiges `published_at`) dürfen in öffentlichen Endpunkten niemals zurückgegeben werden (`404`).
- **Kein totes Menü im Self-Hosted-Betrieb:** Ein reines Self-Hosted-Panel ohne einen einzigen News-Beitrag zeigt Kunden/Mitspielern keinen leeren „News“-Button in der Topbar an; erst wenn `newsCount > 0` oder `canManageNews` gilt, erscheint der direkte Einstieg im Panel.

### Tests & Laufzeit-Abnahme

- Backend (`pytest`): CRUD inkl. Slug-Kollisionsbehandlung, Entwürfe für Anonyme unsichtbar (`404`), Kategorie-/GameType-Filterung, Cover-Upload/Validierung & Pfadsicherheit, RBAC-Block ohne `panel.news.manage`.
- Frontend (`vitest`): `NewsOverview`, `NewsDetail` (inkl. CTA zum verknüpften Shop-Spiel), `NewsTab` Admin-Editor.
- Browser-Probe: Beitrag im Admin erstellen + Bild hochladen + veröffentlichen -> auf `/news`, `/news/:slug`, von `/` und vom `/dashboard` aus aufrufen -> Konsole sauber.

### Umsetzungsstand & Erkenntnisse (Paket 4)

- **Backend umgesetzt:** `NewsPost`-Modell (`backend/models/news_post.py`, exportiert in `backend/models/__init__.py`), idempotente Migration `20261124_05_news_posts.py` (Single-Head `20261124_05` auf Parent `20261124_04`), globales Recht `panel.news.manage` in `backend/services/permission_catalog.py`, Schemas (`backend/schemas/news.py`), Service (`backend/services/news_service.py` mit Cover-Verarbeitung über `wallpaper_service.sanitize_and_compress_wallpaper` plus `resolve_scoped_dir` in `config.news_covers_dir` sowie strenger HTTPS-Quellenprüfung bis maximal 10 Quellen) und Router (`backend/routers/news.py`, Admin-CRUD + Cover-Upload mit RBAC & CSRF sowie öffentliche Endpunkte `/api/news`, `/api/news/summary`, `/api/news/{slug}`, `/api/news/{slug}/cover` inkl. ETag/304).
- **Singularity-KI umgesetzt:** Neue Werkzeuge `news_read` und `propose_news_upsert` (`backend/services/ai_tools/personal_tools.py`), Berechtigungs- und Ausführungslogik in `backend/services/ai_proposals/base.py` und `task_proposals.py` (`always_confirm: true` beim Veröffentlichen, während KI-Aufgaben Entwürfe mit `is_published: false` und geprüften HTTPS-Quellen direkt anlegen können), Redaktions-Prompt `NEWS_REDAKTION` in `backend/services/ai_prompt.py` sowie Aufnahme in `CHAT_INTERACTION_TOOLS`, `AUFGABEN_LESEN` und `AUFGABEN_HANDELN` (`backend/services/ai_tool_registry.py`), plus Frontend-Anbindung in `frontend/src/api/ai.ts`, `frontend/src/components/ai/AiActionProposalCard.tsx` und `frontend/src/features/permissions/PermissionEditor.tsx`.
- **Frontend umgesetzt:** `frontend/src/api/news.ts`, öffentliche News-Routen `/news` und `/news/:slug` über `NewsWeiche.tsx` (Panel-Rahmen bei Anmeldung oder Shop-Rahmen für Gäste), `NewsOverview.tsx` (Kategorie-/Suchfilter, angepinnter Lead-Artikel, Karten-Grid, Quellenhinweise), `NewsDetail.tsx` (Markdown-Ansicht, Quellenliste, Spiel-CTA), Editorial-CMS `NewsTab.tsx` unter Einstellungen (`Settings.tsx?tab=news`), bedingter `/news`-Menüeintrag in `Topbar.tsx`, `/news`-Links in `ShopKopf.tsx` und `ShopRahmen.tsx`, passende Spiel-News in `ShopSpiel.tsx` sowie DE/EN-Übersetzungen in `frontend/src/locales/{de,en}.json`.
- **Verifizierte Tests & Builds:**
  - Backend (`pytest` gegen WSL2-PostgreSQL über `tests/test_news.py`, `tests/test_ai_tool_registry.py`, `tests/test_ai_werkzeug_mengen.py`, `tests/test_ai_tool_handler_contract.py`, `tests/test_ai_tool_drift.py`, `tests/test_permission_catalog_ui_contract.py`): `120 passed, 1 failed`. `tests/test_news.py` (`5 passed`) sowie alle 4 KI-Vertragstests (`109` Tests) bestanden; der einzige Fehler in `test_permission_catalog_ui_contract.py::test_every_permission_key_is_assigned_to_a_group` betrifft ausschließlich das bereits vorab bestehende fremde Recht `ai.projects.preview` (`panel.news.manage` ist zugeordnet).
  - Frontend (`vitest` nach finalen UI-Typkorrekturen über `NewsOverview.test.tsx`, `NewsDetail.test.tsx`, `NewsTab.test.tsx`, `ShopSpiel.test.tsx`, `keinNativesTitle.test.ts`): `5` Testdateien, `15 passed`.
  - `src/locales/schreibweise.test.ts`: `6 passed | 1 failed` (`en: kein Title Case in mehrwortigen Beschriftungen`) ausschließlich wegen 4 bereits vorab bestehender fremder Keys (`serverVariables.dateiTabOeffnen`, `settings.shop.betrieb.betreiberAnsichtBadge`, `shop.konto.rechnungen.kontextBadge`, `hoster.products.openShopSettings`), ohne Verstöße in Paket 4.
  - Produktions-Builds nach finaler Korrektur: `npm run build` (`3727` Module) und `npm run build:desktop` (`3706` Module) jeweils inkl. `npm run check` (`en/de parity: 11500 keys`, `classes: 56 msm-*, 12 animate-*`, `check-leere-catches: 278 <= 279`) mit Exit-Code `0`.
- **Offene Punkte & Stolpersteine:**
  - *CSRF-Cookie-Name in Tests:* Login setzt `__Secure-csrf_token` (nicht `msm_csrf`).
  - *UI-Prop-Verträge:* `@maunting/ui` nutzt `Zustandsflaeche` (`art`, `titel`, `text`, `icon`), `Switch` (`onCheckedChange`), `Spinner` ohne `label`-Prop sowie `Badge` mit `default`/`destructive` statt `neutral`/`error`; Destructive-Utility-Klassen heißen `status-destructive` statt `status-error`.
  - *Offen:* Einbindung des `ShopNewsTeaser`-Blocks (`#shop-news`) auf der Shop-Startseite im Rahmen des anstehenden Paket-5-UI-Reworks sowie die manuelle Browser-Probe (Artikel + Cover-Upload im Admin und Prüfung auf `/news`, `/news/:slug`, `/` und `/dashboard` inkl. Browser-Konsole).

---

## Paket 5: Shop-Storefront, Katalog, Trustpilot-Option & Konfigurator 2.0 (umgesetzt, 24.11.2026)

### Ist-Zustand & konkrete Befunde im Code

1. **`ShopStart.tsx` (1094 Zeilen) wirkt gleichförmig und teils unaufgeräumt:**
   - Die Hero-Seitenkarte (Zeile 358–482) listet 5 Spiele statisch untereinander; beim Umschalten wechselt das Bild abrupt ohne weichen Übergang, ohne Pause-Steuerung und ohne echte Slide-Dramaturgie.
   - Es gibt keine kuratierten Katalog-Schienen (*Meistgemietet*, *Empfohlen*, *Neu*), sondern nur einen einzigen langen Block aller Spiele.
   - Die drei bereits oben genannten Füll-Blöcke (`katalogBand`, `shortcuts`, `abschluss`) strecken die Seite ohne echten Mehrwert.
   - Die Navigation in `ShopKopf.tsx` (Zeile 91–103) enthält nur 2 Ankerlinks (`Spiele`, `Add-ons`); Standorte, Neuigkeiten, Support und Sprachumschalter fehlen.
   - `ShopRahmen.tsx` (Zeile 39–58) hat nur einen schmalen 1-Zeilen-Footer.
2. **Fehlende Katalog-Kuratierung an `ShopPlan`:**
   - `backend/models/shop.py` (`ShopPlan`) hat zwar `sort_order` und `active`, aber keine Flags für die Shop-Kuratierung (`is_featured`, `is_bestseller`, `is_new`), die sowohl manuell im Admin-Editor gesetzt als auch um echte Bestseller-Metriken ergänzt werden können.
3. **Trustpilot & Community-Links ohne echte Konfigurierbarkeit:**
   - Der Betreiber braucht eine echte, ehrliche Möglichkeit, ein eigenes Trustpilot-Profil und/oder einen Community-Discord zu hinterlegen, ohne dass für Open-Source-Installationen ohne Account irgendwelche Fake-Bewertungen angezeigt werden.

### Ziel-Zustand & Fachlogik

1. **Katalog-Kuratierung im Backend (`ShopPlan` & `/api/shop/catalog`):**
   - `ShopPlan` (und `ShopPlanWrite` / `ShopPlanUpdate` / `ShopCatalogPlan`) wird um `is_featured: bool` (Default `False`), `is_bestseller: bool` (Default `False`) und `is_new: bool` (Default `False`) erweitert.
   - In `shop_catalog_service.list_catalog`: Für jedes aktive Spiel aggregiert der Katalog zusätzlich echte bezahlte Bestellzahlen der letzten 90 Tage (falls ≥ 1 echte Bestellung existiert), sodass *Meistgemietet* entweder manuell über `is_bestseller` oder datenbasiert sortiert wird (ohne künstliche Zahlen zu erfinden!).
   - Im Admin-Editor `ShopPlansEditor.tsx` erscheinen die drei Schalter sauber im Basis-Reiter (`Switch`).
2. **Optionale Trustpilot- & Community-Einstellungen (`Einstellungen → Shop`):**
   - Neue Konfigurationsfelder in `shop_lifecycle_settings_service.py` (bzw. Shop-Einstellungen) und `ShopPublicPolicyResponse`:
     - `shop_trustpilot_enabled: bool` (Default `False`)
     - `shop_trustpilot_url: str` (streng validiert: ausschließlich `https://` mit Host `trustpilot.com` oder `*.trustpilot.com` und Pfad `/review/...`)
     - `shop_trustpilot_mode: Literal['link_card', 'trustbox']` (Default `'link_card'`: klickbare, trackingfreie Karte mit Link zur echten Trustpilot-Seite; optional `'trustbox'` für das offizielle Widget nur nach Einwilligung bzw. Datenschutzerklärung, inkl. neuer Spalten `shop_trustpilot_template_id`, `shop_trustpilot_business_unit_id`)
     - `shop_discord_invite_url: str` (streng validiert auf `https://discord.gg/...` oder `https://discord.com/invite/...`)
   - **CSP- & Datenschutz-Regel:** Wird `trustbox` unterstützt, müssen `https://widget.trustpilot.com` in `frontend/vite.csp.ts`, `backend/main.py` (`security_headers_middleware`), `install.sh` und `Caddyfile.template` synchron aufgenommen werden (erzwungen durch `test_caddy_csp_und_gebaute_csp_sind_dieselbe`), und die Einbettung wird im Browser erst geladen, wenn der Nutzer sie über den bestehenden `ThirdPartyPrivacyDialog` freigibt (oder im sicheren `link_card`-Modus ganz ohne Drittanbieter-Skript).
   - **Wenn `shop_trustpilot_enabled = false`:** Keinerlei Trustpilot-Sterne, keine erfundenen Bewertungszahlen, stattdessen eine ehrliche Live-Faktenleiste (Online-Standorte, gemessener Browser-Ping, Prepaid-Fairness, DDoS/Backups).
3. **Storefront 2.0 Architektur & Seitenfluss (`ShopKopf`, `ShopStart`, `ShopRahmen`):**
   - **Kopfnavigation (`ShopKopf.tsx`):**
     - Markenlogo + Brandname links; klare Navigation: *Spiele* (`/#shop-spiele`), *Standorte* (`/#shop-standorte`), *Add-ons* (`/#shop-addons`), *Neuigkeiten* (`/news`), *Support* (Button öffnet Support-Widget über `openSupportWidget()`, falls aktiviert).
     - Rechts: Sprachwechsler (`LanguageSwitcher`), für Eingeloggte *Panel/Dashboard* + `ProfileDropdown`, für Gäste *Registrieren* + *Anmelden*. Sauberes mobiles Slide-Menü (`Blattmenue`).
   - **1. Hero-Stage (Top-5-Server mit Slide-out & Live-Wechsel):**
     - Zeigt bis zu 5 kuratierte Spiele (`is_featured` zuerst, Fallback auf verfügbare Spiele mit Artwork).
     - Großes, ruhiges Hintergrundbild mit weichem Opacity-Crossfade und Ambient-Cyan/Ink-Verlauf.
     - Links: Prägnanter Einstieg, aktuelles Fokus-Spiel mit Plattform-Badges, Preis *ab X,XX € / Monat*, Primär-CTA „Server konfigurieren“ und Sekundär-CTA „Alle Spiele ansehen“.
     - Rechts/Unten: Kompakte Slide-out-Liste der Top 5 mit Thumbnail, Preis/Rabatt-Badge, aktivem Fortschrittsbalken, Tastatur-Navigation und Pause/Play-Steuerung (WCAG 2.2.2).
   - **2. Vertrauens- & Live-Status-Streifen (+ optional Trustpilot / Discord):**
     - Kompakt statt überladen: zeigt echte Live-Zahlen (wie viele Rechenzentren online sind, besten gemessenen Ping nach Test, „Prepaid ohne automatische Verlängerung“, „Pre-Update-Backups inklusive“), plus optional die echte Trustpilot-Karte/TrustBox und Community-Discord.
   - **3. Kuratierte Katalog-Schienen + Interaktiver Vollkatalog (`#shop-spiele`):**
     - Horizontale, wischbare Snap-Schienen (nur gerendert, wenn mindestens 2 passende Spiele vorliegen): *Meistgemietet*, *Empfohlen*, *Neu im Katalog*.
     - Darunter der schnelle Katalog-Filter (Echtzeit-Suche, Plattform-Pills `Alle | PC | PS5 | Xbox | Crossplay`, Merkmal-Filter `Alle | Sofort verfügbar | Mit Mods/Workshop`) und das überarbeitete `SpielKarte`-Grid (schlankere Karten mit Plattform-Tags, kurzem Hardware-/DDoS-Signal, flüssigem Hover-Lift und sichtbaren Aktionen auch auf Touch-Geräten ohne Hover).
   - **4. Interaktives Rechenzentrums- & Live-Ping-Deck (`#shop-standorte`):**
     - „Ping testen“ misst parallel alle öffentlichen Shop-Nodes mit sichtbarem Laufzeit-Fortschritt und visuellem Latenz-Balken (`ms` in `tabular-nums`, Qualitätseinstufung grün/amber/rot).
     - Jede Node-Karte zeigt Standort, Auslastung, RAM-/NVMe-Specs, DDoS-Profil, optionales CPU-Modell (wenn `shop_show_cpu=true`), optionalen Standort-Aufpreis (`Standortwahl inklusive` vs. `+X,XX €/Monat`) und einen direkten **„Standort wählen“**-Button, der den Standort im `shopStandortStore` markiert und optional direkt nach `#shop-spiele` oder `/shop/:spielId` führt.
   - **5. Add-ons & Ökosystem-Pakete (`#shop-addons`):**
     - Klare Darstellung von KI-Kontingent-Paketen, Speicher-/Backup-Erweiterungen und Rollen-Upgrades mit direkter Angabe, welche Panel-Module (z. B. Singularity KI-Chat, Kalender, Notizen, Dokumente) damit im Konto freigeschaltet werden!
   - **6. Aktuelle Neuigkeiten (`#shop-news`, aus Paket 4):**
     - Die 3 neuesten veröffentlichten Artikel (Spiele-Updates, Wartungen, Infrastruktur) mit Direktlink zu `/news`.
   - **7. Strukturierter Multi-Spalten-Footer (`ShopRahmen.tsx`):**
     - Spalten für *Produkte*, *Plattform & Neuigkeiten*, *Rechtliches & Support* (inkl. `/privacy`, konfigurierbarem Impressum `imprint_url`, Support-Trigger und ehrlicher MSM-Herkunftszeile).
4. **Spiel-Detailseite, Konfigurator & Checkout 2.0 (`ShopSpiel.tsx`, `Konfigurator.tsx`, `PreisPanel.tsx`, `ShopKasse.tsx`):**
   - `ShopSpiel.tsx` erhält ein atmosphärisches Banner aus der `SpielGalerie` mit Plattform-Badges, Kurz-Specs und (falls vorhanden) einem Link zum letzten Spiel-News-Beitrag.
   - `Konfigurator.tsx` ersetzt bloße Dropdown-Reihen durch klar gegliederte Konfigurations-Schritte:
     1. **Standort & Hardware-Klasse** (Karten-Auswahl: *Automatisch bester freier Standort* + alle `shop_enabled`-Nodes mit Live-Ping, Live-Verfügbarkeitsprüfung für aktuelle RAM/CPU-Wahl, optionalem CPU-Modell und optionalem Aufpreis).
     2. **Leistung & Spieler-Slots** (Komfortable Stufen-Auswahl bzw. `Slider`/Schnellwahl-Chips + präzises `Dropdown` aus `@maunting/ui` für große Spannen, kombiniert mit ehrlicher Spieler-Empfehlung).
     3. **Abrechnungsmodell & Laufzeit** (`Prepaid` als fairer Standard, `Abo` mit konfigurierbarem Rabatt, optional `Lifetime`, Laufzeit `1 / 3 / 12 Monate`).
     4. **Inklusive-Garantien** (DDoS-Schutz, Pre-Update-Backups, Game-Switch, SFTP, Konsole).
   - `PreisPanel.tsx` & `ShopKasse.tsx` bleiben visuell ruhig, zeigen jeden Einzelposten (inkl. gewähltem Standort & eventuellem Standort-Aufpreis) sauber aufgeschlüsselt und merken sich die gewählte Node durch den Checkout.

### Betroffene Dateien

- **Backend:** `backend/models/shop.py`, `backend/schemas/shop.py`, `backend/services/shop_catalog_service.py`, `backend/services/shop_lifecycle_settings_service.py`, `backend/main.py`, `backend/migrations/versions/<neu>_shop_plan_curation_and_trust.py`, `install.sh`, `Caddyfile.template`
- **Frontend:**
  - `frontend/vite.csp.ts`
  - `frontend/src/api/shop.ts`, `frontend/src/pages/settings/ShopPlansEditor.tsx`, `frontend/src/pages/settings/ShopLifecycleKarte.tsx` (oder neuer `ShopTrustKarte.tsx` in `ShopTab.tsx`)
  - `frontend/src/shop/ShopRahmen.tsx`, `frontend/src/shop/ShopKopf.tsx`, `frontend/src/shop/pages/ShopStart.tsx`, `frontend/src/shop/pages/ShopSpiel.tsx`, `frontend/src/shop/pages/ShopKasse.tsx`
  - `frontend/src/shop/components/SpielKarte.tsx`, `frontend/src/shop/components/Konfigurator.tsx`, `frontend/src/shop/components/PreisPanel.tsx`, neue modulare Komponenten (`HeroShowcase.tsx`, `StandortPingDeck.tsx`, `KatalogSchiene.tsx`, `TrustSection.tsx`, `ShopNewsTeaser.tsx`)
  - `frontend/src/locales/de.json`, `frontend/src/locales/en.json`
- **Design-DNA (`E:\Github-Projekte\maunting-design-dna` + `frontend/packages/maunting-ui`):**
  - Ergänzung bzw. Abgleich von `tokens.css` / `tokens.ts` und UI-Motion-Klassen für Top-Layer-Popovers, View-Timeline-Reveals und Snap-Schienen.

### Stolpersteine & Invarianten

- **CSP-Paritätstest (`test_caddy_csp_und_gebaute_csp_sind_dieselbe`):** Jede Änderung an `frontend/vite.csp.ts` (z. B. für optionales Trustpilot-TrustBox-Iframe) muss exakt wortgleich in `install.sh` und `Caddyfile.template` nachgezogen werden, sonst schlägt die Backend-Testsuite sofort fehl.
- **Keine nativen `<select>`-Elemente:** Alle neuen Filter oder Auswahlen nutzen `@maunting/ui` `Dropdown`, `Button`, `Switch` oder zugängliche `aria-pressed`-Radiogruppen.
- **Kein Horizontal-Overflow bei Scroll-Reveals oder Carousels:** `ShopStart` darf auf 320px/375px-Handys kein seitliches Scrollen der gesamten Seite erzeugen; nur die `.carousel-track`-Schienen scrollen horizontal mit `overscroll-behavior-x: contain`.
- **Defer-Rendering & LCP (`ShopStart`):** Das Hero-Fokusbild trägt `fetchpriority="high"` und feste `width`/`height`-Attribute; unterhalb liegende Bilder bleiben `loading="lazy"`.

### Tests & Laufzeit-Abnahme

- Backend (`pytest`): `test_caddy_csp_und_gebaute_csp_sind_dieselbe`, Katalog-Flags (`is_featured`, `is_bestseller`, `is_new`), strikte Trustpilot-/Discord-URL-Validierung (422 bei Phishing-/HTTP-URLs).
- Frontend (`vitest`): Tests für `HeroShowcase` (Pause/Play ohne doppeltes `aria-pressed`, Slide-Wechsel), `StandortPingDeck` (Auswahl + Status), `KatalogSchiene` (Tastatur/Next/Prev), `Konfigurator` (Standort + Aufpreis), `TrustSection` (ausgeblendet bei deaktiviertem Trustpilot, Tracking-Schutz bei `trustbox`).
- Browser-Probe: Desktop (1440px) und Mobil (375px) auf `/`, `/shop/:id`, `/shop/:id/kasse`, `/news` prüfen, Animations-Verhalten mit und ohne `prefers-reduced-motion` testen, Konsole prüfen.

### Umsetzungsstand & Erkenntnisse (Paket 5)

- **Backend umgesetzt (bereits in Commit `2166a096` enthalten):** `ShopPlan` (`backend/models/shop.py`) und die Schemas in `backend/schemas/shop.py` um `is_featured`, `is_bestseller` und `is_new` erweitert (Migration `20261124_04_shop_plan_curation.py`). `backend/services/shop_catalog_service.py` und `backend/routers/shop.py` liefern echte bezahlte Bestellzahlen der letzten 90 Tage als `recent_order_count`; `backend/services/shop_lifecycle_settings_service.py` ergänzt `shop_trustpilot_enabled`, `shop_trustpilot_url` (HTTPS auf `trustpilot.com` bzw. `*.trustpilot.com` mit `/review/<slug>`) sowie `shop_discord_invite_url` (`discord.gg/<code>` oder `discord.com/invite/<code>`).
- **Bewusste Entscheidung bei Trustpilot:** Vorerst ist ausschließlich die trackingfreie `link_card`-Variante ohne externes TrustBox-Skript umgesetzt, sodass `frontend/vite.csp.ts`, `backend/main.py`, `install.sh` und `Caddyfile.template` unberührt bleiben.
- **Frontend-UI-Rework umgesetzt (noch uncommittet):**
  - **Entschlackter Header (`ShopKopf.tsx`):** `LanguageSwitcher` und `Support`-Button vollständig entfernt; bei eingeloggten Nutzern stehen rechts nur `Dashboard` und `ProfileDropdown`.
  - **Vollbild-Hero (`HeroShowcase.tsx`):** Große Bühne (`min-h-[540px]` bzw. `lg:min-h-[620px]`) ohne rechte Statusbox, `fetchpriority="high"` ohne `loading="lazy"` am Hauptmotiv, 2 klare CTAs (`Konfigurieren` + `Spiele entdecken`), leuchtende Game-Aware-DDoS-Schutz-Pill (`.msm-shop-ddos-pill`) samt echtem Anbieternamen sowie breites 5er-Dock am unteren Rand mit animierter Fortschrittsleiste (`.msm-shop-hero-progress`) und Pause/Play ohne `aria-pressed`.
  - **DDoS-Spotlight & Live-Telemetrie (`TrustSection.tsx`, `StandortPingDeck.tsx`, `SpielKarte.tsx`):** Hervorgehobener `.msm-shop-ddos-glow`-Spotlight-Banner mit konfigurierten Anbietern/Profilen; neu gestaltete Node-Karten mit Statuspunkt, visuellem RAM-/Auslastungsbalken (`ram_free_percent`), animierter Latenzleiste, DDoS-Anbieter-Pill und Standort-Auswahl.
  - **Scroll-Reveals, Carousel & News-Teaser (`index.css`, `useShopReveal.ts`, `KatalogSchiene.tsx`, `ShopNewsTeaser.tsx`, `ShopStart.tsx`):** Scroll-Animationen nativ über `@supports ((animation-timeline: view()) and (animation-range: entry))` (`.msm-shop-reveal`) mit `IntersectionObserver`-Fallback (`useShopReveal`), `overscroll-behavior-x: contain` und barrierefreier Carousel-Region in `KatalogSchiene.tsx`, Integration von `#shop-news` über `ShopNewsTeaser.tsx` sowie Ausblenden der Add-ons-Sektion bei leerer Add-on-Liste.
- **Feinschliff umgesetzt (24.11.2026, uncommittet):**
  - **Geplante KI-Aufträge unter Tools (`Ai.tsx`, `SingraToolsView.tsx`, `AiRunNotice.tsx`, `NewsTab.tsx`):** Vollbild-Modus `ansicht=aufgaben` entfernt; Aufträge leben einheitlich unter `?bereich=tools&tool=tasks` (beschriftet mit `Geplante Aufträge`, geschützt über `ai.tasks.manage`). Alte Links auf `?ansicht=aufgaben` bzw. `onSwitchMode('aufgaben')` leiten automatisch dorthin um.
  - **Gemeinsamer Markdown-Editor (`MarkdownFormatLeiste.tsx`, `PopupTab.tsx`, `NewsTab.tsx`):** Beide Editoren nutzen dieselbe Formatleiste mit `Kurzinfo`-Tooltips und `Schreiben`/`Live-Vorschau`-Umschaltung; `PopupTab` zeigt eine Corner-Toast-Vorschau samt separatem `Pop-up testen`-Button, `NewsTab` eine Artikel-Live-Vorschau inkl. Cover, Kategorien, Markdown und Quellen.
  - **Shop-Header & Katalog-Bereinigung (`ShopKopf.tsx`, `ShopStart.tsx`):** Floating-Glass-Nav-Pill im Desktop-Header samt mobilem Menü-Toggle (`aria-expanded`); die drei gestapelten `KatalogSchiene`-Bänder oberhalb von `#shop-spiele` wurden entfernt und als kompakte Kurationsfilter (`Meistgemietet`, `Empfohlen`, `Neu`) in `#shop-spiele` zusammengeführt (`HeroShowcase -> TrustSection -> #shop-spiele -> StandortPingDeck -> ShopNewsTeaser -> #shop-addons`).
- **Verifizierte Tests & Builds (nach letztem Feinschliff-Edit):**
  - Frontend (`vitest` über `ShopStart.test.tsx`, `ShopSpiel.test.tsx`, `PopupTab.test.tsx`, `NewsTab.test.tsx`, `NewsOverview.test.tsx`, `NewsDetail.test.tsx`, `Ai.test.tsx`, `AufgabenAnsicht.test.tsx`, `keinNativesTitle.test.ts`): `9` Testdateien, `46 passed`.
  - `src/locales/schreibweise.test.ts`: `6 passed | 1 failed` (`en: kein Title Case in mehrwortigen Beschriftungen`) ausschließlich bei 4 bereits zuvor vorhandenen fremden Keys (`serverVariables.dateiTabOeffnen`, `settings.shop.betrieb.betreiberAnsichtBadge`, `shop.konto.rechnungen.kontextBadge`, `hoster.products.openShopSettings`), `0` Verstöße in neuen Keys.
  - Produktions-Builds: `npm run build` (`3729` Module) und `npm run build:desktop` (`3707` Module) jeweils inkl. `npm run check` (`en/de parity: 11516 keys`, `classes: 61 msm-*, 12 animate-*`, `check-leere-catches: 278 <= 279`) mit Exit-Code `0`.
- **Offen:** Manuelle Browser-Probe (Desktop `1440px` und Mobil `375px` auf `/`, `/shop/:id`, `/shop/:id/kasse`, `/news`, Verhalten mit und ohne `prefers-reduced-motion`, Konsole prüfen) vor oder nach Sichtprüfung durch den Nutzer.

---

## Paket 6: Konto- & Abo-Zentrale 2.0 (`/konto` & `/profile` aus einem Guss)

### Ist-Zustand & konkrete Befunde im Code

1. **Doppelte UI-Verschachtelung in `KontoProfil.tsx`:**
   - `frontend/src/shop/pages/konto/KontoProfil.tsx` besteht aus 5 Zeilen und rendert `<Profile />` direkt innerhalb von `<KontoRahmen />`.
   - Ergebnis: Oben steht der große `KontoRahmen`-Header mit Avatar, E-Mail und 5 Konto-Tabs (*Bestellungen · Rechnungen · Zahlungsmethoden · Abos · Profil & Sicherheit*). Darunter rendert `Profile.tsx` ein komplettes `SettingsLayout` mit *zweiter* Seiten-Überschrift („Einstellungen“) und *zweiter* Seitennavigation (*Profil · Konto · Sicherheit · Verknüpfungen · Audio · Gefahr*).
2. **Starrer Konto-Rahmen bei Self-Hosted vs. Shop:**
   - `Profile.tsx` (Zeile 39–48) blendet bereits KI bei `!canUseAi` und Social bei `!social` aus, sollte aber auch `audio` sauber an `canUseAi || canUseMessenger` knüpfen und im `KontoRahmen` nicht doppelt verpackt sein.
   - `KontoAbos.tsx` (670 Zeilen) packt komplexe Kündigungs-Radios, Bestätigungseingaben (`confirmServerName`), Pause/Resume, Welt-Backup-Downloads und sofortige Serverlöschung dicht als aufklappende Inline-Kästen direkt in jede Abo-Karte. Das wirkt technisch roh und unruhig.
   - `KontoBestellungen.tsx` und `KontoRechnungen.tsx` sind funktional, aber optisch einfache Listen ohne klare visuelle Status-Führung oder Suche/Filter bei mehreren Belegen.

### Ziel-Zustand & Fachlogik

1. **Einheitliche Konto-Zentrale ohne doppelte Rahmen (`KontoRahmen.tsx` + `Profile.tsx`):**
   - `KontoProfil.tsx` entfällt als doppelte Schachtelung oder übergibt `<Profile eingebettet />`, sodass **entweder**:
     - `/konto/*` und `/profile` eine saubere gemeinsame Sektionsteilung nutzen (oben ein einziger Header mit Avatar, Konto-Status und Rücksprung ins Panel/Shop; links/oben eine flache Navigation mit *Übersicht & Abos · Bestellungen · Rechnungen · Zahlungsmethoden · Profil · Sicherheit · Verknüpfungen · Audio & KI (nach Recht) · Gefahrenzone*).
     - Im reinen Self-Hosted-Betrieb (`shop_enabled = false` und keine vorhandenen Bestellungen/Abos/Rechnungen des Nutzers) werden die leeren Shop-Tabs (*Bestellungen · Rechnungen · Zahlungsmethoden · Abos*) ausgeblendet; sobald `shop_enabled = true` ist oder der Nutzer mindestens einen Vertrag/Beleg besitzt, bleiben sie erreichbar.
2. **Aufwertung von `KontoAbos.tsx`, `KontoBestellungen.tsx` und `KontoRechnungen.tsx`:**
   - **`KontoAbos.tsx`:**
     - Kompakte Vertrags-Karten mit Server-Status-Indikator, aktuellem Tarif/Standort, nächstem Abrechnungsdatum bzw. Restlaufzeit, und klar getrennten Aktions-Gruppen (Primär: *Server öffnen*, *Verlängern*, *Spiel wechseln*, *Pausieren/Fortsetzen*; Sekundär über `ActionMenu` / `Dialog`: *Welt-Backups herunterladen*, *Kündigen / Sofort löschen*).
     - Der Kündigungs- und Löschvorgang wandert aus den gequetschten Inline-Formularen in einen klaren, geführten `Dialog` (`@maunting/ui`), inkl. gut lesbarer Warnhinweise und Servernamen-Bestätigung.
   - **`KontoBestellungen.tsx` & `KontoBestellungDetail.tsx`:**
     - Übersichtliche Bestellkarten mit Status-Timeline, gewähltem Standort/Hardware-Aufpreis, Rabatt-Angabe und direktem Link zur zugehörigen Rechnung und zum bereitgestellten Server.
   - **`KontoRechnungen.tsx`:**
     - Jahr-/Typ-Filter (*Alle · Rechnungen · Gutschriften*), übersichtliche Download-Buttons (PDF/A-3 / XRechnung-XML) und deutliche Unterscheidung zu Admin-Ansichten.
   - **`KontoZahlungsmethoden.tsx`:**
     - Falls Stripe konfiguriert ist und ein Kundenportal-/Zahlungsmethoden-Flow vorliegt, klare Anbindung; ansonsten ehrlicher, ruhiger Hinweis ohne Demo-Platzhalter-Karten.

### Betroffene Dateien

- **Frontend:**
  - `frontend/src/pages/Profile.tsx`, `frontend/src/shop/pages/konto/KontoRahmen.tsx`, `frontend/src/shop/pages/konto/KontoProfil.tsx`
  - `frontend/src/shop/pages/konto/KontoAbos.tsx`, `frontend/src/shop/pages/konto/KontoBestellungen.tsx`, `frontend/src/shop/pages/konto/KontoBestellungDetail.tsx`, `frontend/src/shop/pages/konto/KontoRechnungen.tsx`, `frontend/src/shop/pages/konto/KontoZahlungsmethoden.tsx`
  - `frontend/src/App.tsx`, `frontend/src/components/layout/Topbar.tsx` (konsistente Links auf `/konto/*` und `/profile`)
  - `frontend/src/locales/de.json`, `frontend/src/locales/en.json`

### Stolpersteine & Invarianten

- **E2EE- & Device-Links erhalten:** Der Messenger-Deep-Link `/profile?tab=security` (z. B. aus `backend/routers/social/e2ee_keys.py` und `docs/agent-rules/security.md` §5.1 bei Gerätedeckel 409) muss weiterhin exakt den Sicherheits-Reiter mit Passwort, 2FA, Passkeys, Tresor-Sicherheit und Geräten öffnen!
- **Tauri-/Android-Kompatibilität:** Tresor-Sicherheit (`TresorSicherheitTab`) bleibt wie in `Profile.tsx` Zeile 72–74 exklusiv innerhalb von Tauri + `vault_enabled` sichtbar.
- **Keine doppelten Profil-Header:** Visuell prüfen, dass `/konto/profil` und `/profile` nur genau eine H1-Überschrift und eine Tab-Navigation rendern.

### Tests & Laufzeit-Abnahme

- Frontend (`vitest`): `Profile.test.tsx`, `KontoTab.test.tsx`, neue/erweiterte Tests für `KontoRahmen` (keine doppelten Header auf `/konto/profil`, Self-Hosted-Ausblendung leerer Shop-Tabs), `KontoAbos` (Kündigungs-Dialog, Immediate-Delete-Bestätigung, Welt-Backup-Anzeige).
- Browser-Probe: `/konto/abos`, `/konto/bestellungen`, `/konto/rechnungen`, `/konto/profil` und `/profile?tab=security` auf Desktop und Mobil prüfen.

---

## 9. Umsetzungsreihenfolge & Globale Qualitäts-Gates

### Empfohlene Reihenfolge

1. **Paket 1** (Fundament: RBAC-Sichtbarkeit, Support-Widget-Fix, Kunden-/Hybrid-/Self-Hosted-Trennung)
2. **Paket 2** (Infrastruktur: „Node bearbeiten“-Redesign, private Hybrid-Nodes, CPU-Toggle, Standort-Auswahl & Aufpreis)
3. **Paket 3** (Kommunikation: Kompakte Ankündigungs-Karte unten rechts in Shop & Panel)
4. **Paket 4** (Content: News-System `/news` + CMS + Shop/Panel-Anbindung)
5. **Paket 5** (Storefront 2.0: Design-DNA-Schärfung, Hero-Showcase, Katalog-Schienen, Live-Ping-Deck, optionale Trustpilot-/Discord-Integration, Konfigurator 2.0)
6. **Paket 6** (Konto 2.0: Einheitliche Konto- & Abo-Zentrale ohne doppelte Navigation)

Jedes Paket wird einzeln als abgeschlossene Änderung implementiert, getestet und im Browser abgenommen, bevor das nächste startet.

### Verbindliche Qualitäts-Gates für jedes Paket

- **Design-DNA & UI-Komponenten (`AGENTS.md`, `E:\Github-Projekte\maunting-design-dna`):**
  - Niemals natives `<select>`; immer `Dropdown` aus `@maunting/ui`.
  - Reine Icon-Buttons immer mit `size="icon"`.
  - Keine JSX-Prop namens `title` (Test `keinNativesTitle.test.ts`; immer `titel` + `aria-label`).
  - Dialoge mit eigenem Innen-Padding (`px-6 py-5`) und scrollbarem Body bei vielen Feldern.
- **Texte & i18n (`docs/agent-rules/text-und-sprache.md`):**
  - Alle neuen UI-Texte in `frontend/src/locales/de.json` und `frontend/src/locales/en.json` mit echten Umlauten (`ä/ö/ü/ß`), ohne AI-Floskeln oder übermäßige Gedankenstriche.
- **Sicherheit & CSP:**
  - Jede neue Route und Aktion serverseitig durch RBAC + CSRF absichern; Preise und Rabatte niemals vom Client übernehmen.
  - CSP-Änderungen immer synchron in `frontend/vite.csp.ts`, `backend/main.py`, `install.sh` und `Caddyfile.template` pflegen.
  - Nach Änderungen am UI oder an Berechtigungen Dokumentation (`docs/features.md`, `docs/de-docs/funktionen.md`, `docs/native-shop-roadmap.md` / `docs/shop-v2-roadmap.md`) synchron mitziehen.
- **Verifikation vor Abschluss jedes Pakets:**
  - Backend: `pytest` (PostgreSQL, ohne SQLite-Fallback; gezielte Suite + relevante Sicherheits-/Contract-Tests).
  - Frontend: `npm run test`, `npm run check`, `npm run build`, `npm run build:desktop`.
  - Laufzeit: Dev-Server starten, `/`, `/servers`, `/dashboard`, `/admin/nodes` und jede neu angefasste Route im Browser öffnen und die Browser-Konsole auf Fehler prüfen.
