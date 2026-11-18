import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { teamsApi, type TeamMediaGalleryItem, type TeamMediaKind } from "@/api/teams";
import {
  MediaGalleryDialog,
  type MediaGalleryEntry,
} from "@/components/shared/MediaGalleryDialog";
import { TEAM_COVER_PRESETS } from "@/components/teams/teamMeta";
import { useBildquelle } from "@/hooks/useBildquelle";
import { toast } from "@/stores/toastStore";

/**
 * Stellt entweder ein authentifiziertes Team-Upload-Bild (`/api/teams/...`) über
 * `useBildquelle` dar oder direkt ein statisches Preset.
 */
export function useResolvedTeamMedia(src: string | null | undefined): string | null {
  const isApiPath = Boolean(src && src.startsWith("/api/"));
  const { quelle, bildFehler } = useBildquelle(isApiPath ? src! : null);
  void bildFehler;
  if (!src) return null;
  if (isApiPath) return quelle;
  return src;
}

export function TeamMediaImage({
  src,
  alt = "",
  className = "h-full w-full object-cover",
  ariaHidden,
}: {
  src: string;
  alt?: string;
  className?: string;
  ariaHidden?: boolean;
}) {
  const resolved = useResolvedTeamMedia(src);
  if (!resolved) {
    return <span aria-hidden="true" className={`block bg-surface-container-highest animate-pulse ${className}`} />;
  }
  return <img src={resolved} alt={alt} aria-hidden={ariaHidden} className={className} />;
}

export interface TeamMediaDialogProps {
  open: boolean;
  onClose: () => void;
  teamId?: number | null;
  kind: TeamMediaKind;
  activePreset?: string | null;
  hasCustomMedia?: boolean;
  /** Aufruf nach Upload, Reaktivieren, Preset-Wahl, Reset oder Löschen im Live-Modus. */
  onChanged?: () => Promise<void> | void;
  /** Staging-Callback bei Team-Neuanlage (noch keine `teamId`). */
  onSelectStaged?: (selection: { presetId?: string | null; customFile?: File | null }) => void;
}

