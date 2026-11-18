import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { Button, Spinner } from "@maunting/ui";
import { useBildquelle } from "@/hooks/useBildquelle";
import { confirm } from "@/stores/confirmStore";

export const ALLOWED_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface MediaGalleryEntry {
  id: number;
  uploaded_by: string;
  created_at: string;
  is_active: boolean;
  thumbUrl: string;
}

export interface MediaGalleryDialogProps {
  open: boolean;
  onClose: () => void;
  titleId?: string;
  title: string;
  subtitle?: string;
  hintLead?: string;
  hintText?: string;
  aspectClass?: string;
  items: MediaGalleryEntry[];
  loadingGallery: boolean;
  uploading: boolean;
  resetting?: boolean;
  deletingId?: number | null;
  error: string | null;
  onError: (message: string | null) => void;
  canReset?: boolean;
  resetLabel?: string;
  dropHint: string;
  formatsHint: string;
  uploadingText: string;
  galleryTitle: string;
  galleryEmptyText: string;
  activeBadgeText: string;
  formatErrorText: string;
  deleteConfirmText: (item: MediaGalleryEntry) => string;
  reactivateAriaLabel: (item: MediaGalleryEntry) => string;
  deleteAriaLabel: (item: MediaGalleryEntry) => string;
  onUploadFile: (file: File) => Promise<void>;
  onActivateItem: (id: number) => Promise<void>;
  onReset?: () => Promise<void>;
  onDeleteItem: (item: MediaGalleryEntry) => Promise<void>;
  presetsSection?: ReactNode;
}

/** Galerie-Miniatur mit Auth-Blob-Unterstützung für Web & MSS-App. */
function GalleryThumb({
  thumbUrl,
  aspectClass,
}: {
  thumbUrl: string;
  aspectClass: string;
}) {
  const { quelle, bildFehler } = useBildquelle(thumbUrl);
  if (!quelle) {
    return (
      <span
        aria-hidden="true"
        className={`block ${aspectClass} w-full animate-pulse bg-surface-container-highest`}
      />
    );
  }
  return (
    <img
      src={quelle}
      alt=""
      loading="lazy"
      onError={bildFehler}
      className={`${aspectClass} w-full object-cover`}
    />
  );
}

/**
 * Zentrale, wiederverwendbare Bild-Upload- und Galerie-Oberfläche.
 * Wird sowohl für Server-Wallpapers als auch für Team-Profilbilder/-Banner genutzt.
 */
export function MediaGalleryDialog({
  open,
  onClose,
  titleId = "media-gallery-dialog-title",
  title,
  subtitle,
  hintLead,
  hintText,
  aspectClass = "aspect-video",
  items,
  loadingGallery,
  uploading,
  resetting = false,
  deletingId = null,
  error,
  onError,
  canReset = false,
  resetLabel,
  dropHint,
  formatsHint,
  uploadingText,
  galleryTitle,
  galleryEmptyText,
  activeBadgeText,
  formatErrorText,
  deleteConfirmText,
  reactivateAriaLabel,
  deleteAriaLabel,
  onUploadFile,
  onActivateItem,
  onReset,
  onDeleteItem,
  presetsSection,
}: MediaGalleryDialogProps) {
  const { t } = useTranslation();
  const [dragActive, setDragActive] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
      prevActive?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (uploading || resetting || deletingId !== null || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const inside = dialogRef.current?.contains(document.activeElement);
        if (e.shiftKey) {
          if (document.activeElement === first || !inside) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !inside) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, uploading, resetting, deletingId]);

  if (!open) return null;

  const handleFile = async (file: File | undefined) => {
    if (!file || uploading) return;
    if (!ALLOWED_MEDIA_MIME_TYPES.includes(file.type)) {
      onError(formatErrorText);
      return;
    }
    onError(null);
    await onUploadFile(file);
  };

  const handleDelete = async (item: MediaGalleryEntry) => {
    if (deletingId !== null) return;
    const ok = await confirm({
      message: deleteConfirmText(item),
      danger: true,
      confirmText: t("common.delete"),
    });
    if (!ok) return;
    await onDeleteItem(item);
  };

  return (
    <div className="msm-modal-overlay">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="msm-card max-w-lg w-full p-6 shadow-2xl border border-outline/30 animate-scale-in max-h-[90vh] overflow-y-auto"
      >
        <h2
          id={titleId}
          className="font-headline text-headline-sm text-on-surface mb-1 flex items-center gap-2"
        >
          <ImagePlus className="w-5 h-5 text-primary" />
          {title}
        </h2>

        {subtitle && (
          <p className="font-body-md text-sm text-on-surface-variant mb-4">
            {subtitle}
          </p>
        )}

        {(hintLead || hintText) && (
          <div className="msm-card p-3 bg-surface-container-highest/40 border-outline/20 mb-4 flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
            <p className="font-body-md text-xs text-on-surface-variant">
              {hintLead && <strong>{hintLead}</strong>}{" "}
              {hintText}
            </p>
          </div>
        )}

        {error && (
          <div className="msm-card p-3 border-status-destructive/40 bg-status-destructive/5 mb-4">
            <p className="font-body-md text-xs text-status-destructive">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          disabled={uploading}
          className={`w-full rounded-xl border-2 border-dashed p-6 text-center transition-colors disabled:opacity-50 ${
            dragActive ? "border-primary bg-primary/5" : "border-outline-variant/60 hover:border-primary/60"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <span className="inline-flex items-center gap-2 text-sm text-on-surface-variant">
              <Spinner className="text-primary" />
              {uploadingText}
            </span>
          ) : (
            <span className="font-body-md text-sm text-on-surface-variant">
              {dropHint}
              <span className="block text-xs mt-1 opacity-70">{formatsHint}</span>
            </span>
          )}
        </button>

        {presetsSection && <div className="mt-4">{presetsSection}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-2">
          <h3 className="font-headline text-sm text-on-surface">{galleryTitle}</h3>
          {canReset && onReset && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onReset()}
              disabled={resetting}
              className="inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              {resetting ? t("common.loading") : (resetLabel ?? t("common.reset", "Zurücksetzen"))}
            </Button>
          )}
        </div>

        {loadingGallery ? (
          <div className="flex items-center gap-2 py-4 text-xs text-on-surface-variant">
            <Spinner className="text-primary" />
            {t("common.loading")}
          </div>
        ) : items.length === 0 ? (
          <p className="font-body-md text-sm text-on-surface-variant py-2">
            {galleryEmptyText}
          </p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {items.map((item) => (
              <li key={item.id} className="relative">
                <button
                  type="button"
                  onClick={() => void onActivateItem(item.id)}
                  disabled={item.is_active}
                  aria-label={reactivateAriaLabel(item)}
                  aria-pressed={item.is_active}
                  className={`group relative block w-full overflow-hidden rounded-lg border transition-colors ${
                    item.is_active
                      ? "border-primary"
                      : "border-outline-variant/50 hover:border-primary/60"
                  }`}
                >
                  <GalleryThumb thumbUrl={item.thumbUrl} aspectClass={aspectClass} />
                  {item.is_active && (
                    <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-label-sm font-semibold text-on-primary">
                      {activeBadgeText}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-label-sm text-white">
                    {item.uploaded_by}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => void handleDelete(item)}
                  disabled={deletingId !== null}
                  aria-label={deleteAriaLabel(item)}
                  className="absolute right-1 top-1 shadow-md"
                >
                  {deletingId === item.id ? (
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
          <Button ref={closeBtnRef} variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
