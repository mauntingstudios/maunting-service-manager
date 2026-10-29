import { api, apiStream, SanitizedApiError } from '@/api/client'
import { apiUrl } from '@/config/api'

export type DocRole = 'viewer' | 'commenter' | 'editor'
export type ShareRole = 'viewer' | 'commenter'

export interface DocSummary {
  uid: string
  title: string
  folder_uid: string | null
  icon?: string | null
  team_id: number
  team_name: string | null
  role: DocRole
  can_edit: boolean
  can_comment: boolean
  can_manage: boolean
  rev: number
  archived: boolean
  deleted: boolean
  content_truncated: boolean
  updated_at: string
  last_edited_at: string
  owner: string | null
}

export interface DocDetail extends DocSummary {
  default_role: DocRole
  schema_version: number
  shared: boolean
  share_role: ShareRole | null
  share_expires_at: string | null
}

export interface DocFolder {
  uid: string
  name: string
  parent_uid: string | null
  team_id: number
  created_at: string
}

export interface DocComment {
  uid: string
  parent_uid: string | null
  body: string
  anchor: { quote?: string; from?: unknown; to?: unknown } | null
  status: 'open' | 'resolved'
  author: string | null
  author_user_id: number | null
  created_at: string
  updated_at: string
}

export interface DocRevision {
  rev: number
  reason: string
  label: string | null
  preview: string
  size_bytes: number
  author: string | null
  author_kind: 'user' | 'ai' | 'system'
  ai_run_id: string | null
  created_at: string
}

export interface DocMemberRow {
  user_id: number
  username: string
  role: DocRole | null
  effective_role: DocRole
  source: 'manual' | 'team'
  is_team_owner: boolean
  is_doc_owner: boolean
}

export interface CollabToken {
  url: string
  token: string
  expires_at: string
  readonly: boolean
  role: DocRole
  rev: number
}

export interface DocsStatus {
  enabled: boolean
  sidecar_ok: boolean
  sidecar_version: string | null
  limits: Record<string, number>
}

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function listDocuments(params: {
  teamId?: number | null
  folderUid?: string | null
  search?: string
  archived?: boolean
  trash?: boolean
  member?: string
  limit?: number
  cursor?: number
} = {}): Promise<DocSummary[]> {
  return api<DocSummary[]>(
    `/docs${query({
      team_id: params.teamId ?? undefined,
      folder_uid: params.folderUid ?? undefined,
      search: params.search,
      archived: params.archived || undefined,
      trash: params.trash || undefined,
      member: params.member,
      limit: params.limit,
      cursor: params.cursor,
    })}`,
  )
}

export function getDocument(uid: string): Promise<DocDetail> {
  return api<DocDetail>(`/docs/${encodeURIComponent(uid)}`)
}

export function createDocument(input: { teamId?: number | null; folderUid?: string | null; title?: string } = {}): Promise<DocDetail> {
  return api<DocDetail>('/docs', {
    method: 'POST',
    body: JSON.stringify({
      team_id: input.teamId ?? null,
      folder_uid: input.folderUid ?? null,
      title: input.title ?? null,
    }),
  })
}

export function updateDocument(
  uid: string,
  input: Partial<Pick<DocDetail, 'title' | 'archived'>> & {
    icon?: string | null
    folder_uid?: string | null
    default_role?: DocRole
  },
): Promise<DocDetail> {
  return api<DocDetail>(`/docs/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function trashDocument(uid: string): Promise<{ ok: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}`, { method: 'DELETE' })
}

export function restoreDocument(uid: string): Promise<DocDetail> {
  return api(`/docs/${encodeURIComponent(uid)}/restore`, { method: 'POST' })
}

export function deleteDocumentPermanent(uid: string): Promise<{ ok: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}/permanent`, { method: 'DELETE' })
}

export function duplicateDocument(uid: string): Promise<DocDetail> {
  return api(`/docs/${encodeURIComponent(uid)}/duplicate`, { method: 'POST' })
}

export function listFolders(teamId?: number | null): Promise<DocFolder[]> {
  return api<DocFolder[]>(`/docs/folders${query({ team_id: teamId ?? undefined })}`)
}

export function createFolder(input: { teamId?: number | null; parentUid?: string | null; name: string }): Promise<DocFolder> {
  return api<DocFolder>('/docs/folders', {
    method: 'POST',
    body: JSON.stringify({
      team_id: input.teamId ?? null,
      parent_uid: input.parentUid ?? null,
      name: input.name,
    }),
  })
}

export function updateFolder(uid: string, input: { name?: string; parentUid?: string | null }): Promise<DocFolder> {
  return api<DocFolder>(`/docs/folders/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: input.name, parent_uid: input.parentUid }),
  })
}

