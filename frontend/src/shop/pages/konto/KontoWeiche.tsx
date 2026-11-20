import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { KontoRahmen } from './KontoRahmen'

export function KontoWeiche() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    const ziel = encodeURIComponent(location.pathname)
    return <Navigate to={`/login?redirect=${ziel}`} replace />
  }

  return <KontoRahmen />
}
