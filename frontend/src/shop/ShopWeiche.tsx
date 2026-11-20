import { Navigate } from 'react-router-dom'
import { PANEL_HOME } from '@/lib/panelWege'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { ShopRahmen } from './ShopRahmen'

/**
 * Oeffentliche Shop-Weiche. Ist der Shop im Panel abgeschaltet, fuehrt `/`
 * direkt ins Panel (und von dort ggf. in den Login).
 */
export function ShopWeiche() {
  const aktiv = usePublicSettingsStore((s) => s.shop_enabled)

  if (!aktiv) {
    return <Navigate to={PANEL_HOME} replace />
  }

  return <ShopRahmen />
}
