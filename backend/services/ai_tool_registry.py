"""Eine Tabelle, aus der alle Werkzeugmengen abgeleitet werden.

Vorher standen die Zugehoerigkeiten in zehn von Hand gepflegten Mengen —
`SERVER_READ_TOOLS`, `GLOBAL_READ_TOOLS`, `WRITE_TOOLS`, `MEMORY_TOOLS`,
`SKILL_TOOLS`, `ASK_TOOLS`, `ALWAYS_CONFIRM_TOOLS` und mehr. Ein neues Werkzeug
brauchte damit Eintraege an mehreren Stellen, und eine vergessene fiel erst zur
Laufzeit auf: das Modell rief etwas auf, das der Allowlist-Pruefung nicht
bekannt war, und der Stream endete mit einem Fehler.

Jetzt gibt es **eine** Zeile je Werkzeug. Fuer umgestellte Domaenen ist das
die `ToolSpec` in ihrem Modul (`services/ai_tool_spec.py`); diese Tabelle
traegt noch die uebrigen. Die Mengen sind Ableitungen, keine Quellen.

Bewusst **keine** Handler in dieser Tabelle. Die Ausfuehrungen brauchen
unterschiedliche Signaturen — serverbezogene bekommen den aufgeloesten Server,
globale nicht — und ein gemeinsamer Nenner dafuer waere eine Abstraktion, die
mehr verdeckt als sie ordnet. Die Tabelle ordnet die *Klassifikation*, nicht
den Aufruf.
"""

from __future__ import annotations

from services.ai_tool_spec import ARTEN, ALLE, ToolSpec, Werkzeug, werkzeug


