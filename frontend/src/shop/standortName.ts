export function istGenerischerLokalName(raw?: string | null): boolean {
  const norm = (raw ?? '').trim().toLowerCase()
  return norm === 'lokal' || norm === 'local' || norm === 'localhost'
}

export function standortAnzeigeName(
  node: { name: string; location_label?: string | null },
  fallbackLabel: string,
): string {
  const label = (node.location_label ?? '').trim()
  if (label) return label
  if (istGenerischerLokalName(node.name)) return fallbackLabel
  return node.name
}

