import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { confirm } from "@/stores/confirmStore";
import { toast } from "@/stores/toastStore";
import { useBildquelle } from "@/hooks/useBildquelle";
import type { Server, WallpaperGalleryItem } from "@/types";
import { Button } from '@maunting/ui'

import { Spinner } from '@maunting/ui'
interface ServerWallpaperDialogProps {
  open: boolean;
  onClose: () => void;
  server: Server;
  /** Nach Upload/Reaktivieren/Reset: Server neu laden + Cache-Version erhöhen. */
  onChanged: () => void;
}

const ANGENOMMEN = ["image/jpeg", "image/png", "image/webp"];

/** Eine Galerie-Miniatur. Lädt über useBildquelle, weil ein `<img>` in der
 * MSS-App kein Bearer-Token trägt — dort kommt das Bild als Blob. */
function GalerieBild({ serverId, bild }: { serverId: number; bild: WallpaperGalleryItem }) {
  const { quelle, bildFehler } = useBildquelle(
    `/api/servers/${serverId}/wallpaper/gallery/${bild.id}/image`,
  );
  if (!quelle) {
    return (
      <span
        aria-hidden="true"
        className="block aspect-video w-full animate-pulse bg-surface-container-highest"
      />
    );
  }
  return (
    <img
      src={quelle}
      alt=""
      loading="lazy"
      onError={bildFehler}
      className="aspect-video w-full object-cover"
    />
  );
}

