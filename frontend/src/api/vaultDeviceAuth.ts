import { api } from '@/api/client'

export interface DeviceAuthSessionResponse {
  session_id: string
  session_token: string
  /** Nur im QR-Code enthalten, nie im Polling: belegt den Scan. */
  resolve_token: string
  expires_at: string
  purpose: 'authorize' | 'unlock'
}

export interface DeviceAuthStatusResponse {
  status: 'pending' | 'resolved' | 'expired' | 'not_found' | 'error'
  encrypted_payload?: string
  purpose?: 'authorize' | 'unlock'
  expires_in_seconds?: number
}

/**
 * Erzeugt auf dem Zielgerät (Desktop/Browser) eine neue ephemere Freigabe-Session.
 */
export async function createDeviceAuthSession(
  publicKey: string,
  purpose: 'authorize' | 'unlock' = 'authorize',
  deviceInfo?: string,
): Promise<DeviceAuthSessionResponse> {
  return await api<DeviceAuthSessionResponse>('/vault/device-auth/session', {
    method: 'POST',
    body: JSON.stringify({
      public_key: publicKey,
      purpose,
      device_info: deviceInfo,
    }),
  })
}

/**
 * Fragt vom Zielgerät aus ab, ob das Smartphone die Session aufgelöst hat.
 */
export async function getDeviceAuthSessionStatus(
  sessionId: string,
  sessionToken: string,
): Promise<DeviceAuthStatusResponse> {
  // Das Sitzungs-Token reist im Header, nicht in der URL.
  return await api<DeviceAuthStatusResponse>(
    `/vault/device-auth/session/${encodeURIComponent(sessionId)}`,
    { headers: { 'X-MSM-Device-Token': sessionToken } },
  )
}

/**
 * Löst die Session vom autorisierten Smartphone aus auf und übergibt die E2EE-Chiffre.
 * Das Aufloese-Token stammt aus dem gescannten QR-Code — ohne Scan kein Resolve.
 */
export async function resolveDeviceAuthSession(
  sessionId: string,
  encryptedPayload: string,
  resolveToken: string,
): Promise<{ success: boolean }> {
  return await api<{ success: boolean }>('/vault/device-auth/resolve', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      encrypted_payload: encryptedPayload,
      resolve_token: resolveToken,
    }),
  })
}
