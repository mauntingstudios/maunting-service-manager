import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Database,
  Download,
  FileText,
  Hammer,
  HardDrive,
  Menu,
  Network,
  Package,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Shield,
  Sliders,
  Square,
  Terminal,
  Trash2,
  Webhook,
} from "lucide-react";
import { api, getRateLimitRemainingMs } from "@/api/client";
import { toast } from "@/stores/toastStore";
import { confirm } from "@/stores/confirmStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useServerPreferencesStore } from "@/stores/serverPreferencesStore";
import { useHostInterfaces } from "@/hooks/useHostInterfaces";
import { useHasPermission } from "@/hooks/useHasPermission";
import { ResourceEditorDialog } from "@/components/server/ResourceEditorDialog";
import { FileManager } from "./FileManager";
import { ModManager } from "./ModManager";
import { Backups } from "./Backups";
import { ServerConsolePanel } from "@/components/server/ServerConsolePanel";
import { ServerRestartPanel } from "@/components/server/ServerRestartPanel";
import { AuthSetupBanner } from "@/components/server/AuthSetupBanner";
import { ServerConnectChip } from "@/components/server/ServerConnectChip";
import { ServerTechnikPanel } from "@/components/server/ServerTechnikPanel";
import { ServerDetailTabs, type ServerDetailTab } from "@/components/server/ServerDetailTabs";
import {
  ActionMenu,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Kurzinfo,
  Spinner,
  Switch,
  type ActionMenuItem,
  type DropdownOption,
} from '@maunting/ui'
import { DatabaseManager } from "@/components/server/DatabaseManager";
import { OutgoingWebhooksPanel } from "@/components/server/OutgoingWebhooksPanel";
import { frontendApi, type FrontendOverview } from "@/api/frontend";
import { SwitchBlueprintDialog } from "@/components/server/SwitchBlueprintDialog";

const DeploymentsPanel = lazy(() =>
  import("@/components/frontend/DeploymentsPanel").then((m) => ({
    default: m.DeploymentsPanel,
  })),
);
const FrontendSettingsPanel = lazy(() =>
  import("@/components/frontend/FrontendSettingsPanel").then((m) => ({
    default: m.FrontendSettingsPanel,
  })),
);
import { GuardianBadge } from "@/features/guardian/GuardianBadge";
import { GuardianQuarantineBanner } from "@/features/guardian/GuardianQuarantineBanner";
import { GuardianTab } from "@/features/guardian/GuardianTab";
import { AiMemoryManager } from "@/components/ai/AiMemoryManager";
import type { GameInfo, Server } from "@/types";
import { mapBlueprintPorts } from "@/utils/portRoles";
import { formatPortRoleLabel } from "@/lib/serverConnect";
import { meldeErrungenschaft } from "@/lib/errungenschaft";
type TabKey =
  | "deployments"
  | "frontend_settings"
  | "files"
  | "console"
  | "exec"
  | "mods"
  | "restarts"
  | "backups"
  | "databases" | "webhooks"
  | "memory"
  | "guardian";

const VALID_TABS: TabKey[] = [
  "deployments",
  "frontend_settings",
  "files",
  "console",
  "exec",
  "mods",
  "restarts",
  "backups",
  "databases",
  "webhooks",
  "memory",
  "guardian",
];

interface ServerStatus {
  status?: string;
  cpu_percent?: number | null;
  ram_mb?: number | null;
  uptime_seconds?: number | null;
  started_at?: string | null;
  disk_used_mb?: number | null;
  disk_free_mb?: number | null;
  cpu_limit_percent?: number | null;
  ram_limit_mb?: number | null;
  disk_limit_gb?: number | null;
  message?: string | null;
  // Extra fields from backend server-file / mod checkers (Status-Response)
  server_file_update_available?: boolean;
  server_file_update_reason?: string | null;
  mod_updates_available?: any[];
}

function statusClasses(s: string | undefined): string {
  switch (s) {
    case "running":
      return "bg-status-success/10 border-status-success/30 text-status-success";
    case "stopped":
      return "bg-surface-container-highest border-outline text-on-surface-variant";
    case "starting":
    case "stopping":
    case "restarting":
    case "queued":
      return "bg-status-warning/10 border-status-warning/30 text-status-warning";
    case "installing":
    case "updating":
    case "awaiting_files":
      return "bg-status-warning/10 border-status-warning/30 text-status-warning";
    case "failed":
      return "bg-status-destructive/10 border-status-destructive/30 text-status-destructive";
    default:
      return "bg-status-destructive/10 border-status-destructive/30 text-status-destructive";
  }
}

