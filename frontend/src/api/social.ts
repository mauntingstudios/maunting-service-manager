/**
 * Social, Friends, Achievements & E2EE API Client
 */

import { api, apiStream } from './client'
import i18n from '@/i18n'
import type { Zweitnachweis } from '@/services/passkeyService'

export interface FriendItem {
  id: number
  user_id: number
  username: string
  avatar_url?: string | null
  status: 'pending' | 'accepted' | 'blocked'
  is_requester: boolean
  presence?: PresenceItem | null
  info?: UserInfo | null
  created_at: string
}

/** Was der Server über den Zustand eines Kontos sagt. */
export type PraesenzStatus = 'online' | 'away' | 'offline' | 'invisible'
/** Die Wahl des Menschen; `auto` überlässt die Abwesenheit den Sitzungen. */
export type PraesenzWahl = 'auto' | 'online' | 'away' | 'invisible'
/** Welche Oberfläche offen ist. */
export type PraesenzClient = 'web' | 'pontis' | 'mss'

export interface PresenceItem {
  user_id?: number
  username?: string
  status: PraesenzStatus
  manual_status?: PraesenzWahl
  device_type: 'web' | 'desktop' | 'mobile'
  client?: PraesenzClient | null
  /** Schlüssel aus der Aktivitätenliste; die Oberfläche übersetzt ihn. */
  activity_key?: string | null
  last_seen_at?: string | null
  updated_at?: string | null
}

/** Der freiwillige Info-Text eines Kontos. */
export interface UserInfo {
  text: string
  visibility: UserInfoSichtbarkeit
  expires_at?: string | null
  updated_at?: string | null
}

export type UserInfoSichtbarkeit = 'friends' | 'public' | 'nobody'

export interface UserInfoPayload {
  text: string
  visibility: UserInfoSichtbarkeit
  /** 0 heisst „fuer immer“; hoechstens ein Jahr. */
  dauer_sekunden: number
}

export interface PresenceSessionPayload {
  geraet: string
  client: PraesenzClient
  plattform: 'web' | 'desktop' | 'mobile'
  zustand: 'online' | 'away'
  activity_key?: string | null
  vorn: boolean
}

export interface AchievementItem {
  id: string
  title: string
  description: string
  category: string
  points: number
  icon: string
  unlocked: boolean
  unlocked_at?: string | null
  global_unlocked_percentage?: number
  rarity_percent?: number
  rarity_tier?: string
  rarity_text?: string
  unlocked_count?: number
}

export interface AchievementsOverview {
  achievements: AchievementItem[]
  total_unlocked: number
  total_available: number
  prestige_score: number
}

export interface UserStatsResponse {
  user_id?: number
  username?: string
  total_achievements: number
  unlocked_achievements: number
  total_points: number
  earned_points: number
  active_time_seconds: number
  active_time_by_category: Record<string, number>
  // Aliases for component ergonomics
  achievements_unlocked: number
  total_activity_seconds: number
  categories: Record<string, number>
  rarity_summary?: Record<string, unknown>
}

/**
 * Ein fremdes Profil, wie `GET /social/profile/user/{id}` es liefert.
 *
 * Wer es nicht sehen darf (privat, nur Freunde, blockiert), bekommt 404 wie
 * für ein Konto, das es nie gab. `restricted` taucht nur noch in der Liste
 * der öffentlichen Profile auf.
 */
export interface PublicProfileResponse {
  user_id: number
  username: string
  avatar_url?: string | null
  privacy: 'private' | 'friends' | 'public'
  is_friend?: boolean
  /** Tag der Registrierung (`YYYY-MM-DD`), ohne Uhrzeit. */
  member_since?: string | null
  presence?: Omit<PresenceItem, 'user_id' | 'username'> | null
  info?: UserInfo | null
  achievements?: AchievementItem[] | null
  stats?: UserStatsResponse | null
  restricted?: boolean
}

export async function getFriends(): Promise<FriendItem[]> {
  return api<FriendItem[]>('/social/friends')
}

export async function sendFriendRequest(
  targetUsername: string,
): Promise<{ id: number; request_id: number; status: 'pending'; message: string }> {
  return api<{ id: number; request_id: number; status: 'pending'; message: string }>(
    '/social/friends/request',
    {
      method: 'POST',
      body: JSON.stringify({ username: targetUsername, target_username: targetUsername }),
    },
  )
}

export async function acceptFriendRequest(
  requestId: number,
): Promise<{ ok: boolean; status?: string; message: string }> {
  return api<{ ok: boolean; status?: string; message: string }>(
    `/social/friends/${requestId}/accept`,
    { method: 'POST' },
  )
}

export async function declineFriendRequest(
  requestId: number,
): Promise<{ ok: boolean; message: string }> {
  return api<{ ok: boolean; message: string }>(
    `/social/friends/${requestId}/decline`,
    { method: 'POST' },
  )
}

/**
 * Meldet eine Errungenschaft, die nur dieses Gerät feststellen kann.
 *
 * Für die Funken-Meilensteine: der Server kennt keinen Funken und kann den
 * Stand nicht prüfen. Er erfährt nur „dieses Konto hat 100 Tage erreicht",
 * nie mit wem. Der Server nimmt nur die Kennungen an, die er dafür freigibt.
 */