export function ServerWallpaperDialog({
  open,
  onClose,
  server,
  onChanged,
}: ServerWallpaperDialogProps) {
  const { t } = useTranslation();
  const [galerie, setGalerie] = useState<WallpaperGalleryItem[]>([]);
  const [laedt, setLaedt] = useState(false);
  const [laedtHoch, setLaedtHoch] = useState(false);
  const [setztZurueck, setSetztZurueck] = useState(false);
  const [loeschId, setLoeschId] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [dragAktiv, setDragAktiv] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const abbrechenRef = useRef<HTMLButtonElement>(null);
  const dateiRef = useRef<HTMLInputElement>(null);

  const galerieLaden = useCallback(async () => {
    setLaedt(true);
    try {
      const items = await api<WallpaperGalleryItem[]>(
        `/servers/${server.id}/wallpaper/gallery`,
      );
      setGalerie(items);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setFehler(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setLaedt(false);
    }
  }, [server.id, t]);

  useEffect(() => {
    if (!open) return;
    setFehler(null);
    void galerieLaden();
  }, [open, galerieLaden]);

  // Fokus wie im Nachbardialog SwitchBlueprintDialog.tsx: beim Öffnen auf
  // "Schließen", beim Schließen zurück zum öffnenden Knopf.
  useEffect(() => {
    if (!open) return;
    const vorherAktiv = document.activeElement as HTMLElement | null;
    const zeitgeber = setTimeout(() => abbrechenRef.current?.focus(), 0);
    return () => {
      clearTimeout(zeitgeber);
      vorherAktiv?.focus();
    };
  }, [open]);

  // Escape schließt (wenn nichts läuft), Tab bleibt im Dialog gefangen.
  useEffect(() => {
    if (!open) return;
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (laedtHoch || setztZurueck || loeschId !== null || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const fokussierbar = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!fokussierbar || fokussierbar.length === 0) return;
        const erstes = fokussierbar[0];
        const letztes = fokussierbar[fokussierbar.length - 1];
        const drinnen = dialogRef.current?.contains(document.activeElement);
        if (e.shiftKey) {
          if (document.activeElement === erstes || !drinnen) {
            e.preventDefault();
            letztes.focus();
          }
        } else {
          if (document.activeElement === letztes || !drinnen) {
            e.preventDefault();
            erstes.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", beiTaste);
    return () => window.removeEventListener("keydown", beiTaste);
  }, [open, onClose, laedtHoch, setztZurueck, loeschId]);

  if (!open) return null;

  const quelle = server.wallpaper_source ?? "panorama";

  const hochladen = async (datei: File | undefined) => {
    if (!datei || laedtHoch) return;
    if (!ANGENOMMEN.includes(datei.type)) {
      setFehler(t("serverWallpaper.errors.format"));
      return;
    }
    setFehler(null);
    setLaedtHoch(true);
    try {
      const formular = new FormData();
      formular.append("file", datei);
      await api(`/servers/${server.id}/wallpaper`, { method: "POST", body: formular });
      toast.success(t("serverWallpaper.uploaded"));
      onChanged();
      await galerieLaden();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setFehler(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setLaedtHoch(false);
    }
  };

  const zuruecksetzen = async () => {
    if (setztZurueck) return;
    setFehler(null);
    setSetztZurueck(true);
    try {
      await api(`/servers/${server.id}/wallpaper`, { method: "DELETE" });
      toast.success(t("serverWallpaper.resetDone"));
      onChanged();
      await galerieLaden();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setFehler(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setSetztZurueck(false);
    }
  };

  const reaktivieren = async (id: number) => {
    setFehler(null);
    try {
      await api(`/servers/${server.id}/wallpaper/${id}/activate`, { method: "POST" });
      toast.success(t("serverWallpaper.reactivated"));
      onChanged();
      await galerieLaden();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setFehler(t(raw, { defaultValue: raw }) || t("common.error"));
    }
  };

  const loeschen = async (bild: WallpaperGalleryItem) => {
    if (loeschId !== null) return;
    // Endgültig, kein Papierkorb: vorher fragen, welches Bild mitgeht.
    const ok = await confirm({
      message: t("serverWallpaper.deleteConfirm", { by: bild.uploaded_by }),
      danger: true,
      confirmText: t("common.delete"),
    });
    if (!ok) return;
    setFehler(null);
    setLoeschId(bild.id);
    try {
      await api(`/servers/${server.id}/wallpaper/gallery/${bild.id}`, { method: "DELETE" });
      toast.success(t("serverWallpaper.deleted"));
      onChanged();
      await galerieLaden();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setFehler(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setLoeschId(null);
    }
  };

  return (
    <div className="msm-modal-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-wallpaper-title"
        className="msm-card max-w-lg w-full p-6 shadow-2xl border border-outline/30 animate-scale-in max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="server-wallpaper-title"
          className="font-headline text-headline-sm text-on-surface mb-1 flex items-center gap-2"
        >
          <ImagePlus className="w-5 h-5 text-primary" />
          {t("serverWallpaper.title")}
        </h2>

        <p className="font-body-md text-sm text-on-surface-variant mb-4">
          {t("serverWallpaper.subtitle", { game: server.game_type })}
        </p>

        <div className="msm-card p-3 bg-surface-container-highest/40 border-outline/20 mb-4 flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
          <p className="font-body-md text-xs text-on-surface-variant">
            <strong>{t(`serverWallpaper.source.${quelle}`)}</strong>{" "}
            {t("serverWallpaper.gameScopedHint")}
          </p>
        </div>

        {fehler && (
          <div className="msm-card p-3 border-status-destructive/40 bg-status-destructive/5 mb-4">
            <p className="font-body-md text-xs text-status-destructive">{fehler}</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => dateiRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragAktiv(true);
          }}
          onDragLeave={() => setDragAktiv(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragAktiv(false);
            void hochladen(e.dataTransfer.files?.[0]);
          }}
          disabled={laedtHoch}
          className={`w-full rounded-xl border-2 border-dashed p-6 text-center transition-colors disabled:opacity-50 ${
            dragAktiv ? "border-primary bg-primary/5" : "border-outline-variant/60 hover:border-primary/60"
          }`}
        >
          <input
            ref={dateiRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void hochladen(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {laedtHoch ? (
            <span className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
              <Spinner className="text-primary" />
              {t("serverWallpaper.uploading")}
            </span>
          ) : (
            <span className="font-body-md text-sm text-on-surface-variant">
              {t("serverWallpaper.dropHint")}
              <span className="block text-xs mt-1 opacity-70">{t("serverWallpaper.formats")}</span>
            </span>
          )}
        </button>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-2">
          <h3 className="font-headline text-sm text-on-surface">
            {t("serverWallpaper.gallery")}
          </h3>
          {server.has_custom_wallpaper && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void zuruecksetzen()}
              disabled={setztZurueck}
              className="inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              {setztZurueck ? t("common.loading") : t("serverWallpaper.reset")}
            </Button>
          )}
        </div>

        {laedt ? (
          <div className="flex items-center gap-2 py-4 text-xs text-on-surface-variant">
            <Spinner className="text-primary" />
            {t("common.loading")}
          </div>
        ) : galerie.length === 0 ? (
          <p className="font-body-md text-sm text-on-surface-variant py-2">
            {t("serverWallpaper.galleryEmpty")}
          </p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {galerie.map((bild) => (
              <li key={bild.id} className="relative">
                <button
                  type="button"
                  onClick={() => void reaktivieren(bild.id)}
                  disabled={bild.is_active}
                  aria-label={t("serverWallpaper.reactivateTitle", {
                    by: bild.uploaded_by,
                    date: new Date(bild.created_at).toLocaleDateString(),
                  })}
                  aria-pressed={bild.is_active}
                  className={`group relative block w-full overflow-hidden rounded-lg border transition-colors ${
                    bild.is_active
                      ? "border-primary"
                      : "border-outline-variant/50 hover:border-primary/60"
                  }`}
                >
                  <GalerieBild serverId={server.id} bild={bild} />
                  {bild.is_active && (
                    <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-label-sm font-semibold text-on-primary">
                      {t("serverWallpaper.active")}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-label-sm text-white">
                    {bild.uploaded_by}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => void loeschen(bild)}
                  disabled={loeschId !== null}
                  aria-label={t("serverWallpaper.deleteTitle", {
                    by: bild.uploaded_by,
                    date: new Date(bild.created_at).toLocaleDateString(),
                  })}
                  className="absolute right-1 top-1 shadow-md"
                >
                  {loeschId === bild.id ? (
                    <Spinner className="text-on-surface" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end mt-6">
          <Button ref={abbrechenRef} variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
