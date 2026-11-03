# ADR-0011: Serverrechte im Team — Rollenmodus oder teamweite Freigabe

Status: Draft
Date: 2026-11-03

## Context

Der Teams-Reiter „Server" kennt einen Schalter „Serverrechte nach Rollen"
(`teams.server_roles_active`, Migration `20261103_04_team_server_roles`).
Recherchierter Ist-Stand (03.11.2026):

- Der Schalter wirkt in der Prüfung (`permission_service.py`,
  `_member_has_role_server_grant`): Aus = Team-Freigabe gilt für alle
  Mitglieder; An = nur Admin-Rollen und ausdrückliche
  `TeamRoleServerGrant`-Zeilen zählen, Team-Freigaben sind wirkungslos.
- Rollen können Serverrechte tragen: `TeamRoleServerGrant`-Modell,
  `TeamRoleWrite.server_grants`, Gründer-Deckel (nur Rechte, die der Gründer
  selbst direkt hält) und `server.view`-Pflicht sind im Backend fertig und
  getestet (`_pruefe_server_grant_sicht`, `test_team_permissions.py`).
- Die Oberfläche bildet das nicht ab: Der Server-Reiter zeigt bei An und Aus
  denselben Team-Freigaben-Editor — bei An ändert man wirkungslose Zeilen,
  ohne Hinweis und ohne Rollenauswahl. Das Rollenformular (`TeamRoleForm`)
  listet Serverrechte nur für Server, die bereits eine Team-Freigabe haben,
  und nur deren Keys (Henne-Ei bei aktivem Schalter).
- `server.view` ist Pflicht, sobald weitere Serverrechte vergeben werden
  (Backend antwortet sonst 422). Die Oberfläche wählt es nicht automatisch
  dazu — weder bei Team-Freigaben noch bei Rollen.
- Panel-Rechte (globale Rollen) bleiben außen vor: Über Team-Rollen werden
  keine Panel-Rechte vergeben. Der Gründer-Deckel gilt bereits.

Offen (Interview): alle Sachfragen gesetzt ([F1]–[F4]). Ausstehend: nur
noch die wörtliche Annahme dieses Vertragstextes.

## Decision

### [F1] Rollenmodus behalten und reparieren — gesetzt (03.11.2026)

Der Schalter `server_roles_active` bleibt. Das Backend (Rollen-Grants,
Gründer-Deckel, Durchsetzung) ist fertig und getestet; repariert wird die
Oberfläche: Server-Reiter, Rollenformular und `server.view`-Automatik (F2–F4).
Eine Entfernung steht nicht mehr zur Wahl.

### [F2] Server-Reiter passt sich dem Schalter an — gesetzt (03.11.2026)

Bei „Aus" bleibt der Team-Freigaben-Editor wie heute. Bei „An" zeigt der
Reiter pro Server eine Rollenauswahl mit Rechte-Editor je Rolle plus Hinweis,
dass Team-Freigaben pausiert sind. Es gibt keine wirkungslosen Bedienelemente
mehr; die Übersicht „wer darf was auf Server X" liegt an einem Ort.

### [F3] `server.view` wird automatisch dazu gewählt — gesetzt (03.11.2026)

Wählt der Gründer ein Serverrecht ohne `server.view`, wählt die Oberfläche
`server.view` sichtbar dazu (mit Hinweis auf die Notwendigkeit). `server.view`
lässt sich nicht abwählen, solange andere Rechte stehen. Gilt für
Team-Freigaben und Rollen-Freigaben gleichermaßen; das Backend bleibt der
Durchsetzer. Einzige harte Voraussetzung im Katalog ist `server.view` —
weitere Ketten gibt es nicht.

### [F4] Rollen schöpfen direkt aus dem Gründer-Deckel — gesetzt (03.11.2026)

Eine Rolle darf jeden Server und jedes Recht tragen, das der Gründer selbst
direkt hält (`assignable`-Liste); eine Team-Freigabe ist keine Voraussetzung
mehr. Team-Freigaben bedeuten nur noch: alle Mitglieder bei Schalter „Aus".
Das Henne-Ei (tote Team-Zeilen als Menügrundlage bei „An") entfällt; der
Gründer-Deckel für Rollen-Grants wird im Backend bereits geprüft.

## Begründung

- Das Backend (Rollen-Grants, Gründer-Deckel, Durchsetzung je Schalterstand)
  ist fertig und getestet; das Problem liegt ausschließlich in der
  Oberfläche. Reparieren statt Entfernen erhält getestete Sicherheitslogik.
- Ein Reiter, der je Schalterstand umschaltet, was er editiert, statt
  wirkungslose Zeilen zu zeigen, beseitigt die beobachtete Verwirrung („macht
  keinen Unterschied") an der Wurzel.
- Die `server.view`-Automatik tilgt eine komplette 422-Fehlerklasse an beiden
  Editoren, ohne die Backend-Regel anzutasten.
- Der Gründer-Deckel als einzige Quelle für Rollen-Rechte beseitigt das
  Henne-Ei und gibt Team-Freigaben genau eine Bedeutung zurück.

## Konsequenzen

- Spätere Umsetzung (eigenes Interview, nicht Teil dieses ADRs): Server-Reiter
  mit Rollen-Editor je Server bei „An"; `server.view`-Automatik in beiden
  Editoren; Rollenformular schöpft aus `assignable` statt `team.servers`.
- Bestehende Team-Freigaben bleiben unangetastet und gelten bei „Aus" wie
  bisher; bei „An" sind sie pausiert, aber sichtbar erklärt.
- Panel-Rechte bleiben außerhalb der Team-Rollen; daran ändert dieses ADR
  nichts.

## Geltungsbereich (Scope-Vertrag, Entwurf)

- Artefaktgrenze: nur dieses ADR (Draft → Final). Kein Laufzeit-Code, keine
  Tests, keine Migrationen, keine Folge-Specs.
- Fertig heißt: Alle [F]-Fragen sind entschieden oder ausdrücklich vertagt,
  der Vertragstext unten ist vom Eigentümer wörtlich angenommen.
- Spätere Stufen (Umsetzung) brauchen ein eigenes Interview; „Go" o. ä.
  erweitert diese Grenze nicht.
- Annahme-Zitat: _steht aus — keine wörtliche Annahme erteilt._
- Umsetzungsauftrag: Eigentümer sagte am 03.11.2026 „du kannst anfangen"
  (sinngemäßer Baustart für F2–F4, keine Formalannahme). Status bleibt Draft,
  bis die Annahme wörtlich vorliegt.
- Umsetzung (03.11.2026, separat beauftragt, Frontend only): `ServerRollenListe`
  in `Teams.tsx` (F2), `mitServerSicht` in `teamPermissionsCatalog.ts` plus
  Hinweise an beiden Editoren (F3), `TeamRoleForm` aus `assignable` mit
  Entfallen-Hinweis (F4). Tests: `Teams.test.tsx`, `TeamRoleForm.test.tsx`.
