# MSM auf Kubernetes

Reproduzierbare Bereitstellung der **MSM Control Plane** (Panel, DIS-Sidecar,
optional PostgreSQL) mit kontrollierten Rollouts, Wiederanlauf nach Ausfällen,
Ressourcengrenzen und Secrets, die nie im Klartext in Manifesten oder Logs
landen.

## Was das ist — und was ausdrücklich nicht

**Kubernetes betreibt hier die Control Plane, nicht die Gameserver.**

MSM führt Gameserver als Docker-Container über den `msm-agent` auf angebundenen
Hosts (Nodes) aus. Guardian, Lifecycle, Portvergabe, Bind-Mounts und die
Node-Isolation setzen genau darauf auf. Gameserver in Pods zu verwandeln wäre
kein Deployment-Thema, sondern ein Umbau dieser gesamten Schicht — und würde die
bestehende Self-Hosted-Installation brechen.

Deshalb gilt:

| | Läuft wo |
| --- | --- |
| Panel-API (`msm-panel`, ≥ 2 Replicas) | Kubernetes-Pod (`MSM_WORKER_MODE=api`) |
| Hintergrund-Worker (`msm-worker`, Singleton) | Kubernetes-Pod (`MSM_WORKER_MODE=worker`) |
| DIS-Sidecar (Krypto) | Container **im selben Pod** wie Panel und Worker |
| Redis | Kubernetes-Deployment (`25-redis.yaml`) für Backplane und Locks |
| PostgreSQL | Kubernetes-StatefulSet **oder** extern/managed (empfohlen) |
| Gameserver | Rootless Docker (`msm-docker`) über `msm-agent` auf den MSM-Nodes |

HTTP-, WebSocket- und SSE-Verkehr skaliert horizontal über `msm-panel`-Replicas;
Container-Kapazität wächst über weitere MSM-Nodes.

### Rootless Docker und Privilegientrennung auf den Nodes

Auf den Node-Hosts laufen die drei Konten getrennt (`msm`, `msm-agent`,
`msm-docker`). Der Docker-Socket gehört ausschließlich `msm-docker`, liegt unter
`/run/user/<uid>/docker.sock` und wird per POSIX-ACL nur für `msm-agent`
freigeschaltet (`chmod 0710` auf `/opt/msm/servers`, `cap-drop`,
`no-new-privileges`, `icc: false`).

Dieser Socket gehört zu einer User-Systemd-Session auf einem Node-Host. **In
einem Kubernetes-Pod existiert er nicht** — und ihn per `hostPath` hineinzureichen
würde die Trennung zwischen Control Plane und Workloads aufheben.

Deshalb setzt [`30-config.yaml`](30-config.yaml) `MSM_LOCAL_AGENT_ENABLED: "false"`.
Das Panel ist im Cluster reine Control Plane und niemals selbst ein Node.
`test_panel_pod_never_acts_as_a_node_itself` schreibt den Wert fest und prüft
zusätzlich, dass kein Manifest einen Docker-Socket in den Pod mountet.

## Aufgabenteilung: API-Pods und Singleton-Worker

`msm-panel` läuft mit mindestens 2 Replicas (`strategy: RollingUpdate`) und
`MSM_WORKER_MODE=api`. Alle Event-Streams (Chat, Server-Logs, Node-Status),
Presence-Einträge, verteilte Rate-Limits und Lifecycle-Sperren laufen über Redis
(`25-redis.yaml`).

`msm-worker` (`45-worker.yaml`) läuft genau einmal (`replicas: 1`, `strategy:
Recreate`, `MSM_WORKER_MODE=worker`) und übernimmt APScheduler-Jobs
(Auto-Restart, Backups, Guardian-Reconciliation, Hoster-Webhooks,
Node-Heartbeats) sowie PostgreSQL-Advisory-Locks. Dadurch entstehen keine
doppelten Jobs bei Zero-Downtime-Rollouts der API-Pods.

## Voraussetzungen

- Kubernetes ≥ 1.27
- Ein Ingress-Controller mit TLS (das Panel setzt `__Secure-`-Cookies und
  funktioniert nur über HTTPS)
- Panel-Image, das Backend **und** gebautes Frontend enthält, sowie ein
  DIS-Sidecar-Image (siehe `docs/self-hosting.md` zu den Release-Artefakten)
