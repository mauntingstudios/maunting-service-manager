import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Spinner, Zustandsflaeche } from '@/Singra/UI'
import { claimShare } from '@/api/docs'

export function DocumentShareClaim() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token } = useParams<{ token: string }>()
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let abgebrochen = false
    claimShare(token)
      .then((doc) => {
        if (!abgebrochen) navigate(`/dokumente/${doc.uid}`, { replace: true })
      })
      .catch(() => {
        if (!abgebrochen) setFehler(t('docs.share.claimFailed'))
      })
    return () => {
      abgebrochen = true
    }
  }, [navigate, t, token])

  if (fehler) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Zustandsflaeche art="fehler" titel={t('docs.share.claimFailedTitle')} text={fehler} />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center gap-3 p-6 text-sm text-on-surface-variant">
      <Spinner />
      {t('docs.share.claiming')}
    </div>
  )
}