# Die Einordnung steht in `services/ai_tool_spec.py`. Diese Tabelle traegt
# zunaechst noch die Werkzeuge, deren Domaenenmodul nicht umgestellt ist;
# deklarierte Specs kommen hinzu und duerfen sich nicht doppeln.
_TABELLE: dict[str, Werkzeug] = {
    # ── Serverbezogen lesen ───────────────────────────────────────────
    #
    # Ohne `angebot` steht hier nur `server.view` dahinter, und das prueft
    # `_resolve_server` bei jedem Aufruf am **konkreten** Server. Es hier
    # nochmal hinzuschreiben brauchte fuenfzehn gleichlautende Zeilen und
    # sparte nur bei einem Benutzer etwas ein, der ueberhaupt keinen Server
    # sieht — und dessen Gespraech endet ohnehin an `list_my_servers`.
    # Eingetragen ist deshalb nur, was ein **eigenes** Recht verlangt.
    # Das PostgreSQL-Studio lesend — dieselben Funktionen wie die Studio-Reiter
    # (`ai_tools.database_tools`). Parameter, Sitzungen und Sperren verlangen
    # dort zusaetzlich `server.databases.admin`, wie an der Route.

    # ── Global lesen ──────────────────────────────────────────────────
    # Zwei Rechte, von denen eines genuegt — genau der Fall, fuer den `angebot`
    # eine Aufzaehlung ist und kein einzelner Schluessel: wer Blueprints pflegen
    # darf, muss seine eigene Vorlage ansehen koennen, auch ohne Server anlegen
    # zu duerfen (`_execute_global_read_tool`).
    # Zusaetzlich zum Recht entscheidet die Einrichtung: ohne hinterlegten
    # Suchschluessel steht `web_search` gar nicht erst im Katalog
    # (`ai_action_service._global_tool_definitions`).

    # Regionsanalyse: Geocoding, Open-Meteo und ein Bild der Region — mit
    # Copernicus-Zugang die neueste Sentinel-2-Szene, ohne ihn das
    # schluesselfreie Kartenbild (ArcGIS-Mosaik). Steht deshalb immer im Katalog.
    # Reine Steuerung einer bereits sichtbaren Karte. Das Werkzeug ruft keine
    # Geo-, Wetter- oder Nachrichtendienste erneut ab, prueft aber dasselbe
    # Recht wie die Regionsanalyse: ohne Kartenfreigabe gibt es auch keinen
    # verdeckten zweiten Steuerpfad.

    # Die Doku des Panels. Kein zusaetzliches Recht: dieselben Seiten stehen
    # jedem angemeldeten Benutzer im Panel offen — ein Gate hier waere eine
    # Schranke, die es nebenan nicht gibt.

    # Die Shop-Anbindung. Beide pruefen `panel.hoster.read` im eigenen Zweig —
    # bei `global_read` wertet die Registry `recht` nicht aus, das tut nur der
    # Vorschlagspfad.

    # Die stehenden Auftraege. `list_tasks` liest nur, was diesem Benutzer
    # gehoert.
    #
    # `send_test_email` steht hier aus demselben Grund wie `learn_skill`
    # weiter unten: das Kriterium fuer die Bestaetigungspflicht ist nicht "aendert
    # etwas", sondern "fasst einen Server an". Eine Mail an die **eigene**
    # hinterlegte Adresse tut das nicht — und einen Empfaengerparameter gibt es
    # bewusst nicht, sonst waere MSM ueber die KI ein Mailversender fuer Fremde.
    # Der Betreiber hat diesen Weg ausdruecklich ohne Bestaetigungsknopf
    # gewuenscht: wer "teste mal meine Mails" tippt, hat die Frage schon
    # beantwortet.

    # Das Gedaechtnis liest die KI nur noch. Geschrieben und vergessen wird
    # seit Stufe 2 (06.10.2026) nach dem Gespraech, im Hintergrund
    # (`ai_gedaechtnis_schreiber`); `remember` und `forget_memory` gibt es
    # nicht mehr.

    # `learn_skill` und `forget_skill` schreiben, stehen aber bei den
    # Lesewerkzeugen. Der Unterschied zwischen den Mengen ist nicht "aendert
    # etwas", sondern "fasst einen Server an und braucht deshalb eine
    # Bestaetigung". Ein Skill tut das nicht, und **Prosa fuehrt nichts
    # aus**: ein gelernter Skill kann nichts, was das Modell nicht ohnehin
    # duerfte — er aendert nur, wie es an eine Aufgabe herangeht. Vergessen
    # laeuft im autonomen Modus ohne Karte (`EIGENE_DATEN_LOESCHEN`).
    "learn_skill": Werkzeug("global_read", gruppe="skill", angebot=("ai.skills.use",)),

    # E-Mail- & Kalender-Lesewerkzeuge (Verknuepfte Postfaecher & Kalender).
    # ── Dokumente ─────────────────────────────────────────────────────
    # Gruppe `dokumente`, nicht `docs`: `docs` gehoert seit jeher den
    # statischen Hilfeseiten (`search_docs`, `read_docs`). Die Handler pruefen
    # `docs.use` + `ai.docs.use` und die Dokumentrolle bei jedem Aufruf erneut.
    # Schreibende Dokumentwerkzeuge laufen direkt (Art `docs_write`), nicht
    # ueber den Vorschlagspfad: der Mensch sieht die Aenderung live, die
    # Version und `ai-undo` bleiben der Rueckweg.
    # Teamwissen bleibt an das Dokumentteam gebunden. Die Handler lesen die
    # Team-ID aus dem Laufkontext, nie aus einem Modellargument; ein
    # Dokumenttext darf den Lauf nicht auf ein fremdes Team richten.
    # Ohne dieses Werkzeug konnte die KI nur neue Ankuendigungen anlegen. Ein
    # "nimm den Hinweis auf Mac und Linux aus dem Pop-up raus" war damit nicht
    # zu erfuellen: sie kannte weder die Kennung noch den Text, den sie haette
    # aendern sollen — und sagte das auch so.

    # Benutzer und Rollen, lesend. Dieselben Rechte wie die Panel-Routen:
    # die Benutzerliste `users.read` (`GET /api/admin/users`), die
    # Delegationen eines Benutzers `users.permissions.manage`
    # (`GET /api/admin/users/{id}/server-permissions`). Die Rollenliste steht
    # im Panel jedem offen; angeboten wird sie trotzdem nur, wer Rollen oder
    # Rechte verwaltet — sonst braucht sie niemand, und der Katalog geht in
    # jeder Runde mit.

    # ── Rueckfrage ────────────────────────────────────────────────────

    # ── Delegation: Gehirn und Worker (docs/agentic-framework.md) ─────
    #
    # `worker_start` und `worker_cancel` sind die beiden Handgriffe des
    # Gehirns: einen Auftrag als eigenen Hintergrundlauf deklarieren und ihn
    # wieder einfangen. Beide fuehren nichts aus — der Worker selbst arbeitet
    # unter dem vollen Vorschlagsfluss mit den Rechten des Benutzers. Das
    # `angebot` haelt sie aus dem Katalog jedes Benutzers heraus, dem das
    # Recht fehlt: dessen Chat arbeitet wie bisher in einem Lauf.
    # Der Rueckweg fuer Rueckfragen: hat ein Worker mit `worker_frage`
    # gefragt, gibt das Gehirn die Antwort des Benutzers hiermit an genau
    # dieses Fenster zurueck. Mechanisch dieselbe Abloesung wie im Dauerchat
    # (neue Nachricht ueberholt den wartenden Lauf und erbt seine
    # Schleifensignaturen) — nur eben im Worker-Fenster, in das der Benutzer
    # selbst nicht schreiben kann.
    # `wait_until` parkt den eigenen Lauf bis zu einem Zeitpunkt
    # (`waiting_wake` + `wake_at`) statt zu schleifen. Kein `angebot`: es ist
    # nur fuer Worker-Laeufe gedacht, und das entscheidet der Laufart-Schnitt
    # in `_werkzeuge_und_grenze` — ein Rechteschluessel waere die falsche
    # Achse, denn das Recht haengt am Delegieren, nicht am Warten.
    # Die Rueckfrage eines Workers. `art="ask"` mit Absicht: sie faehrt damit
    # in ASK_TOOLS/READ_TOOLS mit und wird wie `ask_user` vor der Lesephase
    # abgefangen — nur die Zustellung (Meldestelle mit Worker-ID statt
    # Broker-Frage) und das Park-Ziel unterscheiden sich. Kein `angebot` aus
    # demselben Grund wie bei `wait_until`.

    # Nur OpenAI Realtime bekommt dieses Werkzeug. Der normale Chat und Worker
    # schneiden `voice_control` aus ihren Rollenmengen heraus. Die Kennung des
    # Vorschlags bleibt dabei serverseitig in genau einer Sprachsitzung.
    # Rein lokale, sitzungsgebundene Darstellung. Diese Befehle lesen weder
    # Regionaldaten noch verändern sie Serverzustand; sie dürfen deshalb nur
    # im Realtime-Transport und nie im allgemeinen Chatlauf erscheinen.

    # ── Schreiben: erzeugen ausschliesslich Vorschlaege ───────────────
    #
    # `propose_server_lifecycle` traegt kein `recht`: es haengt vom Vorgang ab
    # (start/stop/restart sind drei verschiedene Rechte). Die Zuordnung steht
    # als ausdrueckliche Ausnahme in `ai_proposal_service._permission_for`.
    # `angebot` zaehlt alle drei auf, weil eines genuegt: wer nur starten darf,
    # soll das Werkzeug bekommen. Welches Recht der einzelne Aufruf braucht,
    # entscheidet weiterhin `_permission_for` am `operation`-Argument.
    # Einspielen ueberschreibt den aktuellen Spielstand mit einem aelteren. Was
    # seit dem Backup passiert ist, existiert danach nicht mehr — und kein
    # zweites Backup holt es zurueck, weil es nie eines davon gab. Unumkehrbar,
    # also gesperrt. Anlegen bleibt autonomiefaehig: ein zusaetzliches Backup
    # schadet nie.
    # Dieselbe Sache wie `propose_config_update`, nur nicht die ganze Datei —
    # und deshalb dasselbe Recht. Die Trennung ist keine Rechtefrage, sondern
    # eine der Reichweite: die Vollersetzung setzt voraus, dass das Modell die
    # Datei vollstaendig gesehen hat, die Teilaenderung nur die eine Stelle.
    # Ueber 24.000 Zeichen ist die erste unerreichbar; die zweite bleibt es
    # nicht. Ohne sie war jede echte Spielkonfiguration fuer die KI nur lesbar.
    #
    # Umkehrbar und damit autonomiefaehig: `write_server_text` legt vor jedem
    # Schreiben einen Versionsschnappschuss an, aus dem der Dateimanager den
    # alten Stand zurueckholt.
    # Der Normalfall fuer Spielkonfigurationen — und dasselbe Recht wie die
    # beiden darueber, weil es dieselbe Sache tut: eine Datei des Servers
    # aendern.
    #
    # Es gibt ihn, weil Textersetzung fuer eine Formatdatei messbar das falsche
    # Verfahren ist. Am 18.08.2026 hing ein ausgefuehrter Patch einen zweiten
    # `[ServerSettings]`-Block ans Dateiende; ARK liest nur den ersten. Die
    # Werte waren richtig, die Wirkung war null, und im Diff sah alles korrekt
    # aus. Mit Sektion und Schluessel als Argument kann das nicht passieren.
    #
    # Umkehrbar wie der Patch (Versionsschnappschuss vor jedem Schreiben) und
    # damit autonomiefaehig. Dass der Wert zusaetzlich als dauerhafter Wunsch
    # hinterlegt wird, aendert daran nichts: `propose_config_set` mit dem alten
    # Wert stellt beides zurueck.
    # Der Schalter an einer bereits installierten Mod. Eigenes Recht
    # (`server.mods.toggle`, im Katalog seit jeher) und eigenes Werkzeug, weil
    # An- und Ausschalten etwas anderes ist als Herunterladen: es loescht
    # nichts, laedt nichts und ist mit demselben Aufruf zurueckzunehmen —
    # also autonomiefaehig. `read_server_mods` meldete den Zustand `enabled`
    # schon lange, ohne dass irgendetwas ihn setzen konnte.
    # Eine falsche Bind-IP macht den Server unerreichbar — aber nur, bis jemand
    # sie zurueckstellt, und das kann die KI selbst. Kein Datenverlust, also
    # keine Sperre. Die Freigabe des Betreibers ist hier die Entscheidung, nicht
    # die Bestaetigung jedes einzelnen Falls.
    # Loeschen ist nicht rueckgaengig zu machen — deshalb auch im autonomen
    # Modus bestaetigungspflichtig, ausdrueckliche Vorgabe des Betreibers.
    #
    # `servers.delete` ist global und nicht delegierbar (permission_catalog:
    # "BEWUSST global, destruktiv, nur Admin/Owner"). Das Werkzeug ist trotzdem
    # serverbezogen: es braucht eine `server_id`, und `_resolve_server` stellt
    # vorher sicher, dass der Benutzer diesen Server ueberhaupt sehen darf. Es
    # gilt also beides — sehen duerfen **und** global loeschen duerfen.
    # Eine Ableitung legt eine **neue** Datei an und laesst die Vorlage, aus der
    # sie stammt, unberuehrt. Ist sie falsch, loescht man sie wieder; kein Server
    # aendert sich, solange niemand ihn umstellt. Der Betreiber hat die Sperre
    # hier ausdruecklich aufgehoben.
    # Das Gegenstueck dazu — und es traegt die Sperre, die die Ableitung nicht
    # braucht. `blueprint_service.delete_community_blueprint` entfernt die Datei
    # per `unlink`; einen Versionsschnappschuss wie bei den Serverdateien gibt es
    # hier nicht, und die Registry haelt nur, was auf der Platte liegt. Der
    # einzige Weg zurueck ist eine Datei, die jemand vorher von Hand exportiert
    # hat — und "vielleicht hat es jemand" ist kein nachgewiesener Rueckweg.
    # Damit greift das Kriterium der Tabelle (Unumkehrbarkeit, siehe oben)
    # genauso wie bei `propose_server_delete`.
    #
    # Daraus folgt eine Asymmetrie, die beabsichtigt ist: die KI darf im
    # autonomen Modus einen Testserver anlegen und einen Blueprint dafuer
    # ableiten, aber beides nicht selbst wieder wegraeumen — `propose_server_delete`
    # traegt `immer_bestaetigen` aus demselben Grund. Aufraeumen kostet also
    # einen Klick, Anlegen nicht. Das ist die richtige Richtung: ein Blueprint zu
    # viel ist eine Zeile in einer Liste, ein Blueprint zu wenig sind Server, die
    # ihre Vorlage verloren haben.
    # Der Wechsel des Spiels bzw. Blueprints eines bestehenden Servers.
    #
    # **Seit dem 02.09.2026 wieder ohne `immer_bestaetigen`**, auf ausdrueckliche
    # Vorgabe des Betreibers: im autonomen Modus laeuft der Wechsel ohne
    # Rueckfrage, obwohl er das Serververzeichnis leert. Die Begruendung
    # darunter, warum er vorher gesperrt war, bleibt stehen, denn sie beschreibt,
    # was der Wechsel tut. Aus der Guardian-Heilung und den Aufgaben bleibt er
    # ausgeschlossen, dort sitzt niemand davor.
    #
    # **`immer_bestaetigen` trug er, seit jemand nachgesehen hatte, was dabei
    # passiert.**
    #
    # Hier stand: "autonomiefaehig auf ausdrueckliche Vorgabe des Betreibers —
    # und es passt zum Kriterium: `switch_server_blueprint` legt zwingend ein
    # Backup an, bevor es die erste Datei anfasst." Der erste Halbsatz stimmt,
    # der zweite auch, und die Folgerung trotzdem nicht.
    #
    # `switch_server_blueprint` ist kein Umhaengen, sondern eine
    # **Neuinstallation**: `wipe_server_root` loescht das *gesamte*
    # Serververzeichnis — Welt, Konfigurationen, Mods —, die Ports werden neu
    # vergeben, und danach laeuft eine frische Installation. Dass davor ein
    # Backup steht, macht den Vorgang wiederherstellbar, nicht harmlos: der Weg
    # zurueck ist eine Wiederherstellung, die selbst Stunden dauert, und
    # `propose_backup_restore` traegt aus genau diesem Grund seit jeher
    # `immer_bestaetigen`.
    #
    # Aufgefallen ist es beim Bau der Guardian-Reparatur, wo der Wechsel als
    # naheliegender Weg galt ("Blueprint ableiten, anpassen, Server umstellen").
    # Fuer eine zu knapp bemessene Startzeit die Welt zu loeschen ist keine
    # Behebung — dafuer gibt es jetzt `propose_guardian_tuning`. Der Wechsel
    # bleibt moeglich und braucht einen Menschen; im unbeaufsichtigten Lauf
    # heisst das ab Teil 4 eine Freigabe per E-Mail.
    #
    # `server.config.write` — dasselbe Recht wie am Panel-Knopf "Spiel /
    # Blueprint wechseln" (`routers/servers.py::switch_server_blueprint_endpoint`).
    #
    # Zwei Entwuerfe davor waren falsch: erst das globale `blueprints.manage`,
    # dann ein eigens erfundenes `server.blueprint.switch`. Beide erzeugten
    # dasselbe Problem in verschiedener Form — eine Handlung mit **zwei**
    # Rechten. Jemand haette sie ueber die KI gedurft und ueber das Panel nicht,
    # oder umgekehrt. Das Recht, nach dem der Betreiber gefragt hat, gab es
    # bereits; es fehlte nur die Verbindung dorthin.
    # Kein `immer_bestaetigen`: ein Server, den es vorher nicht gab, vernichtet
    # nichts. Das ist die eine Haelfte der Asymmetrie, die bei
    # `propose_blueprint_delete` und `propose_server_delete` beschrieben steht —
    # sie sei hier ausdruecklich genannt, damit sie beim naechsten Blick auf
    # diese Zeile nicht noch einmal als Versehen gelesen wird: die KI kann im
    # autonomen Modus anlegen, aber nicht wegraeumen. Wer sie einen Testserver
    # bauen laesst, raeumt ihn selbst wieder ab.

    # ── Stehende Auftraege anlegen, aendern, loeschen ─────────────────
    #
    # Kein `immer_bestaetigen`, obwohl auch geloescht wird — das Kriterium ist
    # Unumkehrbarkeit, und eine Aufgabe ist eine Zeile, die man wieder anlegen
    # kann. Nichts an ihr vernichtet Daten.
    #
    # Und ein zweiter Grund, der wichtiger ist: die Bestaetigungskarte **ist**
    # hier die Genehmigung des stehenden Auftrags. Sie im autonomen Modus zu
    # ueberspringen hiesse, dass die KI sich selbst kuenftige Laeufe einrichtet.
    # Bei einem einzelnen Werkzeugaufruf ist das eine Handlung; bei einer
    # Aufgabe ist es eine Handlung, die sich wiederholt. Deshalb steht der
    # Vorschlag immer da — was `immer_bestaetigen` zusaetzlich absichern
    # wuerde, waere der autonome Modus, und der ist genau die Freigabe, die
    # `kind='act'` ohnehin verlangt.
    #
    # `ai.tasks.manage` ist ein **neues** Recht, und das ist hier richtig statt
    # der sonst gebotenen Wiederverwendung: es gibt keinen Panelknopf fuer
    # stehende Auftraege, also entsteht keine Handlung mit zwei Rechten.
    # `ai.chat.use` waere zu weit (jeder Chatbenutzer haette es),
    # `ai.autonomous.use` zu eng (ein reiner Bericht braucht keine Autonomie).
    #
    # Anlegen und Aendern sind **ein** Werkzeug — `task_id` weglassen heisst
    # anlegen, dasselbe Muster wie bei `propose_hoster_integration`. Zwei
    # Werkzeuge haetten den Zeitplan zweimal im Katalog gehabt, und der geht in
    # jeder Runde der Werkzeugschleife mit ueber die Leitung.

    # ── Heilung: Reparatur der Anlage, nicht des Spielstands ──────────
    #
    # Das eine Werkzeug fuer alles, was unterhalb der Spieldateien kaputt geht —
    # Container, Docker-Netz, Rechte am Bind-Mount, Portvergabe. Es nimmt eine
    # **Kennung aus einer geschlossenen Liste** und keinen freien Text. Das ist
    # der ganze Punkt: es gibt damit keinen Weg von einer Modellausgabe zu einer
    # Befehlszeile, zu einem Pfad oder zu einem Containernamen. Ein geglueckter
    # Jailbreak kann hoechstens die falsche der vier Reparaturen waehlen.
    #
    # Umkehrbar und deshalb autonomiefaehig: jede der vier Aktionen stellt einen
    # Sollzustand her, den MSM ohnehin kennt. Keine loescht Spieldaten — das
    # Serververzeichnis ist ein Bind-Mount und ueberlebt den Container.
    #
    # Traegt wie `propose_server_lifecycle` **kein** `recht`: es haengt vom
    # Vorgang ab, und die Zuordnung steht als ausdrueckliche Ausnahme in
    # `ai_proposal_service._permission_for`. Hier stand `server.config.write`
    # mit der Begruendung, das sei „dasselbe Recht wie am Panel-Knopf, hinter
    # dem dieselben Funktionen liegen" — diesen Knopf gibt es nicht:
    # `reassign_conflicting_ports` hat ausser der KI keinen Aufrufer, und die
    # einzige Panel-Route, die Ports aendert (`PATCH /api/servers/{id}`),
    # verlangt `server.network.manage`; den Root-Chown loest das Panel nur
    # innerhalb einer `server.files.write`-Operation aus (`routers/files.py`).
    # Ein Benutzer mit blossem `server.config.write` („Servername, Auto-Restart,
    # Startparameter") konnte hier also Firewallregeln umbauen lassen.
    # `angebot` zaehlt beide auf, weil eines genuegt; welches Recht der einzelne
    # Aufruf braucht, entscheidet `_permission_for` am `action`-Argument.
    # Guardian **fuer diesen einen Server** anders einstellen.
    #
    # Der Fall, den es abdeckt, ist der dritte der drei, die eine Reparatur
    # auseinanderhalten muss: Guardian hat sich nicht geirrt, und der Server ist
    # nicht kaputt — Guardian ist fuer diesen Server falsch eingestellt. Die
    # Blueprint gilt fuer jeden Server ihres Spiels und kann nicht wissen, dass
    # ausgerechnet auf dieser Node zwoelf Instanzen um acht Gigabyte streiten.
    #
    # Bis hierher gab es dagegen zwei Werkzeuge, und beide sind zu grob: die
    # Blueprint fuer **alle** Server dieses Spiels aendern, oder den Server auf
    # eine abgeleitete Blueprint umhaengen — was `switch_server_blueprint` als
    # Neuinstallation mit `wipe_server_root` ausfuehrt. Fuer eine zu knapp
    # bemessene Startzeit die Welt zu loeschen ist keine Behebung.
    #
    # **Kein `immer_bestaetigen`**, und das ist dieselbe Regel wie ueberall
    # hier: das Kriterium ist Unumkehrbarkeit, nicht gefuehltes Risiko. Eine
    # Uebersteuerung ist eine Zeile in einer Spalte, `reset` nimmt sie zurueck,
    # und der Guardian-Reiter zeigt sie an. Sie loescht nichts.
    #
    # `server.config.write` ist dasselbe Recht wie am Panelknopf, hinter dem
    # dieselbe Spalte liegt. Ein eigenes Recht waere eine Handlung mit zwei
    # Rechten — der Fehler, der bei `propose_server_blueprint_switch` zweimal
    # gemacht und dokumentiert wurde.
    # ── Auto-Neustart und Auto-Backup eines Servers einstellen ────────
    #
    # Der Durchgriff auf die **eingebaute** Zeitplanlogik: „starte den Server
    # alle acht Stunden neu" oder „mach täglich ein Backup" wird hier zu genau
    # den Feldern, die der Benutzer im Panel sieht und selbst ändern kann —
    # statt zu einem stehenden Auftrag, der unsichtbar unter `ai_tasks` läge
    # und je Lauf einen Anbieteraufruf kostete. Ein stehender Auftrag bleibt
    # nur für das richtig, was diese Felder nicht ausdrücken (z. B. Neustarts
    # nur an bestimmten Wochentagen).
    #
    # `server.config.write` ist dasselbe Recht wie an den Panel-Endpunkten
    # (`PATCH /api/servers/{id}` für den Neustart-Zeitplan,
    # `PATCH /api/backups/{id}/settings` für den Backup-Zeitplan) — eine
    # Handlung, ein Recht. Kein `immer_bestaetigen`: ein Zeitplan ist eine
    # Zeile, die man zurückstellt; nichts daran vernichtet Daten.
    # Loeschen einer **einzelnen** Datei unterhalb des Serververzeichnisses.
    #
    # `immer_bestaetigen` seit dem 23.09.2026, obwohl es einen Rueckweg gibt.
    # Bis dahin fehlte die Sperre genau mit dieser Begruendung, und der
    # autonome Modus loeschte Dateien ohne Rueckfrage. Die Vorgabe des
    # Betreibers war "alles automatisch ausser Loeschvorgaenge", nicht
    # "ausser Unumkehrbarem"; seit dem 25.09.2026 fragt das Loeschen nur noch,
    # wo es Server, Dateien und Backups trifft (siehe `Werkzeug`). Eine Guardian-Heilung, die eine
    # Datei loeschen will, loescht deshalb nicht selbst. Sie fragt per Mail
    # (`ai_approval_service`), und ohne hinterlegte Adresse endet sie.
    #
    # Der Rueckweg bleibt trotzdem Pflicht, fuer den Fall, dass ein Mensch
    # zugestimmt und sich geirrt hat. Er ist doppelt gebaut:
    #
    # 1. **Im Guardian-Lauf** laeuft das Werkzeug ueberhaupt nur, wenn ein
    #    nachweislich geglecktes Backup vorliegt, das juenger ist als der Beginn
    #    der Heilung (`ai_proposal_service._verlangt_gesichertes_backup`). Diese
    #    Pruefung laeuft zweimal — beim Anlegen und, ueber
    #    `guardian_aus_lauf`, noch einmal in `execute_proposal`. Die
    #    Wiederholung ist nicht Zierde: zwischen beiden Punkten liegt ein Commit
    #    und ein Zeitfenster ohne Obergrenze, in dem die Aufbewahrungsregel das
    #    Archiv abgeraeumt haben kann. Als die zweite Pruefung hier noch
    #    behauptet und nicht gebaut war, war genau das der Weg zu einer
    #    geloeschten Datei ohne Backup.
    # 2. **Im gewoehnlichen Chat** gibt es diese Schranke nicht, dort
    #    entscheidet allein der Mensch. Der Weg zurueck ist dann der
    #    Versionsschnappschuss aus `file_history_service`, und er ist eine
    #    **Vorbedingung**: `delete_server_text` wertet seinen Rueckgabewert aus
    #    und loescht nicht, wenn er ausbleibt. Deshalb weist schon der Vorschlag
    #    ab, was sich nicht sichern laesst — binaere Dateien (ein mit U+FFFD
    #    durchsetzter Schnappschuss ist ein Rueckweg, der die Datei zerstoert)
    #    und alles ueber 512 KiB. Zuvor gab `snapshot` dort stillschweigend
    #    `False` zurueck, der Wert wurde verworfen, und eine zwei Megabyte grosse
    #    Regionsdatei verschwand ohne jede Spur.
    # `server.files.delete`, nicht `server.files.write`: das Panel verlangt
    # fuer denselben Vorgang (`DELETE /api/servers/{id}/delete`) ausdruecklich
    # das Loeschrecht, und die Rechtebeschreibung von `server_files_write`
    # nennt Loeschen nicht. Mit `write` hier waere der Chat der Umweg, auf dem
    # ein Benutzer ohne Loeschrecht doch loescht — eine Handlung, zwei Rechte.
    # Was das PostgreSQL-Studio schreibt: Struktur (auch Funktionen, Trigger,
    # Erweiterungen), Zeilen und freies SQL (`ai_proposals.database_proposals`).
    # `recht` ist die Untergrenze; Operationen mit Admin-Plan und freies SQL
    # pruefen dort zusaetzlich `server.databases.admin`, wie die Studio-Route.
    # Kein `immer_bestaetigen`: eine neue Funktion oder ein Trigger ist wie eine
    # neue Konfigzeile. Gefragt wird am Aufruf (`always_confirm`), wo Daten
    # verschwinden koennen — destruktiver Plan, Zeilen loeschen, freies SQL.

    # ── Shop-Anbindung einrichten ─────────────────────────────────────
    #
    # Alle drei tragen `immer_bestaetigen`. Der Grund steht schon bei
    # `GEPLANT_IMMER_BESTAETIGEN` weiter unten: eine Rechteaenderung oder eine
    # Schluesselerzeugung wirkt auf die Grenzen, innerhalb derer die KI selbst
    # arbeitet. Ein Produkt mit `role_id` bestimmt woertlich, welche Rolle
    # **jeder kuenftige Kaeufer** bekommt; eine Tarifrolle traegt das
    # KI-Kontingent; eine Integration erzeugt einen API-Key.
    #
    # Bei der Integration kommt ein **mechanischer** Grund dazu, der unabhaengig
    # von jeder Auslegung gilt: im autonomen Modus ruft `ai_stream_service`
    # `execute_autonomously` und verwirft dessen Rueckgabewert. Genau darin
    # steckt der einmalige Klartextschluessel — `create_integration` gibt ihn
    # exakt einmal aus, gespeichert wird nur der Hash. Eine autonom angelegte
    # Integration waere unbenutzbar und nur ueber eine Rotation zu retten.
    # Bestaetigungspflicht ist hier keine Vorsicht, sondern Funktionsbedingung.
    # `roles.manage` steht in der Tabelle, weil die Rolle angelegt wird.
    # Das zweite noetige Recht (`panel.settings.write` fuer das KI-Kontingent)
    # prueft der Payload-Bau zusaetzlich — die Tabelle traegt genau ein `recht`,
    # und die Handlung braucht zwei.

    # ── E-Mail & Kalender Aktionen (Vorschlagspflichtig) ──────────────
    # Die persoenlichen Loeschwerkzeuge laufen im autonomen Modus ohne Karte
    # (`EIGENE_DATEN_LOESCHEN`), aber mit Stundenbudget: die Abkuerzung in
    # `autonomy_allows` gilt nur fuer Anlegen und Aendern.
    # Anlegen **und** aendern in einem Werkzeug, nach dem Vorbild von
    # `propose_task_set`: beide tragen dasselbe Schema, und eine `popup_id`
    # entscheidet, welcher der beiden Faelle gemeint ist. Zwei Werkzeuge waeren
    # hier rund 1.700 Zeichen Katalog fuer ein zweites Mal dieselben acht
    # Felder gewesen — der Katalog geht in jeder Runde mit
    # (`test_ai_tool_handler_contract`).

    # ── Rechte anderer Benutzer ─────────────────────────────────────────
    #
    # Dieselben Rechte und dieselben Schranken wie im Panel: alle vier rufen
    # `rechtevergabe_service`, wo auch die Router ihre Grenzen holen. Die KI
    # kann damit nie mehr vergeben, als der Benutzer selbst dauerhaft haelt.
    #
    # Die Bestaetigung haengt hier am **Aufruf**, nicht am Werkzeug: im
    # autonomen Modus laeuft ohne Rueckfrage nur, was ausschliesslich
    # unkritische Serverrechte **hinzufuegt** (`UNCRITICAL_SERVER_PERMISSIONS`).
    # Jedes Entziehen, jedes kritische und jedes globale Recht fragt immer —
    # der Payload-Bau setzt dafuer `always_confirm` in die Vorschau
    # (`verlangt_klick`). Das ist die Linie, die `GEPLANT_IMMER_BESTAETIGEN`
    # fuer Rechteaenderungen gezogen hatte ("eine Autonomie, die ihren eigenen
    # Rahmen verschiebt"), enger geschnitten: "gib ihm die normalen Rechte auf
    # dem Minecraft-Server" soll unterwegs per Stimme gehen (Betreiberplan
    # vom 24.09.2026), und sehen, starten und Logs lesen verschiebt keinen
    # Rahmen.
    #
    # Serverbezogen, weil eine Delegation an genau einem Server haengt;
    # `_resolve_server` prueft vorher, dass der Benutzer ihn sieht. Das Recht
    # selbst ist global wie am Panel-Endpunkt.
    # Anlegen und aendern in einem Werkzeug, Muster `propose_task_set`: eine
    # `role_id` entscheidet. Systemrollen (`admin`, `user`) fasst die KI nie
    # an, auch dort nicht, wo das Panel dem Owner die `user`-Rolle oeffnet.

    # ── Der Rechner des Benutzers (Smart System) ────────────────────────────
    #
    # `delegation` und nicht `global_write`, obwohl geschrieben wird: eine
    # Vorschlagskarte je Datei waere hier das Gegenteil von hilfreich — der
    # Benutzer hat einen Ordner freigegeben, damit dort ohne Rueckfrage
    # gearbeitet wird. Die Grenze ist der Ordner, nicht die einzelne Aktion,
    # und sie steht auf dem Rechner (Rust), wo sie hingehoert. Das Panel kann
    # sie gar nicht pruefen: es kennt weder den Pfad noch das Dateisystem.
    #
    # Alle laufen ueber `desktop_jobs` und parken den Lauf, bis der Rechner
    # geantwortet hat. Sechs statt zwanzig Werkzeuge ist Absicht: der Katalog
    # ist gemessen der groesste Posten im Prompt, und eine `aktion` im
    # Argument kostet nichts.
    #
    # Der Satz oben ("die Grenze ist der Ordner") gilt fuer die Sandbox und
    # **nur** fuer sie. Ausserhalb gibt es keinen freigegebenen Ordner mehr,
    # auf den man sich berufen koennte — deshalb hat `desktop_aufraeumen`
    # weiter unten seine eigene Begruendung und seine eigene Karte.
    # Nur lesend: Laufwerke, Ordner, Platzfresser, Bildschirmfoto, Virenscan.
    # Dass Sehen und Scannen hier stehen und nicht in eigenen Werkzeugen, ist
    # dieselbe Rechnung wie oben — eine `aktion` kostet nichts, ein Werkzeug
    # rund tausend Zeichen Katalog.
    # Aufraeumen ausserhalb der Sandbox — der einzige Weg, auf dem die KI am
    # Rechner etwas vernichtet, das der Benutzer nicht ausdruecklich fuer sie
    # freigegeben hat.
    #
    # Trotzdem `delegation` und kein `global_write`, und das ist eine bewusste
    # Abweichung vom sonstigen Muster: die Bestaetigung steht hier nicht als
    # Vorschlagskarte im Panel, sondern als Karte **auf dem Rechner selbst**
    # (Aufraeumkarte.tsx, wie bei `desktop_steuern(aktion="freigabe")`). Zwei
    # Gruende.
    # Erstens gehoert die Frage "darf das weg?" vor die Augen dessen, dem die
    # Dateien gehoeren — nicht in ein Panel, das vielleicht auf einem anderen
    # Geraet offen ist. Zweitens kann nur der Rechner die Liste ueberhaupt
    # fuellen: welcher Pfad in welcher Zone liegt und wie viele Bytes daran
    # haengen, weiss das Panel nicht und soll es nicht wissen.
    #
    # Ob gefragt wird, entscheidet weiterhin **allein das Panel**
    # (`autonomy_allows`, eingesetzt in `_desktop_behandeln`). Die App bekommt
    # das Urteil als Argument und kann es nicht zu ihren Gunsten drehen: bei
    # fehlendem Feld fragt sie.
    # Maus und Tastatur — samt der Bitte um die Freigabe dafuer
    # (`aktion="freigabe"`, frueher das eigene Werkzeug
    # `desktop_takeover_control`). Zusammengelegt am 23.08.2026, weil der
    # Katalog beim Aufraeumwerkzeug an seine 64.000 Zeichen stiess und die
    # Hausregel dafuer "zusammenlegen, nicht kuerzen" lautet
    # (test_ai_tool_handler_contract). Es ist zugleich die ehrlichere
    # Einteilung: hier steht jetzt alles, was die Freigabe braucht,
    # einschliesslich der Bitte darum.
    #
    # Freigeben kann sie weiterhin allein der Mensch am Rechner. Das Panel
    # kann sie weder erteilen noch verlaengern, und ohne gueltige Freigabe
    # weist die App jede der uebrigen Aktionen ab — losgeschickt werden sie
    # trotzdem, weil nur der Rechner weiss, ob die Frist noch laeuft.
    # Desktop-Artefakte: generische Pipeline fuer Software, Mods und Installer.
    # Download, SHA-256, Defender-Pruefung, fluechtige Windows Sandbox, Locator,
    # Deployment mit Snapshot-Manifest und dateibasiertem Rollback.
    # Universeller Projekt-, Coding-Sandbox- und Git-Arbeitsbereich (GitHub/GitLab).
    #
    # Die Sicherheitsgrenze ist die isolierte Sandbox des jeweiligen Projekts:
    # Lese- und Schreibvorgänge operieren strikt innerhalb von `proj_<id>` im
    # dedizierten Sandbox-Basisverzeichnis. Befehle (`run_command`) sind durch
    # eine Dev-Tool-Allowlist und strikte Pfadprüfungen gegen Host-Eskalation
    # abgesichert. Git-Tokens werden über den AskPass-Mechanismus geschützt.
}