export async function claimAchievement(achievementId: string): Promise<{ unlocked: boolean }> {
  return api<{ unlocked: boolean }>('/social/achievements/claim', {
    method: 'POST',
    body: JSON.stringify({ achievement_id: achievementId }),
  })
}

export async function removeFriend(friendUserId: number): Promise<{ success: boolean }> {
  return api<{ success: boolean }>(`/social/friends/${friendUserId}`, {
    method: 'DELETE',
  })
}

export async function getBlockedUsers(): Promise<FriendItem[]> {
  return api<FriendItem[]>('/social/friends/blocked')
}

export async function blockUserApi(targetUserId: number): Promise<{ ok: boolean; message: string }> {
  return api<{ ok: boolean; message: string }>(`/social/friends/${targetUserId}/block`, {
    method: 'POST',
  })
}

export async function unblockUserApi(targetUserId: number): Promise<{ ok: boolean; message: string }> {
  return api<{ ok: boolean; message: string }>(`/social/friends/${targetUserId}/unblock`, {
    method: 'POST',
  })
}

export async function getPresence(): Promise<PresenceItem[]> {
  return api<PresenceItem[]>('/social/presence')
}

export async function getOwnPresence(): Promise<PresenceItem> {
  return api<PresenceItem>('/social/presence/me')
}

export async function setPresenceStatus(manual_status: PraesenzWahl): Promise<PresenceItem> {
  return api<PresenceItem>('/social/presence/status', {
    method: 'PATCH',
    body: JSON.stringify({ manual_status }),
  })
}

export async function sendPresenceSession(payload: PresenceSessionPayload): Promise<PresenceItem> {
  return api<PresenceItem>('/social/presence/session', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getOwnInfo(): Promise<UserInfo | null> {
  return api<UserInfo | null>('/social/info')
}

export async function setOwnInfo(payload: UserInfoPayload): Promise<UserInfo | null> {
  return api<UserInfo | null>('/social/info', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function endPresenceSession(
  geraet: string,
  keepalive = false,
): Promise<PresenceItem> {
  return api<PresenceItem>(`/social/presence/session/${encodeURIComponent(geraet)}`, {
    method: 'DELETE',
    ...(keepalive ? { keepalive: true } : {}),
  })
}

export async function getAchievements(): Promise<AchievementsOverview> {
  return api<AchievementsOverview>('/social/achievements')
}

export async function getStats(): Promise<UserStatsResponse> {
  return api<UserStatsResponse>('/social/stats')
}

export interface FriendRequestsResponse {
  incoming: FriendItem[]
  outgoing: FriendItem[]
}

export async function getFriendRequests(): Promise<FriendRequestsResponse> {
  return api<FriendRequestsResponse>('/social/friends/requests')
}

export async function getProfile(userId: number): Promise<PublicProfileResponse> {
  return api<PublicProfileResponse>(`/social/profile/user/${userId}`)
}

export async function getPublicProfiles(search?: string): Promise<PublicProfileResponse[]> {
  const q = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
  return api<PublicProfileResponse[]>(`/social/profiles/public${q}`)
}

export async function updatePrivacy(payload: {
  privacy?: 'private' | 'friends' | 'public'
  social_privacy?: 'private' | 'friends' | 'public'
}): Promise<{ success: boolean; social_privacy?: string }> {
  const privacyVal = payload.privacy ?? payload.social_privacy ?? 'friends'
  return api<{ success: boolean; social_privacy?: string }>('/social/privacy', {
    method: 'PATCH',
    body: JSON.stringify({ privacy: privacyVal }),
  })
}

export interface E2eeGeraetItem {
  id?: number
  device_id: string
  public_key: string
  /**
   * ECDSA P-256, beglaubigt den Absender einer Gruppennachricht. Leer heißt:
   * dieses Gerät war seit der Umstellung nicht an. Siehe `absenderSignatur.ts`.
   */
  signing_public_key: string
  label: string
  /** Wort des Servers. Die Clients glauben stattdessen der Unterschrift darunter. */
  is_approved?: boolean
  /** Das Gerät, das dieses freigegeben hat, und seine Unterschrift (`vertrauteGeraete`). */
  approved_by?: string
  approval_signature?: string
  /**
   * Die opake Zustelladresse des Geräts, falls es den neuen Weg kennt.
   *
   * Sie entsteht aus einem Geheimnis, das nur das Gerät kennt; allein bringt
   * sie nichts, zum Abholen gehört der Gerätebeleg dazu.
   */
  inbox_hash?: string
  /** Die Transportfähigkeit des Geräts. Leer heißt: der alte Weg. */
  transport?: string
}

/**
 * Veroeffentlicht den Schluessel *dieses* Geraets.
 *
 * Keine Benutzerkennung im Rumpf: sie kommt aus der Sitzung. Ein Geraet kann
 * damit ausschliesslich seinen eigenen Eintrag schreiben.
 */
export async function putEigenesGeraet(payload: {
  deviceId: string
  publicKey: string
  signingPublicKey?: string
  label?: string
  /** Selbst-Signatur des Erstgeräts über seine eigene Freigabe. */
  approvalSignature?: string
  /**
   * Die opake Zustelladresse dieses Geräts.
   *
   * Sie entsteht aus dem geheimen Schlüsselpaar des Geräts und ist damit
   * nur für dieses Gerät berechenbar. Fehlt sie, benutzt das Gerät den alten
   * Weg (geteilte Mailbox) und kennt die Zustellung mit Quittung nicht.
   */
  inboxHash?: string
}): Promise<E2eeGeraetItem> {
  return api<E2eeGeraetItem>('/social/e2ee/devices/self', {
    method: 'PUT',
    body: JSON.stringify({
      device_id: payload.deviceId,
      public_key: payload.publicKey,
      signing_public_key: payload.signingPublicKey ?? '',
      label: payload.label ?? '',
      approval_signature: payload.approvalSignature ?? '',
      inbox_hash: payload.inboxHash ?? '',
    }),
  })
}

/** Die Zustelladressen eines Kontos — je Geraet eine. */
export async function getE2eeGeraete(userId: number, includeUnapproved = false): Promise<E2eeGeraetItem[]> {
  const query = includeUnapproved ? '?include_unapproved=true' : ''
  return api<E2eeGeraetItem[]>(`/social/e2ee/devices/${userId}${query}`)
}

/** Gibt ein wartendes Gerät frei — mit der Unterschrift eines freigegebenen (`gebeGeraetFrei`). */
export async function approveEigenesGeraet(
  deviceId: string,
  approverDeviceId: string,
  signature: string,
): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/social/e2ee/devices/self/approve', {
    method: 'POST',
    body: JSON.stringify({
      device_id: deviceId,
      approver_device_id: approverDeviceId,
      signature,
    }),
  })
}

export interface ReapproveEigenesGeraetInput {
  password?: string | null
  confirmation?: string | null
  otp_code?: string | null
  /** Unterschriebene Passkey-Antwort (`passkeyNachweis('e2ee_reapprove')`). */
  passkey?: Zweitnachweis | null
  /** Eigene Unterschrift über die Freigabe — belegt nur den eigenen Schlüssel. */
  signature?: string | null
}

/**
 * Holt das eigene Geraet zurueck, wenn es das einzige ist (`gibMichSelbstFrei`).
 *
 * Nur ohne ein anderes freigegebenes Geraet — sonst antwortet der Server 403,
 * weil die Unterschrift der vorgesehene Weg ist. Der Nachweis ist Pflicht.
 */
export async function reapproveEigenesGeraet(
  deviceId: string,
  input: ReapproveEigenesGeraetInput = {},
): Promise<{ ok: boolean; is_approved: boolean }> {
  return api<{ ok: boolean; is_approved: boolean }>('/social/e2ee/devices/self/reapprove', {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId, ...input }),
  })
}

