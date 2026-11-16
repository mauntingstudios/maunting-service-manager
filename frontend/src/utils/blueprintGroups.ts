export interface GameGroupable {
  id: string
  name: string
  game?: string | null
  edition?: string | null
  category?: string
}

export interface GameGroup<T extends GameGroupable> {
  key: string
  name: string
  items: T[]
}

/**
 * Ermittelt den übergeordneten Spielenamen eines Blueprints oder GameInfo-Eintrags.
 *
 * Vorrang hat ein explizites `meta.game`. Fehlen diese Angaben (z. B. ältere
 * Community-Blueprints), greift ein konservativer Präfix-Abgleich für
 * bekannte Mehrfach-Reihen; alles andere bleibt ein eigenständiger Eintrag.
 */
export function resolveGameGroupName(item: GameGroupable): string {
  const explicit = item.game?.trim()
  if (explicit) return explicit

  const id = item.id.trim().toLowerCase()
  const name = item.name.trim()
  if (id.startsWith('minecraft_') || /^minecraft\s*\(/i.test(name)) {
    return 'Minecraft'
  }
  if (id.startsWith('ark_') || /^ark:\s*/i.test(name)) {
    return 'ARK'
  }
  if (id.startsWith('farming_simulator_') || /^farming simulator\b/i.test(name)) {
    return 'Farming Simulator'
  }
  return name || item.id
}

/**
 * Kurze Versions-/Editionsbezeichnung innerhalb einer Spielgruppe.
 */
export function resolveBlueprintEditionLabel(item: GameGroupable, groupName?: string): string {
  const explicit = item.edition?.trim()
  if (explicit) return explicit

  const resolvedGroup = groupName ?? resolveGameGroupName(item)
  const name = item.name.trim()
  if (name === resolvedGroup) return name

  if (name.toLowerCase().startsWith(`${resolvedGroup.toLowerCase()} (`) && name.endsWith(')')) {
    const inner = name.slice(resolvedGroup.length + 2, -1).trim()
    if (inner) return inner
  }
  if (name.toLowerCase().startsWith(`${resolvedGroup.toLowerCase()}: `)) {
    const rest = name.slice(resolvedGroup.length + 2).trim()
    if (rest) return rest
  }
  if (name.toLowerCase().startsWith(`${resolvedGroup.toLowerCase()} `)) {
    const rest = name.slice(resolvedGroup.length + 1).trim()
    if (rest) return rest
  }
  return name || item.id
}

/**
 * Erzeugt einen stabilen, URL-sicheren Schlüssel für eine Spielgruppe.
 */
export function toGameGroupKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'other'
}

/**
 * Gruppiert Blueprints oder Spiele alphabetisch nach übergeordnetem Spiel.
 */
export function groupByGame<T extends GameGroupable>(items: T[]): Array<GameGroup<T>> {
  const byName = new Map<string, T[]>()
  for (const item of items) {
    const groupName = resolveGameGroupName(item)
    const bucket = byName.get(groupName)
    if (bucket) {
      bucket.push(item)
    } else {
      byName.set(groupName, [item])
    }
  }

  return Array.from(byName.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .map(([name, groupItems]) => ({
      key: toGameGroupKey(name),
      name,
      items: [...groupItems].sort((a, b) =>
        resolveBlueprintEditionLabel(a, name).localeCompare(
          resolveBlueprintEditionLabel(b, name),
          undefined,
          { sensitivity: 'base', numeric: true },
        ),
      ),
    }))
}
