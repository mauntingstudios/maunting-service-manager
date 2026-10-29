/** Der eine Zähler neben einem Navigationseintrag. */
export function NavBadge({ count, pulse = false }: { count: number; pulse?: boolean }) {
  if (count <= 0) return null
  const text = count > 99 ? '99+' : String(count)
  return (
    <>
      {pulse && (
        <span className="absolute -top-1 -right-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
        </span>
      )}
      <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-label-sm font-bold rounded-full bg-primary text-on-primary">
        {text}
      </span>
    </>
  )
}