from services.ai_tools import cloudflare_read_tools, curseforge_read_tools, database_tools, document_tools, geo_tools, global_write_tools, hoster_read_tools, panel_overview_tools, project_tools, personal_tools, server_history_tools, server_network_tools, server_file_tools, server_mod_tools, server_ops_tools, server_write_tools, system_tools, task_tools, user_tools  # noqa: E402,F401

_DEKLARIERT = {name: spec.werkzeug for name, spec in ALLE.items()}
_DOPPELT = set(_TABELLE) & set(_DEKLARIERT)
if _DOPPELT:
    raise RuntimeError(f"Werkzeug doppelt deklariert: {sorted(_DOPPELT)}")
WERKZEUGE: dict[str, Werkzeug] = {**_TABELLE, **_DEKLARIERT}

# Werkzeuge aus dem Zielbild, die es noch nicht gibt. Sie stehen hier, damit
# ein kuenftiges Tool sich ausdruecklich einordnen muss, statt stillschweigend
# autonomiefaehig zu sein.
#
# Die ersten beiden vernichten Daten und fallen damit unter dasselbe Kriterium
# wie Loeschen und Einspielen. Die Schluesselrotation aus einem anderen Grund:
# sie wirkt auf die Grenzen, innerhalb derer die KI selbst arbeitet. Autonom
# ausgefuehrt waere das eine Autonomie, die ihren eigenen Rahmen verschiebt —
# und die kann niemand mehr erteilen oder entziehen.
#
# Hier stand auch `propose_permission_change`. Seit 09/2026 gibt es die
# Rechtewerkzeuge wirklich (`propose_user_server_permission` und die drei
# Rollenwerkzeuge), und die Grenze steht am Aufruf statt am Namen: was mehr
# tut, als unkritische Serverrechte hinzuzufuegen, fragt immer
# (`verlangt_klick`).
GEPLANT_IMMER_BESTAETIGEN = frozenset({
    "propose_server_wipe",
    "propose_server_reinstall",
    "propose_secret_rotation",
})