export async function getPendingE2eeGeraete(): Promise<E2eeGeraetItem[]> {
  return api<E2eeGeraetItem[]>('/social/e2ee/devices/self/pending')
}

/**
 * Der gestaffelte Nachweis vor dem Entfernen eines Geräts.
 *
 * Genau das, was das Konto hergibt: der eingerichtete zweite Faktor (Passkey
 * oder Code), sonst das Passwort. Ein Konto ohne beides — Social Login ohne
 * Passwort — braucht nichts, dort ist die Sitzung der Nachweis.
 */
export interface EntfernenNachweis {
  password?: string | null
  otp_code?: string | null
  passkey?: Zweitnachweis | null
}

/**
 * Entfernt ein Gerät und sperrt seine Sitzung sofort. Ein freigegebenes
 * verlangt die Unterschrift eines freigegebenen (`entferneGeraet`), dazu den
 * Nachweis aus `EntfernenNachweis`.
 */
export async function removeEigenesGeraet(
  deviceId: string,
  approverDeviceId?: string,
  signature?: string,
  nachweis: EntfernenNachweis = {},
): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/social/e2ee/devices/self/remove', {
    method: 'POST',
    body: JSON.stringify({
      device_id: deviceId,
      approver_device_id: approverDeviceId ?? '',
      signature: signature ?? '',
      password: nachweis.password ?? null,
      otp_code: nachweis.otp_code ?? null,
      passkey: nachweis.passkey ?? null,
    }),
  })
}

export interface ResetEigeneGeraeteInput {
  password?: string | null
  confirmation?: string | null
  otp_code?: string | null
  /** Unterschriebene Passkey-Antwort (`passkeyNachweis('e2ee_reset')`). */
  passkey?: Zweitnachweis | null
}

/** Alle Geräte verloren: Verzeichnis leeren, andere Sitzungen sperren. */
export async function resetEigeneGeraete(
  input: string | ResetEigeneGeraeteInput,
): Promise<{ ok: boolean; removed: number }> {
  const payload = typeof input === 'string' ? { password: input } : input
  return api<{ ok: boolean; removed: number }>('/social/e2ee/devices/self/reset', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Der `applicationServerKey`. Leer heißt: dieses Panel kann nicht zustellen. */
export async function getPushPublicKey(): Promise<string> {
  const antwort = await api<{ key: string }>('/social/push/public-key')
  return antwort.key || ''
}

export async function meldePushAbo(abo: {
  endpoint: string
  p256dh: string
  auth: string
}): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/social/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(abo),
  })
}

