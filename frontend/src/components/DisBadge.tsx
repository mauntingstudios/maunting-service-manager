import { useTranslation } from 'react-i18next'

export interface DisBadgeProps {
  size?: number;
  showText?: boolean;
  className?: string;
  /** Etwa `hidden sm:inline`: am Telefon nur das Logo. */
  textClassName?: string;
}

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

export const DisBadge = ({ size = 14, showText = true, className, textClassName }: DisBadgeProps) => {
  const { t } = useTranslation()
  return (
    <a
      href="https://dis.mauntingstudios.de"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Defensive Integration Shield (${t('common.opensInNewTab')})`}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-on-surface-variant/65 hover:text-on-surface transition-colors cursor-pointer',
        className,
      )}
    >
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full opacity-75"
        style={{ width: size, height: size }}
      >
        <img
          src="/dis-logo.png"
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="h-full w-full object-cover rounded-full"
          loading="eager"
          decoding="async"
        />
      </span>
      {showText && (
        <span className={cn('text-xs font-normal tracking-normal', textClassName)}>
          Powered by DIS
        </span>
      )}
    </a>
  );
};