def angebotsrechte(name: str) -> tuple[str, ...]:
    """Rechte, von denen **eines** genuegt, damit dieses Werkzeug angeboten wird.

    Eine leere Menge heisst "jedem anbieten" — das gilt fuer `ask_user`, die
    Doku, `list_my_servers` und `list_tasks`, die alle kein zusaetzliches Recht
    verlangen.

    Der Rueckfall auf `recht` ist Absicht: bei den Schreibwerkzeugen steht das
    verlangte Recht bereits dort, und es ein zweites Mal in `angebot`
    hinzuschreiben waere genau die doppelte Pflege, gegen die diese Tabelle
    gebaut wurde. `angebot` ist nur fuer die Faelle da, die `recht` nicht
    ausdruecken kann: Lesewerkzeuge (die ihr Recht im eigenen Handler pruefen)
    und Werkzeuge mit mehreren gleichwertigen Rechten.
    """
    spec = WERKZEUGE[name]
    if spec.angebot:
        return spec.angebot
    return (spec.recht,) if spec.recht else ()


def _mit_art(*arten: str) -> set[str]:
    return {name for name, spec in WERKZEUGE.items() if spec.art in arten}


def _mit_gruppe(gruppe: str) -> set[str]:
    return {name for name, spec in WERKZEUGE.items() if spec.gruppe == gruppe}


