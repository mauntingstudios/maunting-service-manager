import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/api/client";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Dropdown, Spinner } from '@maunting/ui'
import { toast } from "@/stores/toastStore";
import type { BlueprintListEntry, Server } from "@/types";
interface SwitchBlueprintDialogProps {
  open: boolean;
  onClose: () => void;
  server: Server;
  onSwitched: () => void;
}

export function SwitchBlueprintDialog({
  open,
  onClose,
  server,
  onSwitched,
}: SwitchBlueprintDialogProps) {
  const { t } = useTranslation();
  const [blueprints, setBlueprints] = useState<BlueprintListEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api<{ blueprints: BlueprintListEntry[] }>("/blueprints")
      .then((data) => {
        const list = data?.blueprints ?? [];
        setBlueprints(list);
        if (list.length > 0) {
          const firstOther = list.find((b) => b.id !== server.game_type);
          setSelectedId(firstOther ? firstOther.id : list[0].id);
        }
      })
      .catch((err) => {
        const raw = err instanceof Error ? err.message : String(err);
        toast.error(t(raw, { defaultValue: raw }) || t("common.error"));
      })
      .finally(() => setLoading(false));
  }, [open, server.game_type, t]);

  const handleSwitch = async () => {
    if (!selectedId || selectedId === server.game_type) return;
    setSubmitting(true);
    try {
      await api<{ message: string }>(`/servers/${server.id}/switch-blueprint`, {
        method: "POST",
        body: JSON.stringify({ new_blueprint_id: selectedId }),
      });
      toast.success(t("servers.blueprintSwitchedSuccess"));
      onSwitched();
      onClose();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      toast.error(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const currentBpName =
    (Array.isArray(blueprints) ? blueprints : []).find((b) => b.id === server.game_type)?.name || server.game_type;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onClose(); }}>
      <DialogContent
        aria-labelledby="switch-blueprint-title"
        showCloseButton={false}
        className="max-w-lg w-full p-6"
      >
        <DialogHeader className="p-0 pb-2">
          <DialogTitle id="switch-blueprint-title" className="font-headline text-headline-sm text-on-surface flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" />
            {t("servers.switchBlueprintTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm mt-1">
            {t("servers.switchBlueprintSubtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="msm-card p-3 bg-surface-container-highest/40 border-outline/20 my-4 flex items-start gap-2.5">
          <ShieldCheck className="w-5 h-5 text-status-success flex-shrink-0 mt-0.5" />
          <p className="font-body-md text-xs text-on-surface-variant">
            <strong>{t("servers.backupProtectionTitle")}</strong>{" "}
            {t("servers.backupProtectionDesc")}
          </p>
        </div>

        {server.status !== "stopped" && (
          <div className="msm-card p-3 border-status-warning/40 bg-status-warning/5 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-status-warning flex-shrink-0" />
            <p className="font-body-md text-xs text-status-warning">
              {t("servers.mustStopToSwitch")}
            </p>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div>
            <label className="block font-headline text-xs text-on-surface-variant mb-1">
              {t("servers.currentBlueprint")}
            </label>
            <div className="font-mono text-sm px-3 py-2 rounded bg-surface-container-highest text-on-surface border border-outline/20">
              {currentBpName} ({server.game_type})
            </div>
          </div>

          <div>
            <label className="block font-headline text-xs text-on-surface-variant mb-1">
              {t("servers.selectNewBlueprint")}
            </label>
            {loading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-on-surface-variant">
                <Spinner className="text-primary" />
                {t("common.loading")}
              </div>
            ) : (
              <Dropdown
                data-testid="switch-blueprint-select"
                value={selectedId || null}
                onChange={setSelectedId}
                disabled={submitting || server.status !== "stopped"}
                searchable={blueprints.length > 5}
                placeholder={t("servers.selectNewBlueprint")}
                aria-label={t("servers.selectNewBlueprint")}
                options={blueprints.map((bp) => ({
                  value: bp.id,
                  label: `${bp.name} (${bp.category || "Native"})`,
                }))}
              />
            )}
          </div>
        </div>

        <DialogFooter variant="plain" className="p-0 flex justify-end gap-3 pt-2 border-t border-outline/20">
          <Button variant="secondary"
            autoFocus
            type="button"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            className="flex items-center gap-2"
            onClick={handleSwitch}
            disabled={
              submitting ||
              loading ||
              !selectedId ||
              selectedId === server.game_type ||
              server.status !== "stopped"
            }
          >
            {submitting && <Spinner />}
            {t("servers.confirmSwitchBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