- Netzwerkweg vom Panel zu den `msm-agent`-Hosts (ausgehend, TLS)

## Installation

```bash
kubectl apply -f deploy/kubernetes/00-namespace.yaml
```

Secrets **nicht** aus einer Datei im Repository anlegen. Entweder über einen
externen Secret-Manager (External Secrets Operator, Vault, SOPS) oder direkt:

```bash
kubectl -n msm create secret generic msm-secrets \
  --from-literal=MSM_SECRET_KEY="$(openssl rand -hex 32)" \
  --from-literal=MSM_DIS_SIDECAR_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=MSM_DIS_SALT="$(openssl rand -hex 16)" \
  --from-literal=MSM_DATABASE_URL='postgresql+psycopg2://msm:PASSWORT@msm-postgres:5432/msm' \
  --from-literal=MSM_DATABASE_URL_ASYNC='postgresql+asyncpg://msm:PASSWORT@msm-postgres:5432/msm' \
  --from-literal=POSTGRES_PASSWORD='PASSWORT' \
  --from-literal=MSM_REDIS_PASSWORD='REDIS_PASSWORT' \
  --from-literal=MSM_REDIS_URL='redis://:REDIS_PASSWORT@msm-redis:6379/0'
```

`10-secrets.example.yaml` ist nur eine **Feldreferenz** und enthält bewusst
keine verwendbaren Werte.

Danach:

```bash
kubectl apply -f deploy/kubernetes/20-postgres.yaml     # entfällt bei externer DB
kubectl apply -f deploy/kubernetes/25-redis.yaml
kubectl apply -f deploy/kubernetes/30-config.yaml
kubectl apply -f deploy/kubernetes/40-panel.yaml
kubectl apply -f deploy/kubernetes/45-worker.yaml
kubectl apply -f deploy/kubernetes/50-ingress.yaml
kubectl apply -f deploy/kubernetes/60-networkpolicy.yaml
```

Oder gesammelt:

```bash
kubectl apply -k deploy/kubernetes
```

## Nodes anbinden

Unverändert gegenüber der klassischen Installation: Der `msm-agent` wird auf dem
Host installiert und im Panel unter **Administration → Nodes** verbunden. Siehe
[`docs/self-hosting.md`](../../docs/self-hosting.md#einen-neuen-node-verbinden).
Kubernetes ändert daran nichts — die Node-Hosts müssen keine Cluster-Mitglieder
sein.

## Updates und Rollback

```bash
# Update
kubectl -n msm set image deployment/msm-panel panel=<registry>/msm-panel:<neue-version>
kubectl -n msm rollout status deployment/msm-panel

# Rollback
kubectl -n msm rollout undo deployment/msm-panel
```

**Wichtig:** Datenbankmigrationen laufen beim Panel-Start. Ein Rollback auf ein
älteres Image nach einer bereits angewendeten Migration ist nicht automatisch
sicher. Vor einem Update ein Panel-Backup ziehen
(Administration → Panel-Backups) und die Migrationshinweise der Release-Notes
lesen.

## Secrets im Betrieb

- Alle Geheimnisse kommen als `secretKeyRef` aus dem Secret, nie als
  Literal in einem Manifest, nie in einer ConfigMap.
- Der DIS-Sidecar lauscht ausschließlich auf `127.0.0.1`. Er ist deshalb ein
  Container **im selben Pod** — es gibt bewusst keinen Service und keinen
  ClusterIP für ihn. Damit ist die Krypto-Schnittstelle für andere Pods
  unerreichbar.
- Rotation von `MSM_SECRET_KEY` ist **nicht** ohne Weiteres möglich: damit
  verschlüsselte Werte (E-Mail-Adressen, gespeicherte Zugangsdaten) wären danach
  nicht mehr lesbar. Siehe `docs/self-hosting.md` zur Secret-Rotation.

## Beobachtbarkeit

`GET /api/health` liefert `{"status": "ok"}`, sobald der Prozess bereit ist, und
wird als Readiness- und Liveness-Probe verwendet. Der Serverzustand selbst
gehört in das Panel und in die Guardian-Ansicht — nicht in Kubernetes-Probes:
ein fehlgeschlagener Gameserver ist kein ungesunder Panel-Pod.