export function TeamMediaDialog({
  open,
  onClose,
  teamId = null,
  kind,
  activePreset = null,
  hasCustomMedia = false,
  onChanged,
  onSelectStaged,
}: TeamMediaDialogProps) {
  const { t } = useTranslation();
  const [gallery, setGallery] = useState<TeamMediaGalleryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAvatar = kind === "avatar";
  const isLive = typeof teamId === "number" && teamId > 0;

  const loadGallery = useCallback(async () => {
    if (!isLive || !teamId) {
      setGallery([]);
      return;
    }
    setLoading(true);
    try {
      const items = await teamsApi.getMediaGallery(teamId, kind);
      setGallery(items);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [isLive, teamId, kind, t]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void loadGallery();
  }, [open, loadGallery]);

  const handleUpload = async (file: File) => {
    if (!isLive || !teamId) {
      onSelectStaged?.({ presetId: null, customFile: file });
      onClose();
      return;
    }
    setUploading(true);
    try {
      await teamsApi.uploadMedia(teamId, kind, file);
      toast.success(
        isAvatar
          ? t("teams.media.avatarUploaded", "Profilbild hochgeladen.")
          : t("teams.media.bannerUploaded", "Hintergrundbanner hochgeladen."),
      );
      await onChanged?.();
      await loadGallery();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setUploading(false);
    }
  };

  const handleActivate = async (mediaId: number) => {
    if (!isLive || !teamId) return;
    setError(null);
    try {
      await teamsApi.activateMedia(teamId, kind, mediaId);
      toast.success(t("teams.media.activated", "Bild aktiviert."));
      await onChanged?.();
      await loadGallery();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(t(raw, { defaultValue: raw }) || t("common.error"));
    }
  };

  const handleSelectPreset = async (presetId: string) => {
    if (!isLive || !teamId) {
      onSelectStaged?.({ presetId, customFile: null });
      onClose();
      return;
    }
    setError(null);
    try {
      await teamsApi.setMediaPreset(teamId, kind, presetId);
      toast.success(t("teams.media.presetSaved", "Vorlage übernommen."));
      await onChanged?.();
      await loadGallery();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(t(raw, { defaultValue: raw }) || t("common.error"));
    }
  };

  const handleReset = async () => {
    if (!isLive || !teamId || resetting) {
      onSelectStaged?.({ presetId: null, customFile: null });
      onClose();
      return;
    }
    setError(null);
    setResetting(true);
    try {
      await teamsApi.resetMedia(teamId, kind);
      toast.success(t("teams.media.resetDone", "Bild zurückgesetzt."));
      await onChanged?.();
      await loadGallery();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async (item: MediaGalleryEntry) => {
    if (!isLive || !teamId) return;
    setError(null);
    setDeletingId(item.id);
    try {
      await teamsApi.deleteMediaItem(teamId, kind, item.id);
      toast.success(t("teams.media.deleted", "Bild aus Galerie entfernt."));
      await onChanged?.();
      await loadGallery();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(t(raw, { defaultValue: raw }) || t("common.error"));
    } finally {
      setDeletingId(null);
    }
  };

  const entries: MediaGalleryEntry[] = isLive && teamId
    ? gallery.map((row) => ({
        id: row.id,
        uploaded_by: row.uploaded_by,
        created_at: row.created_at,
        is_active: row.is_active,
        thumbUrl: `/api/teams/${teamId}/media/${kind}/gallery/${row.id}/image`,
      }))
    : [];

  const title = isAvatar
    ? t("teams.media.avatarTitle", "Team-Profilbild wählen")
    : t("teams.media.bannerTitle", "Team-Hintergrundbanner wählen");

  const subtitle = isAvatar
    ? t("teams.media.avatarSubtitle", "Lade ein eigenes Bild hoch oder wähle aus den Vorlagen und der Team-Galerie.")
    : t("teams.media.bannerSubtitle", "Passe den Hintergrundbanner dieses Teams für alle Mitglieder plattformübergreifend an.");

  const presetsSection = (
    <div>
      <h3 className="font-headline text-sm text-on-surface mb-2">
        {t("teams.media.presetsTitle", "Vorlagen")}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {TEAM_COVER_PRESETS.map((preset) => {
          const isSelected = !hasCustomMedia && activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => void handleSelectPreset(preset.id)}
              className={`group relative ${isAvatar ? "aspect-square" : "aspect-[4/3]"} overflow-hidden rounded-xl border text-left transition-all ${
                isSelected
                  ? "border-primary ring-2 ring-primary/40 shadow-md"
                  : "border-outline-variant/40 opacity-85 hover:opacity-100 hover:border-primary/60"
              }`}
            >
              <img
                src={preset.url}
                alt={preset.title}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
              <span className="absolute bottom-1.5 left-1.5 right-1.5 truncate text-label-sm font-semibold text-white">
                {preset.title}
              </span>
              {isSelected && (
                <span className="absolute top-1.5 right-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-on-primary shadow">
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <MediaGalleryDialog
      open={open}
      onClose={onClose}
      titleId={`team-media-dialog-${kind}`}
      title={title}
      subtitle={subtitle}
      hintLead={t("teams.media.isolatedBadge", "Team-Galerie")}
      hintText={t(
        "teams.media.isolatedHint",
        "Hochgeladene Bilder dieses Bereichs gelten nur für dieses Team und sind getrennt von Server-Titelbildern gespeichert.",
      )}
      aspectClass={isAvatar ? "aspect-square" : "aspect-video"}
      items={entries}
      loadingGallery={loading}
      uploading={uploading}
      resetting={resetting}
      deletingId={deletingId}
      error={error}
      onError={setError}
      canReset={Boolean(hasCustomMedia || activePreset)}
      resetLabel={t("teams.media.reset", "Auf Standard zurücksetzen")}
      dropHint={t("serverWallpaper.dropHint")}
      formatsHint={t("serverWallpaper.formats")}
      uploadingText={t("serverWallpaper.uploading")}
      galleryTitle={t("teams.media.gallery", "Team-Galerie")}
      galleryEmptyText={
        isLive
          ? t("serverWallpaper.galleryEmpty")
          : t("teams.media.galleryAfterCreate", "Eigene Uploads erscheinen nach dem Erstellen in der Team-Galerie.")
      }
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
      onUploadFile={handleUpload}
      onActivateItem={handleActivate}
      onReset={handleReset}
      onDeleteItem={handleDelete}
      presetsSection={presetsSection}
    />
  );
}
