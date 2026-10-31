/**
 * Team-Tresor (E2EE Zero-Knowledge für Teams / Familien).
 *
 * 1:1 Wiederverwendung der Tresor-Kryptographie, Design-DNA und UI-Muster.
 * Delegiert 1:1 an die vereinheitlichte VaultView Komponente im Team-Modus.
 */

import type { TeamDetail } from '@/api/teams'
import { VaultView } from './VaultView'

export interface TeamVaultViewProps {
  team: TeamDetail
}

export function TeamVaultView({ team }: TeamVaultViewProps) {
  return <VaultView mode="team" team={team} />
}
