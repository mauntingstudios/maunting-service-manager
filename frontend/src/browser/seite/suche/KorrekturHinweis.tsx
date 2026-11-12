import { useTranslation } from 'react-i18next'

/** „Meintest du: …“ aus den Rechtschreibkorrekturen der Metasuche. */
export function KorrekturHinweis({
  korrekturen,
  onSuchen,
}: {
  korrekturen: string[]
  onSuchen: (begriff: string) => void
}) {
  const { t } = useTranslation()
  const korrektur = korrekturen[0]
  if (!korrektur) return null
  return (
    <p className="text-body-sm text-on-surface-variant">
      {t('browser.msmSuche.meintestDu')}{' '}
      <button
        type="button"
        onClick={() => onSuchen(korrektur)}
        className="font-medium text-primary underline-offset-4 transition-colors hover:underline"
      >
        {korrektur}
      </button>
    </p>
  )
}