export async function loeschePushAbo(endpoint: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(
    `/social/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
    { method: 'DELETE' }
  )
}

export interface ChatGroupMemberItem {
  user_id: number
  username: string
  avatar_url?: string | null
  role: string
  permissions?: string | null
  /**
   * Ob **dieses Mitglied** alle wecken, anheften beziehungsweise die
   * Verfallsfrist der Gruppe stellen darf.
   *
   * Vom Server ausgerechnet, und zwar je Mitglied, nicht nur für mich: der
   * Server kann den Inhalt einer Nachricht nicht lesen, also entscheidet das
   * empfangende Gerät — und das braucht dafür die Rechtelage des *Absenders*.
   * Fehlt das Feld, gilt nein.
   */
  can_mention_everyone?: boolean
  can_pin_messages?: boolean
  can_set_disappearing_messages?: boolean
  /** Ob dieses Mitglied die Gruppeninfo beziehungsweise den Hintergrund setzen darf. */
  can_edit_group?: boolean
  can_set_group_background?: boolean
  joined_at: string
}

export interface ChatGroupItem {
  id: number
  /**
   * `null`, solange dieses Gerät den Namen nicht kennt.
   *
   * Der Server liefert hier seit Stufe 6 **immer** `null` — er kennt den Namen
   * einer Gruppe nicht mehr. Gefüllt wird das Feld im Client aus dem
   * versiegelten Namensspeicher und dem verschlüsselten Gruppenblock
   * (`gruppenName.ts`). Dass der Typ das zulässt, ist Absicht: ein
   * `name: string` wäre eine Zusage, die niemand mehr einhält, und jede
   * Anzeige führe blind auf einen leeren String.
   */
  name: string | null
  description?: string | null
  avatar_url?: string | null
  /**
   * `null`, wenn dieses Mitglied nicht einladen darf.
   *
   * Das Backend lässt den Code dann ganz weg — und das ist die einzige
   * Durchsetzung, die `invite_members` haben kann: wer den Code hat, kommt
   * rein. Bis 09/2026 ging er bei jedem Abruf an jedes Mitglied.
   */
  invite_code: string | null
  owner_user_id: number
  member_count: number
  role: string
  default_permissions?: string | null
  /** Vom Backend entschieden. Was hier false ist, endet dort in einem 403. */
  can_start_call?: boolean
  can_join_call?: boolean
  can_share_screen?: boolean
  can_mute_others?: boolean
  can_kick_from_call?: boolean
  /** Ob ich die Auswahl angeboten bekomme. Die Schranke sitzt beim Empfänger. */
  can_mention_everyone?: boolean
  can_pin_messages?: boolean
  can_set_disappearing_messages?: boolean
  /** Gruppeninfo und geteilter Hintergrund sind getrennte Wege. */
  can_edit_group?: boolean
  can_set_group_background?: boolean
  can_manage_roles?: boolean
  created_at: string
  members: ChatGroupMemberItem[]
  /** Ephemeral room token supplied by a live-call invitation, when present. */
  room_token?: string | null
}

export interface ChatGroupInvitePublic {
  group_id: number
  /**
   * Klartext — und nur, solange die Gruppe keine verschlüsselte Karte hat.
   *
   * Sobald sie eine hat, liefert der Server hier `null`, und die Vorschau kommt
   * aus `invite_card` plus dem Schlüssel hinter der Raute im Link. Beides
   * nebeneinander wäre Verschlüsselung als Zierde.
   */
  name?: string | null
  description?: string | null
  avatar_url?: string | null
  /** `sv-einladung-v1:…` — Name, Beschreibung und Logo, verschlüsselt. */
  invite_card?: string | null
  member_count: number
  /** Läuft gerade ein Gruppenanruf? Für die Vorschaukarte im Chat. */
  live_call: boolean
  live_participants: number
}

export interface DirectChatItem {
  id: number
  other_user_id: number
  other_username: string
  other_avatar_url?: string | null
  blind_mailbox_id: string
  is_friend: boolean
  is_blocked?: boolean
  other_privacy: 'private' | 'friends' | 'public'
  presence?: PresenceItem | null
  info?: UserInfo | null
  created_at: string
  updated_at: string
}

/*
 * `getDirectChats()` rief bis Stufe 6b `GET /social/direct-chats`.
 *
 * Diese Route ist entfernt. Sie beantwortete „mit wem schreibt dieses Konto?",
 * und um das zu können, musste der Server es aufschreiben — in
 * `direct_chats.user_a_id`/`user_b_id`. Die Liste führt jetzt der Client:
 * `gespraechsListe()` aus `services/gespraechsListe.ts`, versiegelt im
 * örtlichen Speicher.
 */

// Anrufe liegen in `api/calls.ts`: Einladungen, Zugangstoken für den
// Medienserver, Raumschlüssel und die Betreiber-Einstellungen.

export async function checkCanMessage(targetUserId: number): Promise<{
  can_message: boolean
  reason?: string | null
  blind_mailbox_id?: string | null
}> {
  return api<{ can_message: boolean; reason?: string | null; blind_mailbox_id?: string | null }>(
    `/social/chat/can-message/${targetUserId}`
  )
}

export async function startDirectChat(targetUserId: number): Promise<DirectChatItem> {
  return api<DirectChatItem>(`/social/chat/start/${targetUserId}`, {
    method: 'POST',
  })
}

/**
 * Hinterlegt den blinden Besitznachweis einer Mailbox.
 *
 * Der authentifizierte Übergang: danach verlangt der Server für diese Mailbox
 * bei jedem Zugriff den Nachweis — zusätzlich zur bisherigen Prüfung, nicht an
 * ihrer Stelle.
 */
export interface ChatMediaItem {
  id: string
  chat_type: 'direct' | 'group'
  chat_id: number
  file_name: string
  media_type: string
  size_bytes: number
  sha256: string
  created_at: string
}

export async function uploadChatMedia(payload: {
  chat_type: 'direct' | 'group'
  chat_id: number
  ciphertext_blob: string
  file_name: string
  media_type?: string
  expires_at?: string | null
}): Promise<ChatMediaItem> {
  return api<ChatMediaItem>('/social/media/upload', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getChatMediaSignedUrl(
  mediaId: string,
  ttl: number = 900,
  blindMailboxId?: string,
): Promise<{ media_id: string; signed_url: string; expires_at: string }> {
  void blindMailboxId
  return api<{ media_id: string; signed_url: string; expires_at: string }>(
    `/social/media/${mediaId}/signed-url?ttl=${ttl}`,
  )
}

/**
 * Löscht einen hochgeladenen Anhang endgültig. Nur der Absender darf das.
 *
 * Ein Anhang liegt nicht im Umschlag, sondern als eigener Blob daneben. Ohne
 * diesen Aufruf wäre die Nachricht gelöscht und das Bild weiter abrufbar.
 */
export async function loescheChatMedium(
  mediaId: string
): Promise<{ ok: boolean; deleted: boolean }> {
  return api<{ ok: boolean; deleted: boolean }>(
    `/social/media/${encodeURIComponent(mediaId)}`,
    { method: 'DELETE' }
  )
}

/**
 * Nimmt die Umschläge einer gelöschten Nachricht aus der blinden Mailbox.
 *
 * Adressiert wird über die logische Nachrichtenkennung: dieselbe Nachricht
 * liegt dort als eine Kopie je Zielgerät (`<kennung>#<geraet>`).
 */
export async function downloadChatMedia(signedUrl: string, blindMailboxId?: string): Promise<string> {
  void blindMailboxId
  const res = await apiStream(signedUrl, {
    method: 'GET',
    headers: { Accept: '*/*' },
  })
  if (!res.ok) {
    throw new Error(i18n.t('chat.errors.mediaDownloadFailed', { status: res.status }))
  }
  return await res.text()
}

/**
 * Verschlüsselt einen Anhang auf diesem Gerät und lädt ihn hoch.
 *
 * Zurück kommt, was der Empfänger braucht, um wieder an ihn heranzukommen:
 * Medienkennung, Paketschlüssel und Anhangkennung. Die drei reisen im
 * Nachrichten-Payload, also innerhalb des Double Ratchets beziehungsweise des
 * Gruppenschlüssels — nie am Server vorbei und nie an ihm vorbeischaubar.
 *
 * Dateiname und Dateityp gehen bewusst **nicht** mit. Der Server speichert
 * beides im Klartext neben dem Blob, und ein Umschlag, den niemand öffnen kann,
 * nützt wenig, wenn daneben „Gehaltsabrechnung.pdf" steht. Gebraucht wird es
 * dort auch nicht: ausgeliefert wird ohnehin als `application/octet-stream`.
 * Was die Anzeige braucht, steht im versiegelten Manifest und im
 * verschlüsselten Nachrichten-Payload.
 */
export async function ladeAnhangHoch(eingabe: {
  klartext: string
  dateiname: string
  mimeType: string
  blindMailboxId: string
  chatType: 'direct' | 'group'
  chatId: number
  absenderId: number
  expiresAt?: string | null
}): Promise<import('@/services/medienKrypto').MedienZeiger> {
  const { neueFileId, verschluesselePaket } = await import('@/services/medienKrypto')
  const fileId = neueFileId()
  const { blob, paketSchluessel } = await verschluesselePaket(
    eingabe.klartext,
    {
      absenderId: eingabe.absenderId,
      blindMailboxId: eingabe.blindMailboxId,
      fileId,
    },
    { name: eingabe.dateiname, mimeType: eingabe.mimeType || null },
  )
  const hochgeladen = await uploadChatMedia({
    chat_type: eingabe.chatType,
    chat_id: eingabe.chatId,
    ciphertext_blob: blob,
    file_name: 'anhang.bin',
    media_type: 'application/octet-stream',
    expires_at: eingabe.expiresAt || null,
  })
  return { mediaId: hochgeladen.id, paketSchluessel, fileId }
}

/** Holt einen Anhang über seine signierte URL und öffnet ihn auf diesem Gerät. */
export async function ladeAnhangHerunter(
  zeiger: import('@/services/medienKrypto').MedienZeiger,
  bindung: { absenderId: number; blindMailboxId: string }
): Promise<string> {
  const { entschluesselePaket } = await import('@/services/medienKrypto')
  const { signed_url } = await getChatMediaSignedUrl(zeiger.mediaId, 900, bindung.blindMailboxId)
  const blob = await downloadChatMedia(signed_url, bindung.blindMailboxId)
  return entschluesselePaket(blob, zeiger.paketSchluessel, {
    absenderId: bindung.absenderId,
    blindMailboxId: bindung.blindMailboxId,
    fileId: zeiger.fileId,
  })
}

export async function getGroups(): Promise<ChatGroupItem[]> {
  return api<ChatGroupItem[]>('/social/groups')
}

/**
 * Legt eine Gruppe an — ohne ihr einen Namen mitzugeben.
 *
 * Seit Stufe 6 hat der Aufruf keine Nutzlast mehr: Name, Beschreibung und Logo
 * gehen den Server nichts an. Er vergibt eine Kennung und einen Einladungscode,
 * alles Weitere schreibt der Client anschliessend in den verschlüsselten
 * Gruppenblock (`sichereGruppenAnsicht`).
 */
export async function createGroup(): Promise<ChatGroupItem> {
  return api<ChatGroupItem>('/social/groups', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function getGroupInviteInfo(inviteCode: string): Promise<ChatGroupInvitePublic> {
  return api<ChatGroupInvitePublic>(`/social/groups/invite/${inviteCode}`)
}

/**
 * Hinterlegt die verschlüsselte Einladungskarte einer Gruppe.
 *
 * `null` nimmt sie zurück. Gerufen wird das beim Bauen eines Links — die Karte
 * entsteht genau dann, wenn jemand einen teilt, und trägt denselben Stand wie
 * er.
 */
export async function setzeEinladungsKarte(
  groupId: number,
  karte: string | null,
): Promise<void> {
  await api(`/social/groups/${groupId}/invite-card`, {
    method: 'PUT',
    body: JSON.stringify({ invite_card: karte }),
  })
}

export async function joinGroupByInvite(inviteCode: string): Promise<ChatGroupItem> {
  return api<ChatGroupItem>(`/social/groups/join/${inviteCode}`, {
    method: 'POST',
  })
}

export async function leaveGroup(groupId: number): Promise<{ success: boolean; message: string }> {
  return api<{ success: boolean; message: string }>(`/social/groups/${groupId}/leave`, {
    method: 'POST',
  })
}

export async function deleteGroup(groupId: number): Promise<{ success: boolean; message: string }> {
  return api<{ success: boolean; message: string }>(`/social/groups/${groupId}`, {
    method: 'DELETE',
  })
}

export async function getGroupMembers(groupId: number): Promise<ChatGroupMemberItem[]> {
  return api<ChatGroupMemberItem[]>(`/social/groups/${groupId}/members`)
}

export async function updateGroupMemberRole(
  groupId: number,
  targetUserId: number,
  role: 'admin' | 'moderator' | 'member',
  permissions?: string
): Promise<ChatGroupMemberItem> {
  return api<ChatGroupMemberItem>(`/social/groups/${groupId}/members/${targetUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role, permissions: permissions || null }),
  })
}

/**
 * Wirft ein Mitglied hinaus. Der Einladungscode ist danach ein neuer.
 *
 * `invite_code` ist der neue Code — oder `null`, wenn der Aufrufer nicht
 * einladen darf und ihn deshalb auch hier nicht bekommt. Der alte Link führt
 * nicht mehr hinein, und die Einladungskarte ist weg.
 */
export async function kickGroupMember(
  groupId: number,
  targetUserId: number
): Promise<{ success: boolean; message: string; invite_code: string | null }> {
  return api<{ success: boolean; message: string; invite_code: string | null }>(
    `/social/groups/${groupId}/members/${targetUserId}`,
    { method: 'DELETE' },
  )
}

export async function updateGroupPermissions(
  groupId: number,
  defaultPermissions: string
): Promise<ChatGroupItem> {
  return api<ChatGroupItem>(`/social/groups/${groupId}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify({ default_permissions: defaultPermissions }),
  })
}

/**
 * Der verschlüsselte Gruppenzustand: die eigenen Rollen dieser Gruppe.
 *
 * `blob` ist ein Umschlag unter dem Gruppenschlüssel — das Backend reicht ihn
 * durch und liest ihn nie. Ausgewertet wird er in `services/gruppenKonfig.ts`;
 * hier steht nur der Transport.
 */
export interface GruppenKonfigAntwort {
  group_id: number
  blob: string
  revision: number
  updated_at: string
}

/** `null`, solange die Gruppe noch keinen Zustand hat — dann ist Revision 0. */
export async function getGroupConfig(groupId: number): Promise<GruppenKonfigAntwort | null> {
  return api<GruppenKonfigAntwort | null>(`/social/groups/${groupId}/config`)
}

/**
 * Schreibt den nächsten Stand. `erwarteteRevision` ist der Stand, den dieses
 * Gerät gelesen hat; kam ein anderes dazwischen, antwortet das Backend mit 409
 * und es wird nichts überschrieben.
 */
export async function putGroupConfig(
  groupId: number,
  blob: string,
  erwarteteRevision: number,
): Promise<GruppenKonfigAntwort> {
  return api<GruppenKonfigAntwort>(`/social/groups/${groupId}/config`, {
    method: 'PUT',
    body: JSON.stringify({ blob, erwartete_revision: erwarteteRevision }),
  })
}

/**
 * Die getrennte Gruppeninfo (Name, Beschreibung, Logo) und der geteilte
 * Gruppenhintergrund. Beide liegen verschlüsselt beim Server; hier steht nur
 * der Transport. Ausgewertet werden sie in `services/gruppenInfo.ts`.
 */
export interface GruppenInfoAntwort {
  group_id: number
  blob: string
  revision: number
  updated_at: string
}

export interface GruppenHintergrundAntwort extends GruppenInfoAntwort {
  mime: string | null
  size_bytes: number
}

/** `null`, solange die Gruppe noch keine getrennte Info hat. */
export async function getGroupInfo(groupId: number): Promise<GruppenInfoAntwort | null> {
  return api<GruppenInfoAntwort | null>(`/social/groups/${groupId}/info`)
}

export async function putGroupInfo(
  groupId: number,
  blob: string,
  erwarteteRevision: number,
): Promise<GruppenInfoAntwort> {
  return api<GruppenInfoAntwort>(`/social/groups/${groupId}/info`, {
    method: 'PUT',
    body: JSON.stringify({ blob, erwartete_revision: erwarteteRevision }),
  })
}

export async function getGroupBackground(
  groupId: number,
): Promise<GruppenHintergrundAntwort | null> {
  return api<GruppenHintergrundAntwort | null>(`/social/groups/${groupId}/background`)
}

export async function putGroupBackground(
  groupId: number,
  blob: string,
  erwarteteRevision: number,
  mime: string | null,
): Promise<GruppenHintergrundAntwort> {
  return api<GruppenHintergrundAntwort>(`/social/groups/${groupId}/background`, {
    method: 'PUT',
    body: JSON.stringify({
      blob,
      erwartete_revision: erwarteteRevision,
      mime,
    }),
  })
}

/*
 * `uploadGroupAvatar` und `deleteGroupAvatar` gibt es seit Stufe 6 nicht mehr.
 *
 * Ein Gruppenlogo auf der Platte des Servers ist eine Datei, die unter einer
 * rate-URL jedem offensteht, und ein Bild sagt über eine Gruppe oft mehr als
 * ihr Name. Das Logo lebt jetzt als Data-URL im verschlüsselten Gruppenblock;
 * gesetzt wird es über `sichereGruppenAnsicht` in `services/gruppenName.ts`.
 * Die Routen `POST/DELETE /social/groups/{id}/avatar` sind entfernt.
 */

export interface ChatStoryItem {
  id: number
  user_id: number
  username: string
  avatar_url?: string | null
  content: string
  media_url?: string | null
  background: string
  created_at: string
  expires_at: string
  is_self: boolean
}

export async function getStories(options: { limit?: number; beforeId?: number } = {}): Promise<ChatStoryItem[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.beforeId) params.set('before_id', String(options.beforeId))
  const query = params.toString()
  return api<ChatStoryItem[]>(`/social/stories${query ? `?${query}` : ''}`)
}

export async function createStory(payload: {
  content: string
  media_url?: string
  background?: string
}): Promise<ChatStoryItem> {
  return api<ChatStoryItem>('/social/stories', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteStory(storyId: number): Promise<{ success: boolean; message: string }> {
  return api<{ success: boolean; message: string }>(`/social/stories/${storyId}`, {
    method: 'DELETE',
  })
}

export async function recordActivityTime(category: string, seconds: number): Promise<{ success: boolean }> {
  return api<{ success: boolean }>('/social/activity/ping', {
    method: 'POST',
    body: JSON.stringify({ category, seconds }),
  })
}

// ── Ein einziger E2EE-Nachrichtenweg ─────────────────────────────────────────

export interface E2eeAccountItem {
  user_id: number
  public_key: string
  signing_public_key: string
}

export interface E2eeChatKeyItem {
  chat_type: 'direct' | 'group'
  chat_id: number
  key_version: number
  encrypted_chat_key: string
  created_at: string
}

export interface E2eeReactionItem {
  user_id: number
  encrypted_reaction: string
  created_at: string
}

export interface E2eeMessageItem {
  id: number
  client_uuid: string
  chat_type: 'direct' | 'group'
  chat_id: number
  sender_user_id: number
  key_version: number
  encrypted_payload: string
  is_deleted: boolean
  edited_at: string | null
  deleted_at: string | null
  expires_at: string | null
  is_pinned: boolean
  pinned_at: string | null
  pinned_by_user_id: number | null
  created_at: string
  reactions: E2eeReactionItem[]
}

export interface E2eeMessagePage {
  messages: E2eeMessageItem[]
  /** Die neueste Anheftung des Chats, unabhaengig von der geladenen Seite. */
  pinned_message?: E2eeMessageItem | null
  has_more: boolean
  my_last_delivered_id: number
  my_last_read_id: number
  partner_last_delivered_id: number
  partner_last_read_id: number
  ephemeral_ttl_seconds: number
  ephemeral_enabled_by_user_id: number | null
}

export async function publishE2eeAccount(payload: {
  device_id: string
  public_key: string
  signing_public_key: string
  encrypted_bundle: string
}): Promise<E2eeAccountItem & { device_id: string }> {
  return api('/social/e2ee/account', { method: 'PUT', body: JSON.stringify(payload) })
}

export async function getE2eeAccount(userId: number): Promise<E2eeAccountItem> {
  return api(`/social/e2ee/account/${userId}`)
}

export async function lookupE2eeAccounts(userIds: number[]): Promise<{ accounts: E2eeAccountItem[] }> {
  return api('/social/e2ee/account/lookup', {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds }),
  })
}

export async function getOwnE2eeAccountBundle(deviceId: string): Promise<{
  user_id: number
  device_id: string
  encrypted_bundle: string
}> {
  return api(`/social/e2ee/account/self/bundle?device_id=${encodeURIComponent(deviceId)}`)
}

export async function transferE2eeAccountBundle(
  targetDeviceId: string,
  encryptedBundle: string,
  ownDeviceId: string,
): Promise<{ ok: boolean }> {
  return api(`/social/e2ee/account/bundle/${encodeURIComponent(targetDeviceId)}`, {
    method: 'POST',
    body: JSON.stringify({ encrypted_bundle: encryptedBundle }),
    headers: { 'X-Device-Id': ownDeviceId },
  })
}

export async function getE2eeChatKeys(
  chatType: 'direct' | 'group',
  chatId: number,
): Promise<{ keys: E2eeChatKeyItem[]; latest_key_version: number }> {
  return api(`/social/e2ee/chat-keys?chat_type=${chatType}&chat_id=${chatId}`)
}

export async function putE2eeChatKeys(payload: {
  chat_type: 'direct' | 'group'
  chat_id: number
  key_version: number
  keys: { user_id: number; encrypted_chat_key: string }[]
}): Promise<{ keys: E2eeChatKeyItem[] }> {
  return api('/social/e2ee/chat-keys', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function sendChatMessage(payload: {
  chat_type: 'direct' | 'group'
  chat_id: number
  client_uuid: string
  key_version: number
  encrypted_payload: string
}): Promise<E2eeMessageItem> {
  return api('/social/messages/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchChatMessages(
  chatType: 'direct' | 'group',
  chatId: number,
  options: { limit?: number; beforeId?: number; afterId?: number } = {},
): Promise<E2eeMessagePage> {
  const params = new URLSearchParams({ chat_type: chatType, chat_id: String(chatId) })
  if (options.limit) params.set('limit', String(options.limit))
  if (options.beforeId) params.set('before_id', String(options.beforeId))
  if (options.afterId) params.set('after_id', String(options.afterId))
  return api(`/social/messages?${params.toString()}`)
}

export async function updateChatMessage(
  clientUuid: string,
  payload: { encrypted_payload: string; key_version?: number },
): Promise<E2eeMessageItem> {
  return api(`/social/messages/${encodeURIComponent(clientUuid)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteChatMessage(clientUuid: string): Promise<E2eeMessageItem> {
  return api(`/social/messages/${encodeURIComponent(clientUuid)}`, { method: 'DELETE' })
}

export async function reactToChatMessage(
  clientUuid: string,
  encryptedReaction: string | null,
): Promise<E2eeMessageItem> {
  return api(`/social/messages/${encodeURIComponent(clientUuid)}/reaction`, {
    method: 'POST',
    body: JSON.stringify({ encrypted_reaction: encryptedReaction }),
  })
}

export async function pinChatMessage(
  clientUuid: string,
  pinned: boolean,
): Promise<E2eeMessageItem> {
  return api(`/social/messages/${encodeURIComponent(clientUuid)}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  })
}

export async function ackChatMessages(
  chatType: 'direct' | 'group',
  chatId: number,
  upToId: number,
): Promise<{ ok: boolean; last_delivered_message_id: number }> {
  return api('/social/messages/ack', {
    method: 'POST',
    body: JSON.stringify({ chat_type: chatType, chat_id: chatId, up_to_id: upToId }),
  })
}

export async function readChatMessages(
  chatType: 'direct' | 'group',
  chatId: number,
  upToId: number,
): Promise<{ ok: boolean; last_read_message_id: number }> {
  return api('/social/messages/read', {
    method: 'POST',
    body: JSON.stringify({ chat_type: chatType, chat_id: chatId, up_to_id: upToId }),
  })
}

export async function getChatEphemeral(
  chatType: 'direct' | 'group',
  chatId: number,
): Promise<{
  chat_type: 'direct' | 'group'
  chat_id: number
  ephemeral_ttl_seconds: number
  ephemeral_enabled_by_user_id: number | null
}> {
  return api(`/social/messages/ephemeral?chat_type=${chatType}&chat_id=${chatId}`)
}

export async function setChatEphemeral(
  chatType: 'direct' | 'group',
  chatId: number,
  ttlSeconds: number,
): Promise<{
  chat_type: 'direct' | 'group'
  chat_id: number
  ephemeral_ttl_seconds: number
  ephemeral_enabled_by_user_id: number | null
}> {
  return api('/social/messages/ephemeral', {
    method: 'PUT',
    body: JSON.stringify({ chat_type: chatType, chat_id: chatId, ttl_seconds: ttlSeconds }),
  })
}

