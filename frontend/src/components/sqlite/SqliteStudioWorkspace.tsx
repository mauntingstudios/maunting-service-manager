import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Database, Eye, RefreshCw, Search, Table2, TerminalSquare } from 'lucide-react'
import { Badge, Button, Input, TabBar, TabDef } from '@maunting/ui'
import { DataGrid } from '@/components/postgres/DataGrid'
import { SqlTab } from '@/components/postgres/SqlTab'
import { TableStructure } from '@/components/postgres/TableStructure'
import { StudioProvider } from '@/components/postgres/StudioContext'
import { ErrorBox, Loading, formatNumber, useLoad } from '@/components/postgres/shared'
import { sqliteStudioApi } from '@/api/sqliteStudioApi'
import type { StudioRelation } from '@/components/postgres/studioApi'

interface Props {
  serverId: number
  path: string
  canWrite: boolean
}

type MainTab = 'explorer' | 'sql'

export function SqliteStudioWorkspace({ serverId, path, canWrite }: Props) {
  const { t, i18n } = useTranslation()
  const fileName = useMemo(() => path.split('/').pop() || path, [path])
  const api = useMemo(() => sqliteStudioApi(serverId, path), [serverId, path])
  const [refreshKey, setRefreshKey] = useState(0)

  const overview = useLoad(() => api.overview(), [api, refreshKey])
  const [mainTab, setMainTab] = useState<MainTab>('explorer')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableViewMode, setTableViewMode] = useState<'data' | 'structure'>('data')
  const [tableSearch, setTableSearch] = useState('')

  const relations: StudioRelation[] = useMemo(() => {
    return (overview.data as any)?.relations || []
  }, [overview.data])

  // Wähle automatisch die erste Tabelle aus, falls noch keine gewählt
  useEffect(() => {
    if (relations.length > 0 && (!selectedTable || !relations.some((r) => r.name === selectedTable))) {
      setSelectedTable(relations[0].name)
    }
  }, [relations, selectedTable])

  const tableDetails = useLoad(
    () => (selectedTable ? api.table('main', selectedTable) : Promise.resolve(null)),
    [api, selectedTable, refreshKey],
  )

  const filteredRelations = useMemo(() => {
    if (!tableSearch.trim()) return relations
    const q = tableSearch.toLowerCase()
    return relations.filter((r) => r.name.toLowerCase().includes(q))
  }, [relations, tableSearch])

  const tabs: TabDef<MainTab>[] = [
    { id: 'explorer', labelKey: 'sqliteStudio.tabs.data', icon: Table2 },
    { id: 'sql', labelKey: 'sqliteStudio.tabs.sql', icon: TerminalSquare },
  ]

  if (overview.loading && !overview.data) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center p-6">
        <Loading />
      </div>
    )
  }

  if (overview.error || !overview.data) {
    return (
      <div className="p-6">
        <ErrorBox message={overview.error || t('common.error')} />
      </div>
    )
  }

  const data = overview.data
  const journalMode = (data.server as any)?.version || 'SQLite'

  return (
    <StudioProvider
      ziel={{ art: 'server', serverId, databaseId: 0 }}
      databaseName={fileName}
      api={api}
      overview={{
        ...data,
        permissions: {
          ...data.permissions,
          write: canWrite && (data.permissions?.write ?? true),
        },
      }}
    >
      <div className="flex h-full min-h-[520px] flex-col overflow-hidden bg-surface" data-testid="sqlite-studio">
        {/* Kopfzeile: Status, Badges & Reiter */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/30 bg-surface-container-low px-4 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-outline-variant/40 bg-surface-container">
              <Database className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-headline text-sm font-semibold text-on-surface">{fileName}</span>
                <Badge variant="default" className="font-mono text-xs tracking-wider uppercase">
                  SQLite
                </Badge>
                {journalMode.includes('WAL') && (
                  <Badge variant="success" className="font-mono text-xs uppercase">
                    WAL
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <TabBar
              tabs={tabs}
              active={mainTab}
              onChange={setMainTab}
              ariaLabel={t('sqliteStudio.title', { defaultValue: 'SQLite Studio' })}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Hauptbereich */}
        {mainTab === 'explorer' ? (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Linke Leiste: Tabellenliste */}
            <aside
              data-testid="sqlite-tables-sidebar"
              className="w-56 sm:w-64 shrink-0 flex flex-col border-r border-outline-variant/30 bg-surface-container-low/50"
            >
              <div className="p-2.5 border-b border-outline-variant/20">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-surface-variant" />
                  <Input
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder={t('sqliteStudio.searchTables', { defaultValue: 'Tabelle suchen...' })}
                    className="pl-8 text-xs h-8"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {filteredRelations.map((rel) => {
                  const isActive = rel.name === selectedTable
                  return (
                    <button
                      key={rel.name}
                      type="button"
                      onClick={() => setSelectedTable(rel.name)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isActive
                          ? 'bg-primary/10 font-semibold text-primary'
                          : 'text-on-surface hover:bg-surface-container-high'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {rel.kind === 'view' ? (
                          <Eye className="h-3.5 w-3.5 text-secondary shrink-0" />
                        ) : (
                          <Table2 className="h-3.5 w-3.5 text-on-surface-variant shrink-0" />
                        )}
                        <span className="truncate">{rel.name}</span>
                      </div>
                      <span className="font-mono text-xs text-on-surface-variant shrink-0 ml-1">
                        {formatNumber(Math.max(0, rel.estimated_rows), i18n.language)}
                      </span>
                    </button>
                  )
                })}
                {filteredRelations.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-on-surface-variant">
                    {t('sqliteStudio.noTables', { defaultValue: 'Keine Tabellen gefunden' })}
                  </p>
                )}
              </div>
            </aside>

            {/* Rechter Bereich: Tabellendaten oder Struktur */}
            <main className="flex flex-1 flex-col min-w-0 overflow-hidden bg-surface">
              {selectedTable ? (
                <>
                  {/* Umschalter Daten / Struktur */}
                  <div className="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-low px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-headline text-xs font-semibold text-on-surface">{selectedTable}</span>
                    </div>
                    <div className="inline-flex rounded-lg border border-outline-variant/30 bg-surface-container-high/50 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setTableViewMode('data')}
                        className={`rounded px-2.5 py-0.5 font-medium transition-colors ${
                          tableViewMode === 'data' ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        {t('sqliteStudio.viewData', { defaultValue: 'Daten' })}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTableViewMode('structure')}
                        className={`rounded px-2.5 py-0.5 font-medium transition-colors ${
                          tableViewMode === 'structure' ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        {t('sqliteStudio.viewStructure', { defaultValue: 'Struktur' })}
                      </button>
                    </div>
                  </div>

                  {/* Ansicht Daten oder Struktur */}
                  <div className="flex-1 overflow-auto p-3">
                    {tableDetails.loading && !tableDetails.data && <Loading />}
                    {tableDetails.error && <ErrorBox message={tableDetails.error} />}
                    {tableDetails.data && (
                      tableViewMode === 'data' ? (
                        <DataGrid
                          key={`${selectedTable}-${refreshKey}`}
                          table={tableDetails.data}
                          onJump={({ table }) => setSelectedTable(table)}
                        />
                      ) : (
                        <TableStructure
                          key={`${selectedTable}-${refreshKey}`}
                          table={tableDetails.data}
                          relations={relations}
                          enums={[]}
                          onOpenTable={(_schema, name) => {
                            setSelectedTable(name)
                            setTableViewMode('data')
                          }}
                        />
                      )
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-on-surface-variant">
                  {t('sqliteStudio.selectTable', { defaultValue: 'Wähle links eine Tabelle aus' })}
                </div>
              )}
            </main>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-4">
            <SqlTab key={refreshKey} />
          </div>
        )}
      </div>
    </StudioProvider>
  )
}