SERVER_READ_TOOLS = _mit_art("server_read")
# `ask` und `delegation` fahren bewusst im globalen Lesepfad mit: sie brauchen
# keine `server_id` und erzeugen keine neue Vorschlagskarte. `voice_control`
# bleibt davon getrennt: Es ist ausschließlich ein Realtime-Sitzungsbefehl und
# hat keinen Handler im allgemeinen Chatlauf.
GLOBAL_READ_TOOLS = _mit_art("global_read", "ask", "delegation")
CALENDAR_TOOLS = _mit_gruppe("calendar")
NOTES_TOOLS = _mit_gruppe("notes")
PROJECTS_TOOLS = _mit_gruppe("projects")
DOCUMENTS_TOOLS = _mit_gruppe("dokumente")
DOCUMENTS_WRITE_TOOLS = _mit_art("docs_write")
DOCUMENTS_READ_TOOLS = DOCUMENTS_TOOLS - DOCUMENTS_WRITE_TOOLS

#: Dokumentwerkzeuge, die echtes Teamwissen lesen oder schreiben. Ein
#: Link-Gast mit Editor-Recht am Dokument ist kein Teammitglied; er bekommt
#: diese Werkzeuge deshalb gar nicht erst angeboten.
DOCS_TEAM_TOOLS = frozenset({
    "read_team_notes",
    "read_team_calendar",
    "search_team_memory",
    "learn_team_skill",
    "read_document_skill",
})

#: Das Oekosystem, das eine Dokument-KI lesen darf. Eine ausdrueckliche
#: Aufzaehlung, keine Ableitung aus `SERVER_READ_TOOLS`/`GLOBAL_READ_TOOLS`:
#: Logs, Konfigurationen, Dateien, Datenbank, Web, Mail, Aufgaben, Popups,
#: Benutzer- und Cloudflare-Daten wuerden sonst stillschweigend mitwandern und
#: koennten ueber ein geteiltes Dokument nach draussen gelangen. Ein neues
#: Lesewerkzeug braucht hier bewusst eine Zeile.
DOCS_ECOSYSTEM_READ = frozenset({
    "list_my_servers",
    "read_server_status",
    "read_server_capacity",
    "read_server_ports",
    "read_server_network",
    "check_server_reachability",
    "read_server_mods",
    "read_mod_updates",
    "read_server_backups",
    "read_guardian_incidents",
    "read_node_health",
    "read_node_capacity",
    "search_chat_attachments",
    "read_chat_attachment",
})
# Dokument-Schreibwerkzeuge laufen im Sofortpfad, nicht ueber eine
# Vorschlagskarte. Der Grund ist die Zusage an den Nutzer: Singra schreibt
# direkt, und der Rueckweg ist die Version plus `undo_ai_edit`.
READ_TOOLS = SERVER_READ_TOOLS | GLOBAL_READ_TOOLS | DOCUMENTS_WRITE_TOOLS
SERVER_WRITE_TOOLS = _mit_art("server_write")
GLOBAL_WRITE_TOOLS = _mit_art("global_write")
WRITE_TOOLS = SERVER_WRITE_TOOLS | GLOBAL_WRITE_TOOLS
MEMORY_TOOLS = _mit_gruppe("memory")
SKILL_TOOLS = _mit_gruppe("skill")
DOCS_TOOLS = _mit_gruppe("docs")
MAIL_TOOLS = _mit_gruppe("mailbox")
CALENDAR_TOOLS = _mit_gruppe("calendar")
POPUP_TOOLS = _mit_gruppe("popup")
TASK_TOOLS = _mit_gruppe("tasks")
NOTES_TOOLS = _mit_gruppe("notes")
ATTACHMENT_TOOLS = _mit_gruppe("attachments")
# Eine Gruppe "social" gab es hier bis 09/2026. Sie trug die beiden
# Messenger-Suchen; beide sind entfernt, und die KI hat seitdem gar kein
# Werkzeug mehr, das den Messenger anfasst. Siehe docs/agent-rules/security.md,
# Abschnitt 5.1.
CHAT_INTERACTION_TOOLS = (
    MAIL_TOOLS | CALENDAR_TOOLS | POPUP_TOOLS | TASK_TOOLS | NOTES_TOOLS | ATTACHMENT_TOOLS
)
ASK_TOOLS = _mit_art("ask")
DELEGATION_TOOLS = _mit_art("delegation")
# Die Werkzeuge, die nicht im Panel laufen, sondern auf dem Rechner des
# Benutzers (`desktop_jobs`). Sie sind der Grund, warum ein Lauf parken kann,
# ohne dass jemand etwas bestaetigen muss.
DESKTOP_TOOLS = _mit_gruppe("desktop")
ALWAYS_CONFIRM_TOOLS = (
    {name for name, spec in WERKZEUGE.items() if spec.immer_bestaetigen}
    | set(GEPLANT_IMMER_BESTAETIGEN)
)

#: Was loescht und trotzdem im autonomen Modus ohne Karte laeuft: nur die
#: eigenen Daten des Benutzers (Vorgabe des Betreibers vom 25.09.2026). Eine
#: ausdrueckliche Aufzaehlung, keine Regel — ein neues Loeschwerkzeug muss hier
#: oder bei `immer_bestaetigen` stehen
#: (`test_jedes_loeschwerkzeug_ist_entschieden`).
EIGENE_DATEN_LOESCHEN = frozenset({
    "forget_skill",
    "propose_note_delete",
    "propose_calendar_event_delete",
    "propose_task_delete",
    "propose_cloudflare_dns_delete",
})

