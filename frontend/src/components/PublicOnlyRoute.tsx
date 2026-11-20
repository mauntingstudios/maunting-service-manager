import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Loader } from '@/components/app/Loader'
import { PANEL_HOME } from '@/lib/panelWege'

export function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated && isLoading) {
      checkAuth()
    }
  }, [isAuthenticated, isLoading, checkAuth])

  if (isLoading) {
    return <Loader fullScreen label="Maunting Service Manager" />
  }

  if (isAuthenticated) {
    return <Navigate to={PANEL_HOME} replace />
  }

  return <>{children}</>
}
