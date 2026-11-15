import { still } from '@/lib/still'

export function storageKey(prefix: string, konto: number | null): string {
  return `${prefix}${konto ?? 'anon'}`
}

export function readFavoriteIdList(prefix: string, konto: number | null, scope: string): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(prefix, konto))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return Array.from(
      new Set(
        parsed.filter(
          (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
        ),
      ),
    )
  } catch (err) {
    still(err, `${scope}:readFavorites`)
    return []
  }
}

export function writeFavoriteIdList(
  prefix: string,
  konto: number | null,
  ids: readonly number[],
  scope: string,
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(prefix, konto), JSON.stringify(ids))
  } catch (err) {
    still(err, `${scope}:writeFavorites`)
  }
}

export function removeStorageKey(prefix: string, konto: number | null, scope: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(prefix, konto))
  } catch (err) {
    still(err, `${scope}:clear`)
  }
}

export function toggleFavoriteIdInList(current: readonly number[], id: number): number[] | null {
  if (!Number.isInteger(id) || id <= 0) return null
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
}