#: Was die Rechte anderer Benutzer aendert. Nur ein Worker (oder ein Chat ohne
#: Gehirn/Worker-Teilung) ruft diese Werkzeuge selbst; das Gehirn und die
#: Stimme uebergeben sie mit `worker_start`. Der Umweg ueber
#: `execute_server_action` reicht sie deshalb nicht weiter
#: (`ai_voice.voice_dispatcher`).
RECHTE_SCHREIBEN = frozenset({
    "propose_user_server_permission",
    "propose_role_set",
    "propose_user_roles",
    "propose_role_delete",
})


def verlangt_klick(name: object, vorschau: object = None) -> bool:
    """Ob dieser eine Vorschlag auch im autonomen Modus bestaetigt werden muss.

    Das Gegenstueck zu `ALWAYS_CONFIRM_TOOLS` fuer Werkzeuge, bei denen es am
    Aufruf haengt: eine Rechtevergabe an einen Benutzer fragt, sobald sie etwas
    entzieht oder mehr als unkritische Serverrechte vergibt. Entschieden hat das
    der Payload-Bau, und zwar aus dem Bestand, nicht aus Modelltext — er setzt
    `always_confirm` in die Vorschau.

    Der Name stammt aus der Zeit, als die Stimme manches per Ja und manches nur
    per Klick bestaetigte. Seit dem 25.09.2026 ist jede Bestaetigung ein Klick
    (`ai_voice.interactions.klick_noetig`); die Frage hier ist nur noch, ob
    ueberhaupt eine Karte kommt.
    """
    if name in ALWAYS_CONFIRM_TOOLS:
        return True
    return isinstance(vorschau, dict) and vorschau.get("always_confirm") is True


# ── Gehirn und Worker (docs/agentic-framework.md, Abschnitt 3) ────────────
#
# Die Steuerwerkzeuge des Gehirns — ausgeschrieben und nicht als
# `_mit_gruppe("worker")` abgeleitet: `wait_until` und `worker_frage` tragen
# dieselbe Gruppe, sind aber ausdruecklich **keine** Gehirn-Werkzeuge.
WORKER_STEUERUNG = frozenset({"worker_start", "worker_cancel", "worker_antwort"})
VOICE_CONTROL_TOOLS = frozenset(_mit_art("voice_control"))

# Was nur in einem Worker-Lauf etwas zu suchen hat.
NUR_WORKER = frozenset({"wait_until", "worker_frage"})

# Der eigene Rechner, soweit ihn das Gehirn selbst anfasst.
#
# Betreiber-Entscheid 23.08.2026, woertlich: *"da computer use eh nur in der
# Tauri-App sein wird, wird es das Orchestrator bekommen."* Vorher lag beides
# beim Worker, und das hatte eine Folge, die im Gespraech deutlich wurde: auf
# "schau mal auf meinen Bildschirm" musste das Gehirn einen Auftrag starten,
# der hinsah, und bekam einen **Text** zurueck. Das Bild selbst erreichte es
# nie — es antwortete aus zweiter Hand ueber eine Beschreibung, die ein
# anderes Modell geschrieben hatte. Genau der Flaschenhals, den der Bericht
# ohnehin schon darstellt, nur bei der einen Sache, bei der er am meisten
# kostet.
#
# `desktop_dateien` und `desktop_aufraeumen` bleiben draussen: das ist
# Hintergrund- und Loescharbeit, und die delegiert das Gehirn. Sehen, zeigen
# (`desktop_system`, `desktop_steuern`) und lokale Programme/Spiele/URLs
# starten (`desktop_launch_app`) gehoeren dem Computer-Use direkt am Rechner.
#
# Erreichbar sind sie ohnehin nur aus der App (`herkunft_schnitt`) — aus dem
# Panel bleibt der Katalog des Gehirns exakt der von vorher.
GEHIRN_DESKTOP = frozenset({"desktop_system", "desktop_steuern", "desktop_launch_app"})

# Der komplette Katalog des Gehirns.
# Das Gehirn hat vollen Lesezugriff auf alle Server-, System-, Doku-,
# Recherche-, Skill- und Gedächtniswerkzeuge sowie Computer-Use und Dialoge.
# Es führt keine direkten Server-Schreibaktionen aus (diese delegiert es an Worker),
# kann aber alle realen Serverdaten, Logs, Metriken und Webquellen direkt abfragen.
GEHIRN_TOOLS = (
    frozenset(SERVER_READ_TOOLS)
    | frozenset(_mit_art("global_read"))
    | frozenset(MEMORY_TOOLS)
    | frozenset(SKILL_TOOLS)
    | frozenset(DOCUMENTS_READ_TOOLS)
    | WORKER_STEUERUNG
    | GEHIRN_DESKTOP
    | CHAT_INTERACTION_TOOLS
) - NUR_WORKER - {"ask_user"}


def docs_kontext_schnitt(team_mitglied: bool = False) -> set[str]:
    """Werkzeuge, die in einem Dokument-Lauf uebrig bleiben.

    Ein Dokumenttext ist Daten, keine Anweisung. Deshalb gilt eine geschlossene
    Aufzaehlung statt einer Ableitung aus allen Lesewerkzeugen. Die
    Dokument-KI bearbeitet das Dokument direkt; es gibt keinen Worker, keine
    Delegation und keinen Desktop-Weg.

    ``team_mitglied`` entscheidet ueber echtes Teamwissen. Ein Link-Gast mit
    Editor-Recht am Dokument darf den Text aendern, aber nicht das Gedaechtnis,
    die Notizen, den Kalender oder die Skills des Teams lesen. Das wird hier
    und in jedem Handler erneut geprueft, weil eine Mitgliedschaft waehrend
    eines Laufs entzogen werden kann.

    Die Rechtepruefung bleibt die Autoritaet: `angebotene_werkzeuge` filtert
    vorher nach `ai.notes.use`, `ai.calendar.use`, `ai.memory.use`,
    `ai.skills.use` und `ai.docs.use`. Diese Menge ersetzt kein Recht.
    """
    # `list_documents` bleibt draußen: Der Lauf haengt an genau einem Dokument,
    # und ohne Teambezug (persoenliches Dokument) wuerde die Liste sogar
    # Dokumente anderer Teams nennen. `read_document` ist an die UID des Laufs
    # gebunden und bleibt.
    erlaubt = (
        set(DOCUMENTS_TOOLS)
        - set(DOCS_TEAM_TOOLS)
        - {"list_documents"}
    ) | set(DOCS_ECOSYSTEM_READ)
    if team_mitglied:
        erlaubt |= set(DOCS_TEAM_TOOLS)
    return erlaubt


def worker_ausschluss() -> frozenset[str]:
    """Was ein Worker-Lauf vom vollen Katalog **nicht** bekommt.

    Ein Worker ist der beauftragte Stellvertreter eines Chats — deshalb wird
    hier subtrahiert statt aufgezaehlt, anders als bei Guardian und Aufgaben:
    dort loest ein Ereignis ohne Menschen den Lauf aus, hier hat ein Mensch
    den Auftrag soeben getippt und das Gehirn ihn deklariert. Ein kuenftiges
    Werkzeug soll dem Worker automatisch zufallen, wie es dem Chat zufaellt.

    Ausgeschlossen sind:

    * die Gehirn-Steuerung — keine Worker-Tiefe > 1: ein Auftrag, der
      Auftraege anlegt, waere ein Auftrag ohne Ende (dieselbe Regel, die
      `AUFGABEN_*` fuer die Aufgabenwerkzeuge ausschreibt);
    * `ask_user` **namentlich** und nicht als `ASK_TOOLS` — `worker_frage`
      liegt selbst darin und ist gerade der Ersatz: der Worker fragt ueber
      die Meldestelle, nie direkt in ein Gespraech hinein;
    * die Memory-Werkzeuge — Datenminimierung: ein Worker arbeitet einen
      Auftrag ab und soll keine persoenlichen Erinnerungen lesen. Sein
      Wissen steht im Auftragstext, den das Gehirn formuliert hat.
      Geschrieben wird das Gedaechtnis ohnehin nur noch aus dem Gespraech
      mit dem Menschen (`ai_gedaechtnis_schreiber`).

    Als Funktion nach dem Vorbild von `aufgaben_tools`: die Fallunterscheidung
    wohnt in der Registry, nicht beim Aufrufer.
    """
    return frozenset(MEMORY_TOOLS) | WORKER_STEUERUNG | {
        "ask_user", "control_region_camera",
    }


