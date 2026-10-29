import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Loader } from '@/components/ui/Loader'
import { BenutzernameWaehlen } from '@/pages/BenutzernameWaehlen'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()
  const mussNamenWaehlen = useAuthStore((s) => s.user?.username_gewaehlt === false)
  const location = useLocation()

  useEffect(() => {
    if (!isAuthenticated && isLoading) {
      checkAuth()
    }
  }, [isAuthenticated, isLoading, checkAuth])

  if (isLoading) {
    return <Loader fullScreen label="Maunting Service Manager" />
  }

  if (!isAuthenticated) {
    // Der Hash trägt bei Einladungen den Schlüssel (`#k=`); ohne ihn käme die
    // Karte nach der Anmeldung verschlossen an.
    const target = location.pathname + location.search + location.hash
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(target)}`}
        replace
        state={{ from: target }}
      />
    )
  }

  // Kein Umweg über eine eigene Route: die Adresse bleibt, und nach der Wahl
  // erscheint an ihr das Panel.
  if (mussNamenWaehlen) {
    return <BenutzernameWaehlen />
  }

  return <>{children}</>
}