export function ServerDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [server, setServer] = useState<Server | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const liveMetriken = status?.cpu_percent != null && status?.ram_mb != null;
  useEffect(() => {
    if (liveMetriken) meldeErrungenschaft("server_resource_watcher");
  }, [liveMetriken]);
  const [games, setGames] = useState<GameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [serverUpdateCheckLoading, setServerUpdateCheckLoading] = useState(false);

  // Stabiler Badge-State (KISS-Fix fuer Polling/Cache-Race-Flicker):
  // Badge (nur Server-Updates via Blueprint) bleibt sichtbar, sobald einmal true,
  // bis Reload ODER erfolgreicher Restart (doAction cleared ref).
  // Vermeidet on/off durch 5s-Poll + 5min-Cache-Miss. Keine Mods, pure UI-Stabilitaet.
  // Post-restart clear erlaubt "update applied" Sichtbarkeit ohne Reload.
  const lastServerUpdateBadgeRef = useRef<{
    available: boolean;
    reason: string | null;
  } | null>(null);
  const serverUpdateBadge = useMemo(() => {
    if (status?.server_file_update_available) {
      const b = {
        available: true,
        reason: status.server_file_update_reason ?? null,
      };
      lastServerUpdateBadgeRef.current = b;
      return b;
    }
    return lastServerUpdateBadgeRef.current;
  }, [status?.server_file_update_available, status?.server_file_update_reason]);

  const [showEditNetwork, setShowEditNetwork] = useState(false);
  const [showSwitchBlueprint, setShowSwitchBlueprint] = useState(false);
  const [savingNetwork, setSavingNetwork] = useState(false);
  // Optimistic transient status for instant UI feedback (overwritten by next poll/fetch)
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const [networkForm, setNetworkForm] = useState({
    public_bind_ip: "",
    game_port: "",
    query_port: "",
    rcon_port: "",
    ports: {} as Record<string, string>,
    protocols: {} as Record<string, string>,
  });
  // Die Liste wird ausschließlich im Netzwerk-Dialog gelesen, also erst dann
  // geladen. Sonst kostet jeder Aufruf der Detailseite zwei Anfragen für Daten,
  // die niemand zu sehen bekommt.
  const { interfaces, loading: interfacesLoading } = useHostInterfaces(
    server?.node_id,
    showEditNetwork,
  );

  const serverId = parseInt(id || "0");

  useEffect(() => {
    if (serverId > 0) {
      useServerPreferencesStore.getState().setLastVisited(serverId);
    }
  }, [serverId]);

  // Permission-Gating fuer Ressourcen-Editor (VAL-UI-002, VAL-UI-018):
  // Backend bleibt alleinige Wahrheitsquelle — Frontend versteckt nur die UI.
  // isLoading-Check verhindert Permission-Load-Flash: Button erscheint erst
  // nach Abschluss des Permission-Loads (oder gar nicht bei fehlendem Recht).
  const canManageResources = useHasPermission("server.resources.manage", serverId);
  const canManageCredentials = useHasPermission("server.credentials.manage", serverId);
  // Der Reiter mit dem Wissen dieser Anlage. Zwei Rechte, zwei Rollen:
  // `ai.memory.use` entscheidet, ob der Reiter ueberhaupt erscheint —
  // `AiMemoryManager` zeigt ohne dieses Recht gar nichts, und ein leerer
  // Kasten waere schlechter als kein Reiter. `server.config.write`
  // entscheidet nur, ob die Knoepfe zum Aendern dabei sind; lesen darf
  // jeder, der bis hierher gekommen ist.
  const canUseAiMemory = useHasPermission("ai.memory.use");
  const canWriteServerConfig = useHasPermission("server.config.write", serverId);
  const permissionsLoading = usePermissionsStore((s) => s.isLoading);
  const showResourceEdit = !permissionsLoading && canManageResources;
  // Dasselbe Anti-Flacker-Muster wie eine Zeile darueber: waehrend die Rechte
  // laden, ist `canUseAiMemory` false. Ohne diese Bedingung erschiene der
  // Reiter kurz nach dem Laden und sprungen die uebrigen zur Seite.
  const showMemoryTab = !permissionsLoading && canUseAiMemory;

  const [showEditResource, setShowEditResource] = useState(false);
  const [allServers, setAllServers] = useState<Server[]>([]);

  const fetchAll = async () => {
    if (!serverId) return;
    try {
      const [srv, st] = await Promise.all([
        api<Server>(`/servers/${serverId}`),
        api<ServerStatus>(`/servers/${serverId}/status`).catch(() => null),
      ]);
      setServer(srv);
      setStatus(st);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const serverStatusRef = useRef<string | undefined>(undefined);
  serverStatusRef.current = server?.status;
  const fullRefreshTickRef = useRef(0);

  const pollStatus = async () => {
    if (!serverId) return;
    try {
      const st = await api<ServerStatus>(`/servers/${serverId}/status`).catch(() => null);
      setStatus(st);
      fullRefreshTickRef.current += 1;
      const statusChanged = Boolean(st?.status && st.status !== serverStatusRef.current);
      // Volles Server-Objekt nur bei Statuswechsel oder alle ~64s nachladen.
      if (statusChanged || fullRefreshTickRef.current >= 8) {
        fullRefreshTickRef.current = 0;
        const srv = await api<Server>(`/servers/${serverId}`);
        setServer(srv);
        if (isFrontendServer) {
          frontendApi.getOverview(serverId).then(setFrontendOverview).catch(() => {});
        }
      }
    } catch {
      // silent
    }
  };

  // Der Spielekatalog hängt nicht am Server und ändert sich nur, wenn ein
  // Blueprint dazukommt. Einmal holen statt alle fünf Sekunden.
  useEffect(() => {
    api<GameInfo[]>("/system/games")
      .then((gms) => setGames(Array.isArray(gms) ? gms : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    api<Server[]>("/servers")
      .then((list) => {
        if (active && Array.isArray(list)) setAllServers(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Der Merker gehört in den Takt, nicht in `fetchAll`: die manuellen Aufrufer
  // warten auf das Versprechen und löschen danach den optimistischen Status.
  // Ein Frühausstieg in `fetchAll` ließe ihr `.then` sofort feuern.
  const pollLaeuft = useRef(false);

  useEffect(() => {
    fullRefreshTickRef.current = 0;
    void fetchAll();
    const handle = setInterval(() => {
      // Im Hintergrundtab schaut niemand hin: kein Takt, keine Anfragen.
      if (document.visibilityState !== "visible") return;
      if (getRateLimitRemainingMs() > 0) return;
      // Ist der vorherige Durchlauf noch unterwegs, wird dieser Takt
      // ausgelassen, statt die Anfragen zu stapeln.
      if (pollLaeuft.current) return;
      pollLaeuft.current = true;
      void pollStatus().finally(() => {
        pollLaeuft.current = false;
      });
    }, 8000);
    return () => clearInterval(handle);
  }, [serverId]);



  useEffect(() => {
    if (server && showEditNetwork) {
      const initialPorts: Record<string, string> = {};
      const initialProtocols: Record<string, string> = {};
      server.ports?.forEach((p) => {
        initialProtocols[p.role] = p.protocol;
        if (p.role !== 'game' && p.role !== 'query' && p.role !== 'rcon') {
          initialPorts[p.role] = p.port ? String(p.port) : "";
        }
      });
      setNetworkForm({
        public_bind_ip: server.public_bind_ip || "",
        game_port: server.game_port ? String(server.game_port) : "",
        query_port: server.query_port ? String(server.query_port) : "",
        rcon_port: server.rcon_port ? String(server.rcon_port) : "",
        ports: initialPorts,
        protocols: initialProtocols,
      });
    }
  }, [server, showEditNetwork]);

  // Capability-Flag: nur wenn das Plugin das Steam-Workshop unterstuetzt, wird
  // der Tab gerendert. Die Quelle ist /api/system/games — dort steht jetzt
  // `supports_steam_workshop`. UI-Filter ist NUR Convenience; Backend
  // verweigert /api/mods/* ohnehin, wenn das Plugin keine Mods kann.
  const gameInfo = useMemo(
    () => (Array.isArray(games) ? games : []).find((g) => g.id === server?.game_type),
    [games, server?.game_type],
  );
  const showModTab = !!(gameInfo?.supports_steam_workshop || gameInfo?.supports_curseforge || gameInfo?.mod_support);
  /** Steam / HTTP / GitHub: manueller Datei-Update-Check (nicht Workshop-Mods). */
  const showServerFileUpdates = !!gameInfo?.supports_server_file_updates;

  const isDatabaseServer = server?.server_kind === "database";
  const isFrontendServer = gameInfo?.category === "frontend";
  const [frontendOverview, setFrontendOverview] = useState<FrontendOverview | null>(null);

  const loadFrontendOverview = () => {
    if (!isFrontendServer || !serverId) return;
    frontendApi.getOverview(serverId).then(setFrontendOverview).catch(() => {});
  };

  useEffect(() => {
    loadFrontendOverview();
  }, [isFrontendServer, serverId]);

  const tabs = useMemo(() => {
    if (isFrontendServer) {
      const frontendTabs: ServerDetailTab<TabKey>[] = [
        { key: "deployments", label: t("tabs.deployments"), icon: Rocket },
        { key: "files", label: t("tabs.files"), icon: FileText },
        { key: "backups", label: t("tabs.backups"), icon: HardDrive },
        { key: "frontend_settings", label: t("tabs.frontendSettings"), icon: Sliders },
        { key: "console", label: t("tabs.console"), icon: Terminal, secondary: true },
        {
          key: "restarts",
          label: t("tabs.restarts", { defaultValue: "Restarts" }),
          icon: RotateCcw,
          secondary: true,
        },
        {
          key: "webhooks",
          label: t("tabs.webhooks", { defaultValue: "Webhooks" }),
          icon: Webhook,
          secondary: true,
        },
      ];
      if (showMemoryTab) {
        frontendTabs.push({
          key: "memory",
          label: t("tabs.memory", { defaultValue: "Wissen" }),
          icon: Brain,
          secondary: true,
        });
      }
      if (server?.guardian_enabled) {
        frontendTabs.push({
          key: "guardian",
          label: t("servers.guardian.tabTitle", { defaultValue: "Autopilot" }),
          icon: Shield,
        });
      }
      return frontendTabs;
    }
    const list: ServerDetailTab<TabKey>[] = [
      // Beim Datenbankserver ist die Datenbank der Server: ihr Reiter steht vorn.
      ...(isDatabaseServer ? [{ key: "databases" as TabKey, label: t("tabs.databases"), icon: Database }] : []),
      { key: "files", label: t("tabs.files"), icon: FileText },
      { key: "console", label: t("tabs.console"), icon: Terminal },
    ];
    // v1.4.7+: Exec-Tab nur anzeigen, wenn der Server-Blueprint Exec aktiviert
    // hat (runtime.enableExec=true). Backend erzwungen das nochmal beim
    // Endpoint -- das hier ist nur UI-Hygiene.
    if (gameInfo?.enable_exec) {
      list.push({
        key: "exec",
        label: t("tabs.exec", { defaultValue: "Exec" }),
        icon: Terminal,
        secondary: true,
      });
    }
    if (showModTab)
      list.push({ key: "mods", label: t("tabs.mods"), icon: Package });
    list.push({
      key: "restarts",
      label: t("tabs.restarts", { defaultValue: "Restarts" }),
      icon: RotateCcw,
      secondary: true,
    });
    list.push({ key: "backups", label: t("tabs.backups"), icon: HardDrive });
    if (!isDatabaseServer) list.push({ key: "databases", label: t("tabs.databases"), icon: Database });
    list.push({
      key: "webhooks",
      label: t("tabs.webhooks", { defaultValue: "Webhooks" }),
      icon: Webhook,
      secondary: true,
    });
    if (showMemoryTab) {
      list.push({
        key: "memory",
        label: t("tabs.memory", { defaultValue: "Wissen" }),
        icon: Brain,
        secondary: true,
      });
    }
    if (server?.guardian_enabled) {
      list.push({
        key: "guardian",
        label: t("servers.guardian.tabTitle", { defaultValue: "Autopilot" }),
        icon: Shield,
      });
    }
    return list;
  }, [t, showModTab, showMemoryTab, gameInfo?.enable_exec, server?.guardian_enabled, isDatabaseServer, isFrontendServer]);

  const defaultTab: TabKey = isFrontendServer ? "deployments" : isDatabaseServer ? "databases" : "files";
  const rawTab = (searchParams.get("tab") || defaultTab) as TabKey;
  const activeTab: TabKey =
    VALID_TABS.includes(rawTab)
      && (rawTab !== "mods" || showModTab)
      // Ein Aufruf mit ?tab=memory ohne das Recht faellt auf "files" zurueck
      // statt einen leeren Bereich zu zeigen. Ein Lesezeichen ueberlebt einen
      // Rechteentzug, der Reiter nicht.
      && (rawTab !== "memory" || showMemoryTab)
      ? rawTab
      : defaultTab;

  const setActiveTab = (next: TabKey) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const doAction = async (action: string) => {
    // AUFGABE 4B: optimistic für sofortiges Feedback (wird durch realen Poll überschrieben)
    if (action === "stop") setOptimisticStatus("stopping");
    else if (action === "start") setOptimisticStatus("starting");
    else if (action === "restart") setOptimisticStatus("restarting");
    // no "kill" branch here (handleKill dedicated; dead code removed per review Issue 6)
    setActionLoading(action);
    try {
      await api(`/servers/${serverId}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (action === "restart") {
        lastServerUpdateBadgeRef.current = null;
      }
      void fetchAll().then(() => setOptimisticStatus(null)); // real data wins
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = t(raw, { defaultValue: raw }) || t("common.error");
      toast.error(msg);
      setOptimisticStatus(null);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveNetwork = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNetwork(true);
    try {
      const body: Record<string, unknown> = {};
      if (networkForm.public_bind_ip !== (server?.public_bind_ip || "")) {
        body.public_bind_ip = networkForm.public_bind_ip || null;
      }
      const portChanged = (field: "game_port" | "query_port" | "rcon_port") => {
        const current = server?.[field] ? String(server[field]) : "";
        return networkForm[field] !== current;
      };

      const currentPortsMap: Record<string, number | null> = {};
      server?.ports?.forEach((p) => {
        currentPortsMap[p.role] = p.port;
      });

      let portsChanged = false;
      let protocolsChanged = false;

      if (portChanged("game_port") || portChanged("query_port") || portChanged("rcon_port")) {
        portsChanged = true;
      }

      const portDefs = gameInfo?.ports ?? [];
      const mappedPortRoles = portDefs.length > 0
        ? mapBlueprintPorts(portDefs).map((p) => p.mappedRole)
        : Object.keys(currentPortsMap);

      if (mappedPortRoles.length !== (server?.ports?.length ?? 0)) {
        portsChanged = true;
      }

      mappedPortRoles.forEach((role) => {
        if (role !== "game" && role !== "query" && role !== "rcon") {
          const formVal = networkForm.ports[role];
          const formNum = formVal ? parseInt(formVal) : null;
          const currentNum = currentPortsMap[role] ?? null;
          if (formNum !== currentNum || !(role in currentPortsMap)) {
            portsChanged = true;
          }
        }
      });

      server?.ports?.forEach((p) => {
        if ((networkForm.protocols[p.role] || p.protocol) !== p.protocol) {
          protocolsChanged = true;
        }
      });

      if (portsChanged || protocolsChanged) {
        const portsPayload: Record<string, number | null> = {};
        const protocolsPayload: Record<string, string> = {};
        portsPayload["game"] = networkForm.game_port ? parseInt(networkForm.game_port) : null;
        portsPayload["query"] = networkForm.query_port ? parseInt(networkForm.query_port) : null;
        portsPayload["rcon"] = networkForm.rcon_port ? parseInt(networkForm.rcon_port) : null;
        if (networkForm.protocols.game) protocolsPayload.game = networkForm.protocols.game;
        if (networkForm.protocols.query) protocolsPayload.query = networkForm.protocols.query;
        if (networkForm.protocols.rcon) protocolsPayload.rcon = networkForm.protocols.rcon;

        mappedPortRoles.forEach((role) => {
          if (role !== "game" && role !== "query" && role !== "rcon") {
            const val = networkForm.ports[role];
            portsPayload[role] = val ? parseInt(val) : null;
            if (networkForm.protocols[role]) {
              protocolsPayload[role] = networkForm.protocols[role];
            }
          }
        });

        body.ports = portsPayload;
        body.port_protocols = protocolsPayload;
        body.game_port = portsPayload["game"];
        body.query_port = portsPayload["query"];
        body.rcon_port = portsPayload["rcon"];
      }

      if (Object.keys(body).length === 0) {
        setShowEditNetwork(false);
        return;
      }
      await api<Server>(`/servers/${serverId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast.success(t("servers.networkSaved"));
      setShowEditNetwork(false);
      void fetchAll();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      toast.error(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setSavingNetwork(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      message: t("servers.confirmDelete"),
      danger: true,
      confirmText: t("common.delete"),
    });
    if (!ok) return;
    setActionLoading("delete");
    try {
      await api(`/servers/${serverId}`, { method: "DELETE" });
      toast.success(t("servers.deleted"));
      navigate("/servers");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      toast.error(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setActionLoading(null);
    }
  };

  const handleKill = async () => {
    // KISS: bestehendes confirmStore Pattern (explizit, wie delete/restore) + danger:true per review
    const ok = await confirm({ message: t("servers.killConfirm"), danger: true });
    if (!ok) return;
    setOptimisticStatus("stopped");
    setActionLoading("kill");
    try {
      await api(`/servers/${serverId}/kill`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      toast.success(t("servers.killSuccess"));
      void fetchAll().then(() => setOptimisticStatus(null));
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      toast.error(t(raw, { defaultValue: raw }) || t("common.error"));
      setOptimisticStatus(null);
    } finally {
      setActionLoading(null);
    }
  };

  const gameName = (gameId: string) =>
    (Array.isArray(games) ? games : []).find((g) => g.id === gameId)?.name || gameId;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="md" className="text-secondary" />
      </div>
    );
  }

  if (!server) {
    return (
      <div className="text-center py-12">
        <p className="font-body-md text-on-surface-variant">
          {t("servers.notFound")}
        </p>
        <Button variant="secondary"
          className="mt-4 inline-flex items-center gap-2"
          onClick={() => navigate("/servers")}
        >
          <ArrowLeft className="w-4 h-4" />
          {t("servers.backToList")}
        </Button>
      </div>
    );
  }

  const effectiveStatus = optimisticStatus || server.status;
  const displayStatus = effectiveStatus;
  // Phase 5: node heartbeat offline → keep server visible, block actions
  const isNodeUnreachable = effectiveStatus === "node_unreachable";

  let guardianSyncError: { code: string; message: string } | null = null;
  if (server.guardian_sync_error_statistics) {
    try {
      const parsed = JSON.parse(server.guardian_sync_error_statistics);
      guardianSyncError = {
        code: parsed.code || parsed.last_error || "unknown_error",
        message: parsed.message || parsed.last_error_message || "",
      };
    } catch {
      // Ignored
    }
  }

  // Lifecycle-State: transiente Zustaende blockieren Ressourcen-Editor (VAL-UI-023)
  const isLifecycleBusy = [
    "starting",
    "stopping",
    "restarting",
    "installing",
    "updating",
    "queued",
    "awaiting_files",
  ].includes(effectiveStatus);

  // Configured resource limits: derive from status (live) first, then server
  // (DB-persisted) fallback. null means unlimited → always show the localized
  // unlimited label, regardless of disk_free_mb or other usage fields
  // (VAL-UI-001 / VAL-UI-007).
  const configuredCpuLimit = status?.cpu_limit_percent ?? server.cpu_limit_percent ?? null;
  const configuredRamLimit = status?.ram_limit_mb ?? server.ram_limit_mb ?? null;
  const configuredDiskLimit = status?.disk_limit_gb ?? server.disk_limit_gb ?? null;
  const cpuUsageOfLimit = status?.cpu_percent != null && configuredCpuLimit != null && configuredCpuLimit > 0
    ? (status.cpu_percent / configuredCpuLimit) * 100
    : null;
  const ramUsageOfLimit = status?.ram_mb != null && configuredRamLimit != null && configuredRamLimit > 0
    ? (status.ram_mb / configuredRamLimit) * 100
    : null;
  const diskUsageOfLimit = status?.disk_used_mb != null && configuredDiskLimit != null && configuredDiskLimit > 0
    ? (status.disk_used_mb / (configuredDiskLimit * 1024)) * 100
    : null;

  const openResourceEditor = () => setShowEditResource(true);
  const openNetworkEditor = () => setShowEditNetwork(true);
  const closeResourceEditor = () => setShowEditResource(false);
  const onResourceSaved = () => void fetchAll();

  // KISS: Install vs Reinstall Button-Logik + Update-Badge (genau nach Spec)
  // - Keine Server-Dateien (awaiting_files oder Disk <= 0) → servers.install
  // - Sobald Dateien da → servers.reinstall
  // - Badge reagiert auf neue Checker (extra Felder in Status-Response)
  // - Reinstall: Confirm mit reinstallConfirm (manuelle Configs bleiben erhalten)
  const diskUsed = (status?.disk_used_mb ??
    server.disk_usage_mb ??
    0) as number;
  const awaitingFiles = server.status === "awaiting_files";
  const hasServerFiles = !awaitingFiles && diskUsed > 0;
  const isReinstall = hasServerFiles;
  const installLabel = isReinstall
    ? t("servers.reinstall")
    : t("servers.install");

  const handleInstall = async () => {
    if (isReinstall) {
      const ok = await confirm({
        message: t("servers.reinstallConfirm"),
        // Kein danger: expliziter Reinstall-Wunsch (Configs per Text geschützt)
      });
      if (!ok) return;
    }
    doAction("install");
  };

  const checkServerFileUpdates = async () => {
    if (!serverId) return;
    setServerUpdateCheckLoading(true);
    try {
      const data = await api<{
        server_file_update_available: boolean;
        server_file_update_reason: string | null;
      }>(`/servers/${serverId}/check-server-file-updates`, { method: "POST" });
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              server_file_update_available: data.server_file_update_available,
              server_file_update_reason: data.server_file_update_reason,
            }
          : prev,
      );
      if (data.server_file_update_available) {
        lastServerUpdateBadgeRef.current = {
          available: true,
          reason: data.server_file_update_reason,
        };
        toast.success(t("servers.serverFileUpdateCheckFound"));
      } else {
        lastServerUpdateBadgeRef.current = null;
        toast.success(t("servers.serverFileUpdateCheckDone"));
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      toast.error(t(raw, { defaultValue: raw }) || t("servers.serverFileUpdateCheckFailed"));
    } finally {
      setServerUpdateCheckLoading(false);
    }
  };

  const startHinweis = isNodeUnreachable
    ? t("servers.nodeUnreachableHint")
    : !server.public_bind_ip
    ? t("servers.bindIp.startBlockedTitle")
    : undefined;
  const startKnopf = (
    <Button
      onClick={() => doAction("start")}
      disabled={!!actionLoading || !server.public_bind_ip || isNodeUnreachable}
      className="inline-flex min-h-[44px] md:min-h-[38px] items-center gap-2 disabled:opacity-50"
      aria-description={startHinweis}
    >
      <Play className="w-4 h-4" />
      {actionLoading === "start" ? t("common.loading") : t("servers.start")}
    </Button>
  );
  const updateHinweis = (
    <span
      className="font-mono-sm text-mono-sm px-2.5 py-1 rounded-full border bg-status-warning/10 border-status-warning/30 text-status-warning"
      aria-description={serverUpdateBadge?.reason || undefined}
    >
      {t("servers.serverFileUpdateAvailable")}
    </span>
  );

  const switcherServers = allServers.some((s) => s.id === server.id)
    ? allServers
    : [server, ...allServers];
  const switcherOptions: DropdownOption[] = switcherServers.map((item) => ({
    value: String(item.id),
    label: item.name,
    hint: gameName(item.game_type),
  }));

  const isTransientLifecycle = [
    "installing",
    "starting",
    "stopping",
    "restarting",
    "queued",
  ].includes(effectiveStatus);
  const canShowStart = !isTransientLifecycle && effectiveStatus !== "running";
  const canKill = ["starting", "running", "stopping", "restarting"].includes(effectiveStatus);
  const canInstallOrSwitch = effectiveStatus !== "installing" && effectiveStatus !== "queued";

  const moreActionItems: ActionMenuItem[] = [
    ...(canKill
      ? [
          {
            key: "kill",
            label: actionLoading === "kill" ? t("common.loading") : t("servers.kill"),
            icon: <Square className="h-4 w-4" />,
            destructive: true,
            disabled: !!actionLoading || isNodeUnreachable,
            onSelect: () => void handleKill(),
          } satisfies ActionMenuItem,
        ]
      : []),
    {
      key: "edit-network",
      label: t("servers.editNetworkTitle"),
      icon: <Network className="h-4 w-4" />,
      disabled: effectiveStatus === "running" || !!actionLoading,
      onSelect: openNetworkEditor,
    },
    ...(canInstallOrSwitch
      ? [
          {
            key: "install",
            label: actionLoading === "install" ? t("common.loading") : installLabel,
            icon: <Download className="h-4 w-4" />,
            disabled: !!actionLoading || isNodeUnreachable,
            onSelect: () => void handleInstall(),
          } satisfies ActionMenuItem,
          {
            key: "switch-blueprint",
            label: t("servers.switchBlueprintAction"),
            icon: <RefreshCw className="h-4 w-4" />,
            disabled: !!actionLoading || isNodeUnreachable || effectiveStatus !== "stopped",
            onSelect: () => setShowSwitchBlueprint(true),
          } satisfies ActionMenuItem,
        ]
      : []),
    ...(hasServerFiles && showServerFileUpdates
      ? [
          {
            key: "check-updates",
            label: serverUpdateCheckLoading ? t("common.loading") : t("servers.checkServerFileUpdates"),
            icon: <RefreshCw className={`h-4 w-4 ${serverUpdateCheckLoading ? "animate-spin" : ""}`} />,
            disabled: !!actionLoading || serverUpdateCheckLoading || isNodeUnreachable,
            onSelect: () => void checkServerFileUpdates(),
          } satisfies ActionMenuItem,
        ]
      : []),
    {
      key: "delete",
      label: t("common.delete"),
      icon: <Trash2 className="h-4 w-4" />,
      destructive: true,
      separatorBefore: true,
      disabled: !!actionLoading,
      onSelect: () => void handleDelete(),
    },
  ];

  const activeTabLabel = tabs.find((tab) => tab.key === activeTab)?.label ?? server.name;

  const technikPanelProps = {
    server,
    gameLabel: gameName(server.game_type),
    status,
    effectiveStatus,
    configuredCpuLimit,
    configuredRamLimit,
    configuredDiskLimit,
    cpuUsageOfLimit: cpuUsageOfLimit ?? undefined,
    ramUsageOfLimit: ramUsageOfLimit ?? undefined,
    diskUsageOfLimit: diskUsageOfLimit ?? undefined,
    showResourceEdit,
    isLifecycleBusy,
    actionLoading,
    canManageCredentials,
    onOpenResourceEditor: openResourceEditor,
    onOpenNetworkEditor: openNetworkEditor,
  };

  return (
    <div className="msm-page">
      {/* Server-Deck: Fokus-Aktionen oben, kompakter Ressourcenstreifen darunter, volle Breite für Tabs */}
      <header className="rounded-2xl border border-outline bg-surface-container-low/80 backdrop-blur-xl px-3.5 py-3 sm:px-5 sm:py-3.5 space-y-2.5 overflow-x-clip">
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          {/* Links: Zurück, Servername, Schnellwechsler, Status & kompakter Connect-Chip */}
          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="inline-flex min-h-[44px] md:min-h-[36px] items-center gap-1.5"
              onClick={() => navigate("/servers")}
              aria-label={t("servers.backToList")}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">{t("common.back")}</span>
            </Button>

            <h1 className="font-headline text-base sm:text-xl font-semibold text-primary truncate max-w-[14rem] sm:max-w-[22rem]">
              {server.name}
            </h1>

            {switcherOptions.length > 1 && (
              <div className="w-full sm:w-52 min-w-0">
                <Dropdown
                  value={String(server.id)}
                  onChange={(value) => {
                    const nextId = Number(value);
                    if (nextId && nextId !== server.id) navigate(`/servers/${nextId}`);
                  }}
                  options={switcherOptions}
                  searchable={switcherOptions.length > 5}
                  aria-label={t("serverDetail.serverSwitcher")}
                  buttonClassName="min-h-[44px] md:min-h-[36px] text-xs"
                />
              </div>
            )}

            <span className={`font-mono-sm text-mono-sm px-2.5 py-1 rounded-full border ${statusClasses(displayStatus)}`}>
              {t(`servers.status.${displayStatus}`, { defaultValue: displayStatus })}
            </span>

            {server.active_frontend_build && (
              <span className="inline-flex items-center gap-1.5 font-mono-sm text-mono-sm px-2.5 py-1 rounded-full border bg-status-warning/10 border-status-warning/30 text-status-warning animate-pulse">
                <Hammer className="w-3 h-3" aria-hidden="true" />
                {t("frontendDeployments.buildingBadge", {
                  branch: server.active_frontend_build.branch,
                  defaultValue: `Baut: ${server.active_frontend_build.branch}`,
                })}
              </span>
            )}

            <ServerConnectChip server={server} />
            <GuardianBadge server={server} />

            {serverUpdateBadge?.available &&
              serverUpdateBadge.reason !== "missing" &&
              hasServerFiles &&
              showServerFileUpdates && (
              <div className="flex items-center">
                {serverUpdateBadge.reason ? (
                  <Kurzinfo text={serverUpdateBadge.reason}>{updateHinweis}</Kurzinfo>
                ) : updateHinweis}
              </div>
            )}
          </div>

          {/* Rechts: Fokus-Steuerung (Start/Stop, Neustart & Hamburger-Menü für weitere Aktionen) */}
          <div
            role="toolbar"
            aria-label={t("serverDetail.serverActions")}
            className="flex flex-wrap items-center gap-2"
          >
            {isFrontendServer ? (
              <>
                <div className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-low px-3">
                  <span className="text-sm font-medium text-on-surface">
                    {frontendOverview?.online ?? true
                      ? t("frontendDeployments.online")
                      : t("frontendDeployments.offline")}
                  </span>
                  <Switch
                    checked={frontendOverview ? frontendOverview.online : effectiveStatus === "running"}
                    onCheckedChange={async (checked) => {
                      setOptimisticStatus(checked ? "starting" : "stopping");
                      try {
                        const res = await frontendApi.toggleOnline(serverId, checked);
                        setFrontendOverview((prev) => (prev ? { ...prev, online: res.online } : prev));
                        toast.success(res.online ? t("frontendDeployments.online") : t("frontendDeployments.offline"));
                        await fetchAll();
                        loadFrontendOverview();
                      } catch {
                        toast.error(t("frontendDeployments.actionError"));
                      } finally {
                        setOptimisticStatus(null);
                      }
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await frontendApi.triggerBuild(serverId);
                      toast.success(t("frontendDeployments.buildQueued"));
                      loadFrontendOverview();
                    } catch {
                      toast.error(t("frontendDeployments.buildError"));
                    }
                  }}
                  className="inline-flex min-h-[44px] md:min-h-[38px] items-center gap-2"
                >
                  <Hammer className="w-4 h-4" />
                  {t("frontendDeployments.buildNow")}
                </Button>
              </>
            ) : (
              <>
                {canShowStart && (
                  startHinweis ? (
                    <Kurzinfo text={startHinweis} seite="ende">{startKnopf}</Kurzinfo>
                  ) : startKnopf
                )}
                {effectiveStatus === "running" && (
                  <Button
                    variant="destructive"
                    onClick={() => doAction("stop")}
                    disabled={!!actionLoading || isNodeUnreachable}
                    className="inline-flex min-h-[44px] md:min-h-[38px] items-center gap-2 disabled:opacity-50"
                  >
                    <Square className="w-4 h-4" />
                    {actionLoading === "stop" ? t("common.loading") : t("servers.stop")}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => doAction("restart")}
                  disabled={!!actionLoading || isNodeUnreachable || isTransientLifecycle}
                  className="inline-flex min-h-[44px] md:min-h-[38px] items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                  {actionLoading === "restart" ? t("common.loading") : t("servers.restart")}
                </Button>
              </>
            )}

            <ActionMenu
              label={t("serverDetail.moreActions")}
              ariaLabel={t("serverDetail.moreActions")}
              icon={<Menu className="h-[18px] w-[18px] md:h-4 md:w-4 shrink-0" aria-hidden="true" />}
              items={moreActionItems}
              variant="secondary"
              surface="dna"
              align="end"
              iconOnly
            />
          </div>
        </div>

        {/* Ruhiger Ressourcen-, Node- & Netzwerk-Streifen direkt im oberen Deck */}
        <ServerTechnikPanel {...technikPanelProps} />
      </header>

      {/* Auth-Setup-Banner: sichtbar waehrend der Container auf interaktiven Auth-Flow wartet */}
      {server.auth_required && <AuthSetupBanner serverId={server.id} />}

      {/* Guardian Quarantine Banner */}
      <GuardianQuarantineBanner server={server} onRefresh={fetchAll} />

      {/* Warnung: keine Bind-IP */}
      {!server.public_bind_ip && effectiveStatus !== "running" && (
        <div className="msm-card p-4 border-status-warning/40 bg-status-warning/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-headline text-body-md text-on-surface mb-1">
              {t("servers.bindIp.startBlockedTitle")}
            </p>
            <p className="font-body-md text-sm text-on-surface-variant">
              {t("servers.bindIp.startBlockedBody")}
            </p>
          </div>
          <Button size="sm" onClick={() => setShowEditNetwork(true)}>
            {t("servers.bindIp.assignNow")}
          </Button>
        </div>
      )}

      {isNodeUnreachable && (
        <div className="msm-card p-4 border-status-destructive/40 bg-status-destructive/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-status-destructive flex-shrink-0 mt-0.5" />
          <p className="font-body-md text-sm text-on-surface-variant">
            {t("servers.nodeUnreachableHint")}
          </p>
        </div>
      )}

      {guardianSyncError && (
        <div className="msm-card p-4 border-status-destructive/40 bg-status-destructive/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-status-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-headline text-body-md text-on-surface mb-1">
              {t("servers.guardian.syncErrorTitle")}
            </p>
            <p className="font-body-md text-sm text-on-surface-variant">
              {t(`servers.guardian.errors.${guardianSyncError.code}`, {
                defaultValue: `${guardianSyncError.code}: ${guardianSyncError.message}`,
              })}
            </p>
          </div>
        </div>
      )}

      {/* Reiter-Navigation direkt unter dem Server-Deck */}
      <ServerDetailTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        ariaLabel={server.name}
        moreLabel={t("serverDetail.moreTabs")}
      />

      {/* Vollflächiger Arbeitsbereich über die komplette Breite (Mods, Dateien, Konsole, ...) */}
      <div role="tabpanel" aria-label={activeTabLabel} className="w-full min-w-0">
        {activeTab === "deployments" && isFrontendServer && (
          <Suspense
            fallback={
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            }
          >
            <DeploymentsPanel
              serverId={serverId}
              overview={frontendOverview}
              onRefreshOverview={loadFrontendOverview}
            />
          </Suspense>
        )}
        {activeTab === "frontend_settings" && isFrontendServer && (
          <Suspense
            fallback={
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            }
          >
            <FrontendSettingsPanel
              serverId={serverId}
              onUpdated={loadFrontendOverview}
            />
          </Suspense>
        )}
        {activeTab === "files" && <FileManager serverId={serverId} />}
        {activeTab === "console" && <ServerConsolePanel serverId={serverId} />}
        {activeTab === "exec" && gameInfo?.enable_exec && (
          <ServerConsolePanel serverId={serverId} mode="exec" />
        )}
        {activeTab === "mods" && showModTab && (
          <ModManager serverId={serverId} gameInfo={gameInfo} />
        )}
        {activeTab === "restarts" && (
          <ServerRestartPanel
            server={server}
            serverId={serverId}
            onSaved={fetchAll}
          />
        )}
        {activeTab === "backups" && <Backups serverId={serverId} />}
        {activeTab === "databases" && <DatabaseManager serverId={serverId} dedicated={isDatabaseServer} />}
        {activeTab === "webhooks" && <OutgoingWebhooksPanel serverId={serverId} />}
        {activeTab === "memory" && showMemoryTab && (
          <AiMemoryManager
            scope={{
              kind: "server_shared",
              serverId,
              canManage: canWriteServerConfig,
            }}
          />
        )}
        {activeTab === "guardian" && (
          <GuardianTab server={server} onRefreshServer={fetchAll} />
        )}
      </div>

      {/* Netzwerk-Dialog mit Design-DNA Dialog & Input */}
      <Dialog open={showEditNetwork} onOpenChange={setShowEditNetwork}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("servers.editNetworkTitle")}</DialogTitle>
            <DialogDescription>{t("servers.editNetworkDescription")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveNetwork}>
            <div className="p-6 space-y-4">
              {effectiveStatus === "running" && (
                <div className="p-3 rounded-lg bg-status-warning/10 border border-status-warning/30 text-status-warning text-sm">
                  {t("servers.networkEditRequiresStopped")}
                </div>
              )}
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t("servers.publicBindIp")}
                </label>
                <Dropdown
                  value={networkForm.public_bind_ip || null}
                  onChange={(value) =>
                    setNetworkForm({
                      ...networkForm,
                      public_bind_ip: value,
                    })
                  }
                  options={interfaces.map((iface) => {
                    const tag = iface.is_loopback
                      ? ` (${t("servers.bindIp.loopback")})`
                      : iface.is_private && !iface.is_loopback
                      ? ` (${t("servers.bindIp.private")})`
                      : "";
                    return {
                      value: iface.ip,
                      label: `${iface.ip} · ${iface.interface}${tag}`,
                      hint: iface.interface,
                    };
                  })}
                  disabled={interfacesLoading}
                  placeholder={
                    interfacesLoading
                      ? t("servers.bindIp.loading")
                      : interfaces.length === 0
                      ? t("servers.bindIp.noneAvailable")
                      : t("servers.bindIp.choose")
                  }
                  aria-label={t("servers.publicBindIp")}
                  data-testid="server-detail-bind-ip"
                />
                <p className="font-body-md text-xs text-on-surface-variant mt-1">
                  {t("servers.bindIp.hint")}
                </p>
              </div>
              {(() => {
                const portDefs = gameInfo?.ports ?? [
                  { name: "game", protocol: "udp" },
                  { name: "query", protocol: "udp" },
                  { name: "rcon", protocol: "tcp" },
                ];
                const mappedPorts = portDefs.length > 0
                  ? mapBlueprintPorts(portDefs)
                  : (server.ports ?? []).map((p) => ({
                      name: "custom" as const,
                      protocol: p.protocol as "tcp" | "udp",
                      mappedRole: p.role,
                    }));
                if (mappedPorts.length === 0) return null;

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {mappedPorts.map((p) => {
                      const role = p.mappedRole;
                      const isLegacy = role === "game" || role === "query" || role === "rcon";
                      const val = isLegacy
                        ? (role === "game" ? networkForm.game_port : role === "query" ? networkForm.query_port : networkForm.rcon_port)
                        : (networkForm.ports[role] || "");
                      const protocol = networkForm.protocols[role] || p.protocol;
                      const label = formatPortRoleLabel(role, t);

                      return (
                        <div key={role}>
                          <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                            {label}
                          </label>
                          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                            <Input
                              type="number"
                              min={1024}
                              max={65535}
                              value={val}
                              onChange={(e) => {
                                if (isLegacy) {
                                  const fieldKey = role === "game" ? "game_port" : role === "query" ? "query_port" : "rcon_port";
                                  setNetworkForm({ ...networkForm, [fieldKey]: e.target.value });
                                } else {
                                  setNetworkForm({
                                    ...networkForm,
                                    ports: {
                                      ...networkForm.ports,
                                      [role]: e.target.value,
                                    },
                                  });
                                }
                              }}
                              placeholder={t("servers.portAuto")}
                              aria-label={label}
                            />
                            <Dropdown
                              value={protocol}
                              onChange={(value) =>
                                setNetworkForm({
                                  ...networkForm,
                                  protocols: {
                                    ...networkForm.protocols,
                                    [role]: value,
                                  },
                                })
                              }
                              options={[
                                { value: "udp", label: "UDP" },
                                { value: "tcp", label: "TCP" },
                              ]}
                              aria-label={`${label} protocol`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setShowEditNetwork(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={savingNetwork || effectiveStatus === "running"}
              >
                {savingNetwork ? t("common.loading") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit-Resource Modal — permission-gated, accessible, polling-stable */}
      {showEditResource && (
        <ResourceEditorDialog
          onClose={closeResourceEditor}
          serverId={serverId}
          nodeId={server?.node_id}
          cpuLimit={configuredCpuLimit}
          ramLimit={configuredRamLimit}
          diskLimit={configuredDiskLimit}
          lifecycleBusy={isLifecycleBusy}
          onSaved={onResourceSaved}
        />
      )}

      {server && (
        <SwitchBlueprintDialog
          open={showSwitchBlueprint}
          onClose={() => setShowSwitchBlueprint(false)}
          server={server}
          onSwitched={fetchAll}
        />
      )}
    </div>
  );
}
