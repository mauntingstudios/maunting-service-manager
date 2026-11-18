import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { toast } from "@/stores/toastStore";
import type { Server, WallpaperGalleryItem } from "@/types";
import { MediaGalleryDialog, type MediaGalleryEntry } from "@/components/shared/MediaGalleryDialog";

interface ServerWallpaperDialogProps {
  open: boolean;
  onClose: () => void;
  server: Server;
  /** Nach Upload/Reaktivieren/Reset: Server neu laden + Cache-Version erhöhen. */
  onChanged: () => void;
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

  const hochladen = async (datei: File) => {
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

  const loeschen = async (item: MediaGalleryEntry) => {
    setFehler(null);
    setLoeschId(item.id);
    try {
      await api(`/servers/${server.id}/wallpaper/gallery/${item.id}`, { method: "DELETE" });
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

  const quelle = server.wallpaper_source ?? "panorama";
  const entries: MediaGalleryEntry[] = galerie.map((bild) => ({
    id: bild.id,
    uploaded_by: bild.uploaded_by,
    created_at: bild.created_at,
    is_active: bild.is_active,
    thumbUrl: `/api/servers/${server.id}/wallpaper/gallery/${bild.id}/image`,
  }));

  return (
    <MediaGalleryDialog
      open={open}
      onClose={onClose}
      titleId="server-wallpaper-title"
      title={t("serverWallpaper.title")}
      subtitle={t("serverWallpaper.subtitle", { game: server.game_type })}
      hintLead={t(`serverWallpaper.source.${quelle}`)}
      hintText={t("serverWallpaper.gameScopedHint")}
      aspectClass="aspect-video"
      items={entries}
      loadingGallery={laedt}
      uploading={laedtHoch}
      resetting={setztZurueck}
      deletingId={loeschId}
      error={fehler}
      onError={setFehler}
      canReset={Boolean(server.has_custom_wallpaper)}
      resetLabel={t("serverWallpaper.reset")}
      dropHint={t("serverWallpaper.dropHint")}
      formatsHint={t("serverWallpaper.formats")}
      uploadingText={t("serverWallpaper.uploading")}
      galleryTitle={t("serverWallpaper.gallery")}
      galleryEmptyText={t("serverWallpaper.galleryEmpty")}
      activeBadgeText={t("serverWallpaper.active")}
      formatErrorText={t("serverWallpaper.errors.format")}
      deleteConfirmText={(item) => t("serverWallpaper.deleteConfirm", { by: item.uploaded_by })}
      reactivateAriaLabel={(item) =>
        t("serverWallpaper.reactivateTitle", {
          by: item.uploaded_by,
          date: new Date(item.created_at).toLocaleDateString(),
        })
      }
      deleteAriaLabel={(item) =>
        t("serverWallpaper.deleteTitle", {
          by: item.uploaded_by,
          date: new Date(item.created_at).toLocaleDateString(),
        })
      }
      onUploadFile={hochladen}
      onActivateItem={reaktivieren}
      onReset={zuruecksetzen}
      onDeleteItem={loeschen}
    />
  );
}