# Was ein von Guardian ausgeloester Heilungslauf ueberhaupt aufrufen darf.
#
# Diese Menge ist **keine Ableitung** aus den Spalten oben, sondern eine
# ausdrueckliche Aufzaehlung — und das ist Absicht. Eine Ableitung waere eine
# Regel ("alles Lesende plus alles Umkehrbare"), und jedes kuenftige Werkzeug
# faende sich stillschweigend darin wieder. Hier soll es umgekehrt sein: wer ein
# Werkzeug in die unbeaufsichtigte Heilung aufnehmen will, schreibt es hin.
#
# Der Grund ist die Bedrohungslage dieses Laufs. Er beginnt nicht mit einer Bitte
# eines Menschen, sondern mit einem Ereignis auf einem Server, auf dem Fremde
# spielen. Was das Modell dort liest — Logzeilen, Dateiinhalte — kann jemand
# geschrieben haben, der genau darauf hofft. Der Prompt sagt dem Modell, dass es
# Weisungen darin nicht befolgen soll; diese Menge sorgt dafuer, dass es sie auch
# dann nicht kann, wenn es sie befolgen wollte.
#
# Deshalb fehlen hier: Gedaechtnis und Skills (das Modell soll sich aus einem
# Vorfall nichts Dauerhaftes anlernen — und auch nichts lesen, was ihm ein
# anderes Gespräch in die Hand gelegt hat; solange `read_skill` fehlt, lässt
# `ai_context_service._skill_index_block` das Skill-Verzeichnis aus dem Prompt
# eines solchen Laufs weg), die Hoster-Werkzeuge (Rechte und
# Schluessel), `propose_server_create`/`propose_server_delete` (Reichweite ueber
# den Vorfall hinaus) und `web_search` (der Name eines selbstgebauten Servers
# hat draussen nichts zu suchen — schon gar nicht, wenn ihn niemand gefragt hat).
#
# `propose_blueprint_delete` fehlt aus beiden Gruenden zugleich: ein Blueprint
# gilt fuer **alle** Server seines `game_type` und nicht nur fuer den einen, auf
# dem der Vorfall passiert ist — und weg ist er ohne Rueckweg, weshalb er
# ohnehin in `ALWAYS_CONFIRM_TOOLS` steht. Eine Heilung, die als Nebenwirkung
# die Vorlage fremder Server entfernt, ist keine.
#
# ── Drei Zugaenge, die seit `20260816_13` dazugehoeren ────────────────────
#
# `propose_guardian_tuning` ist der dritte der drei Faelle, die eine Reparatur
# auseinanderhalten muss: Guardian hat sich nicht geirrt, und der Server ist
# nicht kaputt — Guardian ist **fuer diesen Server** falsch eingestellt. Ohne
# dieses Werkzeug konnte die KI genau das nicht beheben und schrieb stattdessen
# "ich kann den Vorfall nicht schliessen, solange weiter Restarts gemeldet
# werden". Umkehrbar (`reset`), sichtbar im Guardian-Reiter, und begrenzt auf
# eine geschlossene Menge geklemmter Zahlen.
#
# `list_blueprints` und `propose_blueprint_change` legen eine **neue Datei** an
# und ruehren keinen laufenden Server an. Eine Ableitung ist der Weg fuer den
# Fall, in dem wirklich die Vorlage falsch ist — eine Startzeile, die im
# aktuellen Image nicht mehr stimmt. Sie wird abgeleitet, angepasst und steht
# danach zur Ansicht bereit; was **noch nichts** tut, ist sie in Betrieb zu
# nehmen.
#
# Der Wechsel selbst bleibt genau deshalb draussen und traegt seit derselben
# Aenderung `immer_bestaetigen`: `switch_server_blueprint` ist keine Umhaengung,
# sondern eine Neuinstallation mit `wipe_server_root` — Welt, Configs und Mods
# sind danach weg. Fuer eine zu knapp bemessene Startzeit die Welt zu loeschen
# ist keine Behebung, und ein unbeaufsichtigter Lauf darf das nie ohne einen
# Menschen tun.
GUARDIAN_HEILUNG_TOOLS = frozenset({
    # Sehen, was los ist.
    "read_server_status",
    "read_server_capacity",
    "read_server_logs",
    "read_config",
    "read_server_ports",
    "read_server_network",
    "check_server_reachability",
    "read_server_mods",
    "list_server_files",
    "search_server_files",
    "read_server_backups",
    "read_guardian_incidents",
    "read_ai_action_history",
    "read_node_health",
    "read_blueprint",
    "list_blueprints",
    "search_docs",
    "read_docs",
    # Handeln.
    "propose_backup",
    "propose_server_lifecycle",
    "propose_config_patch",
    "propose_config_set",
    "propose_config_update",
    "propose_file_delete",
    "propose_server_repair",
    "propose_guardian_tuning",
    "propose_blueprint_change",
    "propose_bind_ip_update",
    "propose_mod_install",
    # Eine kaputte Mod ist ein klassischer Grund, warum ein Server nicht mehr
    # hochkommt. Sie auszuschalten ist der schonendere Eingriff als sie neu
    # einzuspielen (`propose_mod_install`, steht schon hier): es faellt keine
    # Datei an und keine weg, nur die Startzeile aendert sich.
    "propose_mod_toggle",
})


#: Werkzeuge, die der KI Interaktion mit der Guardian Engine ermöglichen.
#: Sind bei deaktivierter Guardian-KI-Integration panelweit ausgeschlossen.
GUARDIAN_TOOLS = frozenset({
    "read_guardian_incidents",
    "propose_guardian_tuning",
})



# Werkzeuge, die in einem Heilungslauf ein nachweislich geglecktes Backup
# voraussetzen — juenger als der Vorfall, mit gesetztem `verified_at`.
#
# Enthalten ist alles, was den Zustand des Servers **veraendert**, nicht nur was
# ihn zerstoert. Auch ein Patch an der falschen Stelle macht eine Welt
# unbrauchbar, und die Vorgabe des Betreibers lautete ausdruecklich: erst
# sichern, dann anfassen.
#
# Nicht enthalten sind vier, jedes mit seinem eigenen Grund:
#
# * `propose_backup` selbst — das waere ein Zirkel.
# * `propose_server_lifecycle` — ein Neustart aendert keine Datei, und ihn
#   hinter ein Backup zu stellen hiesse, den haeufigsten und harmlosesten
#   Heilungsschritt genau dann zu blockieren, wenn die Platte voll ist und
#   deshalb kein Backup gelingt.
# * `propose_guardian_tuning` — es aendert eine Spalte am Server, keine Datei
#   auf ihm. Der Rueckweg ist `reset`, und er kostet nichts. Dieselbe
#   Ueberlegung wie beim Neustart, nur noch deutlicher: waere es hinter der
#   Schranke, koennte die KI ausgerechnet dann nicht mehr nachjustieren, wenn
#   der Server so kaputt ist, dass kein Backup mehr durchgeht.
# * `propose_blueprint_change` — es legt eine **neue Blueprint-Datei** im Panel
#   an und ruehrt keinen Server an. Ein Serverbackup bewiese darueber gar
#   nichts; der Rueckweg ist, die Datei nicht in Betrieb zu nehmen.
# Was ein faellig gewordener stehender Auftrag aufrufen darf.
#
# Wie `GUARDIAN_HEILUNG_TOOLS` eine **ausgeschriebene** Aufzaehlung und keine
# Ableitung, aus demselben Grund: ein kuenftiges Werkzeug soll sich nicht
# stillschweigend in einem Lauf wiederfinden, bei dem niemand zusieht. Wer eines
# aufnehmen will, schreibt es hin.
#
# Die Bedrohungslage ist eine **andere** als beim Guardian, und deshalb ist die
# Menge groesser. Ein Heilungslauf beginnt mit einem Ereignis auf einem Server,
# auf dem Fremde spielen; hier beginnt er mit einem Satz, den ein Mensch getippt
# und anschliessend an einer Vorschlagskarte bestaetigt hat. Was das Modell
# **waehrend** des Laufs liest, ist trotzdem dasselbe unvertrauenswuerdige
# Material — deshalb bleibt die Menge trotzdem eng.
#
# Enthalten ist alles Lesende ausser den Hoster-Werkzeugen (Rechte und
# Schluessel gehoeren nicht in einen unbeaufsichtigten Lauf) und ausser
# `send_test_email` (ein stehender Auftrag, der Testmails verschickt, ist eine
# naechtliche Mailschleife).
#
# `web_search` ist ausdruecklich dabei, anders als beim Guardian. Dort fehlt es,
# weil niemand gefragt hat; hier hat jemand gefragt — der Betreiber hat "sag mir
# taeglich, wie das Wetter wird" als Beispiel genannt. Eine zusaetzliche
# Schranke gibt es nicht mehr: die frueher hier genannte Herkunftspruefung
# (`docs_searchable`) ist ersatzlos gefallen, weil sie einen Server mit
# oeffentlich dokumentiertem Spiel gesperrt hat. Was hinausgeht, schuetzt jetzt
# die Schwaerzung der Suchanfrage in `_execute_web_search`.
#
# Nicht enthalten: Gedaechtnis und Skills. Was das Modell hier liest, kann ein
# Spieler in ein Log geschrieben haben, und aus einem Lauf ohne Zeugen soll
# nichts Dauerhaftes gelernt werden. Der Gedaechtnisblock im Kontext kommt
# ohnehin von selbst mit — es fehlt also nichts. Das Skill-Verzeichnis kommt
# umgekehrt **nicht** mit: solange `read_skill` hier fehlt, lässt
# `ai_context_service._skill_index_block` es aus dem Prompt weg, statt zum
# Lesen aufzufordern.
#
# `ask_user` fehlt, weil niemand davorsitzt. Das ist keine Sparmassnahme: eine
# unbeantwortbare Rueckfrage haette den Lauf bis zum Ablauf geparkt und die
# Aufgabe damit still ausfallen lassen.
AUFGABEN_LESEN = frozenset({
    "read_server_status",
    "read_server_capacity",
    "read_server_logs",
    "read_config",
    "read_server_ports",
    "read_server_network",
    "check_server_reachability",
    "read_server_mods",
    "read_mod_updates",
    "search_workshop_mods",
    "list_server_files",
    "search_server_files",
    "read_server_backups",
    "read_guardian_incidents",
    "read_ai_action_history",
    "list_my_servers",
    "list_blueprints",
    "read_blueprint",
    "read_node_capacity",
    "read_node_health",
    "search_docs",
    "read_docs",
    "web_search",
    "read_web_page",
    "analyze_region",
    "email_search",
    "email_read",
    "calendar_read",
    # Damit ein Auftrag ueber die eigenen Auftraege berichten kann. Liest
    # ausschliesslich, was diesem Benutzer gehoert.
    "list_tasks",
})