export function deleteFolder(uid: string): Promise<{ ok: boolean }> {
  return api(`/docs/folders/${encodeURIComponent(uid)}`, { method: 'DELETE' })
}

export function listMembers(uid: string): Promise<DocMemberRow[]> {
  return api<DocMemberRow[]>(`/docs/${encodeURIComponent(uid)}/members`)
}

export function putMember(uid: string, userId: number, role: DocRole): Promise<{ ok: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
}

export function deleteMember(uid: string, userId: number): Promise<{ ok: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}/members/${userId}`, { method: 'DELETE' })
}

export function createShare(uid: string, role: ShareRole, expiresInDays = 7): Promise<{ url: string; role: ShareRole; expires_at: string }> {
  return api(`/docs/${encodeURIComponent(uid)}/share`, {
    method: 'POST',
    body: JSON.stringify({ role, expires_in_days: expiresInDays }),
  })
}

export function deleteShare(uid: string): Promise<{ ok: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}/share`, { method: 'DELETE' })
}

export function claimShare(token: string): Promise<DocDetail> {
  return api(`/docs/shared/${encodeURIComponent(token)}/claim`, { method: 'POST' })
}

export function listComments(uid: string, status?: 'open' | 'resolved'): Promise<DocComment[]> {
  return api(`/docs/${encodeURIComponent(uid)}/comments${query({ status })}`)
}

export function createComment(
  uid: string,
  body: string,
  parentUid?: string | null,
  anchor?: DocComment['anchor'],
): Promise<{ uid: string }> {
  return api(`/docs/${encodeURIComponent(uid)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, parent_uid: parentUid ?? null, anchor: anchor ?? null }),
  })
}

export function updateComment(
  uid: string,
  commentUid: string,
  input: { body?: string; status?: 'open' | 'resolved' },
): Promise<{ ok: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}/comments/${encodeURIComponent(commentUid)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteComment(uid: string, commentUid: string): Promise<{ ok: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}/comments/${encodeURIComponent(commentUid)}`, {
    method: 'DELETE',
  })
}

export function listRevisions(uid: string): Promise<DocRevision[]> {
  return api(`/docs/${encodeURIComponent(uid)}/revisions`)
}

export function createRevision(uid: string, label?: string): Promise<{ rev: number }> {
  return api(`/docs/${encodeURIComponent(uid)}/revisions`, {
    method: 'POST',
    body: JSON.stringify({ label: label ?? null }),
  })
}

export function restoreRevision(uid: string, rev: number): Promise<{ rev: number }> {
  return api(`/docs/${encodeURIComponent(uid)}/revisions/${rev}/restore`, { method: 'POST' })
}

export function undoAiEdit(uid: string): Promise<{ rev: number; undone: boolean }> {
  return api(`/docs/${encodeURIComponent(uid)}/ai-undo`, { method: 'POST' })
}

export function getCollabToken(uid: string): Promise<CollabToken> {
  return api(`/docs/${encodeURIComponent(uid)}/collab-token`, { method: 'POST' })
}

export function getDocsStatus(): Promise<DocsStatus> {
  return api('/docs/status')
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function arrayBufferToBase64(bytes: ArrayBuffer): string {
  let binary = ''
  const view = new Uint8Array(bytes)
  const chunk = 0x8000
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function uploadAsset(
  uid: string,
  file: File,
): Promise<{ asset_uid: string; signed_url: string; expires_at: string }> {
  const buffer = await file.arrayBuffer()
  const sha256 = await sha256Hex(buffer)
  return api(`/docs/${encodeURIComponent(uid)}/assets`, {
    method: 'POST',
    body: JSON.stringify({
      file_name: file.name,
      mime: file.type || 'application/octet-stream',
      data_base64: arrayBufferToBase64(buffer),
      sha256,
    }),
  })
}

export function assetUrl(signedUrl: string): string {
  return apiUrl(signedUrl)
}

export function getAssetSignedUrl(
  uid: string,
  assetUid: string,
  ttl = 3600,
): Promise<{ signed_url: string; expires_at: string }> {
  return api(
    `/docs/${encodeURIComponent(uid)}/assets/${encodeURIComponent(assetUid)}/signed-url?ttl=${ttl}`,
  )
}

export async function downloadExport(
  uid: string,
  format: 'html' | 'md' | 'txt',
  rev?: number,
): Promise<{ blob: Blob; filename: string }> {
  const response = await apiStream(
    `/docs/${encodeURIComponent(uid)}/export${query({ format, rev })}`,
    { method: 'GET' },
  )
  const blob = await response.blob()
  return {
    blob,
    filename: `dokument-${uid.slice(0, 8)}.${format === 'md' ? 'md' : format}`,
  }
}

export function docsErrorCode(error: unknown): string | null {
  if (error instanceof SanitizedApiError) return error.code ?? null
  return null
}
