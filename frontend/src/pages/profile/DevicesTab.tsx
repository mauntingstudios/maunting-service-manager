import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import { AiDevicePairingCard } from '@/components/ai/AiDevicePairingCard'
import { E2eeGeraeteCard } from '@/components/social/E2eeGeraeteCard'

/**
 * Die beiden Gerätekarten: Kopplung und Nachrichtenzugriff.
 *
 * **Eine Zusammensetzung für zwei Orte.** Profil → Sicherheit → Geräte und die
 * Sektion „Geräte" unter Sicherheit in MSS und Pontis zeigen dieselben Karten;
 * bis 10/2026 gab es nur einen eigenen Profil-Reiter, und wer in der App nach
 * seinen Geräten suchte, fand sie nirgends. Seit 10/2026 steht der Reiter
 * „Geräte" in Sicherheit, weil dort entschieden wird, wer Zugriff hat.
 *
 * Die Kopplung ist eine Kontofunktion, keine KI-Funktion: sie hängt nicht mehr
 * an `ai.chat.use`. Bis 10/2026 sah ein frisches Konto (Rolle „user" ohne
 * globale Rechte) zwar seine Geräte, aber keinen Weg, eines zu koppeln; die
 * KI-Routen bleiben trotzdem an ihrem Recht.
 */
export function GeraeteKarten({ social }: { social?: boolean } = {}) {
  const [socialEnabled, setSocialEnabled] = useState(social ?? true)

  useEffect(() => {
    // Kennt der Aufrufer die Antwort schon, wird nicht noch einmal gefragt.
    if (social !== undefined) return
    api<{ social_enabled?: boolean }>('/settings/public')
      .then((res) => {
        if (typeof res.social_enabled === 'boolean') setSocialEnabled(res.social_enabled)
      })
      .catch(() => {})
  }, [social])

  return (
    <div className="space-y-6">
      <AiDevicePairingCard />
      {socialEnabled && <E2eeGeraeteCard />}
    </div>
  )
}

/** Eigener Tab für Geräteverwaltung im Profil. */
export function DevicesTab() {
  return (
    <section className="space-y-6" aria-labelledby="devices-profile-title">
      <GeraeteKarten />
    </section>
  )
}