# Was zusaetzlich erlaubt ist, wenn die Aufgabe als `kind='act'` angelegt wurde.
#
# Diese Werkzeuge laufen im faelligen Lauf **nicht** kraft dieser Menge, sondern
# weiterhin nur, soweit `autonomy_allows` es zulaesst: erteilte Freigabe, Budget
# der Stunde, Recht des Benutzers am konkreten Server. Die Menge hier ist die
# aeussere Grenze, nicht die Erlaubnis.
#
# Nicht enthalten, jeweils mit Grund:
#
# * `propose_backup_restore`, `propose_server_delete` — stehen in
#   `ALWAYS_CONFIRM_TOOLS` und wuerden ohnehin abgewiesen. Sie hier
#   aufzuzaehlen hiesse, zwei Orte zu pflegen.
# * `propose_server_create`, `propose_blueprint_change`,
#   `propose_server_blueprint_switch` — Reichweite ueber den Auftrag hinaus. Der
#   Wechsel loescht zudem das gesamte Serververzeichnis; ein nachts angestossener
#   Blueprintwechsel ist nichts, was jemand mit "mach das taeglich" gemeint hat.
# * `propose_file_delete` — steht seit dem 23.09.2026 in `ALWAYS_CONFIRM_TOOLS`
#   wie jedes Loeschen. Es fehlte hier schon vorher, mit eigenem Grund: im
#   Guardian-Lauf steht davor ein nachgewiesenes Backup als Schranke. Diesen
#   Anker gibt es hier nicht, denn eine Aufgabe hat keinen Vorfall, ab dem
#   gerechnet wuerde. Eine stehende Anweisung, die Nacht fuer Nacht Dateien
#   loescht, ist genau der Fall, fuer den jemand davorsitzen soll.
# * die Hoster- und Aufgabenwerkzeuge — Rechte, Schluessel, und ein Auftrag, der
#   Auftraege anlegt, waere ein Auftrag ohne Ende.
# * `propose_blueprint_delete` — steht wie `propose_backup_restore` und
#   `propose_server_delete` in `ALWAYS_CONFIRM_TOOLS` und waere ohnehin
#   abgewiesen. Genannt sei es trotzdem, weil der Grund hier ein zusaetzlicher
#   ist: eine Aufgabe laeuft nachts und wieder und wieder, ein Blueprint aber
#   gilt fuer alle Server seines `game_type`. Was ein stehender Auftrag hier
#   entfernte, faellt erst auf, wenn der naechste Server nicht mehr startet.
AUFGABEN_HANDELN = frozenset({
    "propose_server_lifecycle",
    "propose_backup",
    "propose_config_update",
    "propose_config_patch",
    "propose_config_set",
    "propose_mod_install",
    # "Schalte die Event-Mod am Samstag ein und am Montag wieder aus" ist eine
    # stehende Anweisung wie jede andere. Ohne das Werkzeug haette die Aufgabe
    # den Weg ueber `propose_mod_install` nehmen muessen — mehr Wirkung fuer
    # weniger Absicht.
    "propose_mod_toggle",
    "propose_bind_ip_update",
    "propose_server_repair",
    # Der Durchgriff auf die eingebauten Zeitpläne. Anders als die
    # Aufgabenwerkzeuge (bewusst ausgeschlossen, siehe oben) legt das keinen
    # neuen Auftrag an — es stellt die Felder, die der Benutzer im Panel sieht.
    "propose_restart_schedule_set",
    "propose_backup_schedule_set",
    # E-Mail und Kalender: Zeitgesteuerte E-Mails oder Terminänderungen über
    # stehende Aufgaben (`propose_task_set` mit `kind="act"`). Termine löschen
    # steht wie Server/Backups in ALWAYS_CONFIRM_TOOLS und bleibt draussen.
    "propose_email_send",
    "propose_calendar_event_create",
    "propose_calendar_event_update",
})


def herkunft_schnitt(erlaubt: frozenset[str], herkunft: str) -> frozenset[str]:
    """Was eine Herkunft vom Katalog abzieht — nur **eine** Richtung.

    Aus der Smart-System-App bekommt die KI alles, was der Benutzer darf, und
    die Desktop-Werkzeuge obendrauf. Das ist derselbe Account und dieselbe
    Unterhaltung; die App ist kein zweites, kleineres Panel, sondern derselbe
    Zugang mit einem Rechner daran.

    Hier stand bis zum 21.08.2026 das Gegenteil: aus der App seien alle
    Serverwerkzeuge entfernt, mit Hoster-Neutralitaet begruendet. Das war eine
    Fehllesung eines aelteren Beschlusses. Gemeint war, dass die App **als
    Oberflaeche** keine Serververwaltung anbietet — sie zeigt Chat und
    Sprache, keine Serverliste. Was die KI darin darf, richtet sich wie
    ueberall nach den Rechten des Benutzers.

    Umgekehrt bleibt es dabei: **aus dem Panel erreicht sie keinen Rechner.**
    Die Desktop-Werkzeuge setzen voraus, dass die App laeuft und jemand davor
    sitzt — die Uebernahme wird an einer Karte in der App bestaetigt, nicht im
    Browser. Aus dem Browser abgeschickt liefen sie in die Frist statt in eine
    Antwort. Und es haelt einen uebernommenen Browser-Tab davon ab, Maus und
    Tastatur des Rechners zu verlangen.

    **Eine Ausnahme, bewusst:** ein Auftrag, den der Benutzer in der App
    erteilt hat, behaelt seine Herkunft, auch wenn die Fortsetzung aus dem
    Panel kommt (`worker_antwort` liest sie aus dem Zustand des Vorgaengers,
    nicht vom Aufrufer). Die Herkunft gehoert dem **Fenster**, nicht dem
    einzelnen Lauf — sonst verloere ein App-Auftrag mitten im Vorgang seine
    Werkzeuge, sobald ihn irgendetwas aus dem Panel weiterschiebt, und das
    tut die Meldestelle regelmaessig von selbst.
    Der Preis ist benannt: wer eine Panel-Sitzung uebernimmt, kann einen noch
    offenen App-Auftrag mit neuem Text weitersteuern. Was er damit erreicht,
    ist die Sandbox und ein lesender Blick auf das System; Maus und Tastatur
    bleiben aussen vor, denn die Uebernahme wird unabhaengig davon an einer
    Karte **in der App** bestaetigt. Und laeuft die App nicht, verfaellt der
    Auftrag mit seiner Frist.

    Das ist ein Schnitt, keine Ersetzung: ein fehlendes Recht holt hier
    niemand zurueck.
    """
    if herkunft == "desktop":
        return frozenset(erlaubt)
    return frozenset(erlaubt) - DESKTOP_TOOLS


def aufgaben_tools(kind: str) -> frozenset[str]:
    """Die Werkzeugmenge eines faelligen Laufs, je nach Art der Aufgabe.

    ``report`` liest und berichtet, ``act`` darf zusaetzlich handeln. Die
    Fallunterscheidung steht hier und nicht beim Aufrufer: sonst gaebe es zwei
    Stellen, an denen jemand die Vereinigung bilden koennte, und eine davon
    vergaesse irgendwann die Bedingung.
    """
    if kind == "act":
        return AUFGABEN_LESEN | AUFGABEN_HANDELN
    return AUFGABEN_LESEN


# Hier standen `SPRACHE_LESEN`, `SPRACHE_HANDELN` und `sprache_tools()`.
#
# Sie waren die Werkzeugmenge eines **zweiten** Modells: bis zum 16.08.2026
# antwortete im Sprachmodus OpenAIs Realtime-API mit eigenem Werkzeuglauf, und
# die Menge trug der Lage Rechnung, dass dort jemand redet, aber **nichts
# sieht** — kein `ask_user` (eine Karte, die niemand hoert), keine
# Hosterwerkzeuge, kein `learn_skill`.
#
# Beide Voraussetzungen sind entfallen. Es gibt kein zweites Modell mehr; der
# Sprachmodus benutzt denselben Lauf wie der getippte Chat. Und der Sprechende
# sieht sehr wohl etwas: die Sprachansicht liegt im Panel, Belege und
# Vorschlagskarten erscheinen darin (`ai_voice_bridge`). Eine eigene Menge waere
# heute eine vierte Liste, die niemand pflegt — und die beim naechsten neuen
# Werkzeug still veraltet.
#
# Mit ihnen ist der Parameter ``sprache`` aus `create_proposal` gefallen. Ob
# ein gesprochenes Ja reicht, entscheidet seitdem `ai_voice.interactions`: es
# reicht fuer alles ausser `ALWAYS_CONFIRM_TOOLS`. Dort verlangt die Stimme den
# Klick auf die Karte, Betreiberwahl vom 23.09.2026 ("Klick auf die Karte"):
# ein Ja koennte das Modell auch aus einer Webseite oder Mail "gehoert" haben.
# Alles andere bleibt: `confirm_proposal` prueft die Rechte erneut,
# `execute_proposal` ein drittes Mal, der Einmal-Token wird atomar entwertet,
# das Audit vermerkt den Vorgang.


# `propose_mod_toggle` fehlt hier mit Absicht, obwohl es in
# `GUARDIAN_HEILUNG_TOOLS` steht: der Schalter beruehrt keine Datei. Die Mod
# bleibt liegen, nur die Startzeile aendert sich — es gaebe nichts
# zurueckzuspielen, und ein Backup zu verlangen hiesse, eine Heilung an einer
# Bedingung scheitern zu lassen, die ihren Zweck hier nicht erfuellt.
GUARDIAN_BACKUP_PFLICHT_TOOLS = frozenset({
    "propose_config_patch",
    "propose_config_set",
    "propose_config_update",
    "propose_file_delete",
    "propose_server_repair",
    "propose_mod_install",
    "propose_bind_ip_update",
})


def bekannt(name: str) -> bool:
    return name in WERKZEUGE


def rollen_ausschluss(rolle: str) -> frozenset[str]:
    """Gemeinsame Schranke fuer direkte Aufrufe und Bestaetigungsvorschlaege.

    Gehirn-Leseaufrufe prueft der jeweilige Pfad gesondert gegen GEHIRN_TOOLS.
    """
    return worker_ausschluss() if rolle == "worker" else WORKER_STEUERUNG | NUR_WORKER
