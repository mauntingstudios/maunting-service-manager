import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { ProfilTab } from './ProfilTab'

vi.mock('@/api/client', () => ({ api: vi.fn() }))
vi.mock('@/components/social/InfoKarte', () => ({ InfoKarte: () => <div>inhalt:info</div> }))

const t = (key: string) => i18n.t(key)

function setUser() {
  useAuthStore.setState({
    user: {
      id: 1,
      username: 'test-user',
      email: 'test-user@example.invalid',
      is_owner: false,
      is_active: true,
      email_verified: true,
      two_factor_enabled: false,
      email_notifications: false,
      ai_notifications: false,
      role_id: null,
      created_at: '2026-08-28T00:00:00Z',
      social_privacy: 'friends',
    },
  })
}

describe('Profil-Reiter', () => {
  beforeEach(() => {
    setUser()
  })

  it('sagt neben der Profil-Sichtbarkeit, dass Anrufe Freunden vorbehalten bleiben', () => {
    // Der Irrtum entsteht genau hier: „Öffentlich" klingt danach, als dürfte
    // dann jeder anrufen. Das Backend weist solche Anrufe ab — die Oberfläche
    // muss es sagen, sonst erfährt man es nie.
    render(<ProfilTab />)

    expect(screen.getByText(t('profile.privacyCallsFriendsOnly'))).toBeInTheDocument()
    expect(screen.getByText('inhalt:info')).toBeInTheDocument()
  })

  it('ohne Social gibt es weder Info noch Sichtbarkeit', () => {
    render(<ProfilTab social={false} />)

    expect(screen.queryByText('inhalt:info')).toBeNull()
    expect(screen.queryByText(t('profile.privacyCallsFriendsOnly'))).toBeNull()
    expect(screen.getByRole('heading', { name: t('profile.tabs.profile') })).toBeInTheDocument()
  })
})
