/**
 * Client-Schnittstelle für das SQLite Studio.
 *
 * Mappt die REST-Endpunkte (/api/servers/{id}/sqlite/...) auf das von
 * DataGrid, SqlTab und TableStructure erwartete StudioApi-Interface.
 */

import { api } from '@/api/client'
import type {
  Json,
  RowFilter,
  RowSort,
  StudioApi,
  StudioExecuteResponse,
  StudioOverview,
  StudioPlan,
  StudioRowKey,
  StudioRows,
  StudioSqlResponse,
  StudioTableDetails,
} from '@/components/postgres/studioApi'

export interface SqliteInspectResponse {
  path: string
  name: string
  is_sqlite: boolean
  size: number
  modified: number
  wal_mode: boolean
  journal_mode?: string
  table_count: number
}

export function sqliteStudioApi(serverId: number, relativePath: string): StudioApi {
  const encPath = encodeURIComponent(relativePath)
  const base = `/servers/${serverId}/sqlite`

  return {
    overview: () => api<StudioOverview>(`${base}/overview?path=${encPath}`),
    objects: async (_schema: string) => {
      const o = await api<StudioOverview & { relations?: any[] }>(`${base}/overview?path=${encPath}`)
      return {
        schema: 'main',
        relations: o.relations || [],
        sequences: [],
        enums: [],
        functions: [],
        triggers: [],
      }
    },
    table: (_schema: string, name: string) =>
      api<StudioTableDetails>(`${base}/tables/${encodeURIComponent(name)}?path=${encPath}`),
    functionDefinition: () => Promise.reject(new Error('Nicht unterstützt in SQLite')),
    extensions: async () => [],
    roles: async () => [],
    grants: async () => ({ schema: 'main', objects: [], schema_grants: [] }),
    health: async () => ({
      database: {},
      cache_hit_ratio: 1.0,
      index_hit_ratio: 1.0,
      tables: [],
      unused_indexes: [],
    }),
    parameters: async () => [],
    sessions: async () => [],
    locks: async () => [],
    sessionAction: async () => ({ ok: true }),
    sql: async ({ sql, rollback = false, row_limit = 500 }) => {
      return api<StudioSqlResponse>(`${base}/sql?path=${encPath}`, {
        method: 'POST',
        body: JSON.stringify({ sql, read_only: rollback, row_limit }),
      })
    },
    explain: async (sql: string) => {
      const res = await api<StudioSqlResponse>(`${base}/sql?path=${encPath}`, {
        method: 'POST',
        body: JSON.stringify({ sql: `EXPLAIN QUERY PLAN ${sql}`, read_only: true }),
      })
      const result = res.results[0]
      return {
        plan: (result?.rows || []) as Json,
        analyzed: false,
        duration_ms: result?.duration_ms ?? 0,
      }
    },
    preview: async (): Promise<StudioPlan> => ({
      statements: ['-- SQLite-Strukturänderung'],
      mode: 'tx',
      identity: 'owner',
      scope: 'database',
      destructive: false,
      permission: 'server.files.write',
    }),
    execute: async (): Promise<StudioExecuteResponse> => ({
      plan: {
        statements: ['-- Ausgeführt'],
        mode: 'tx',
        identity: 'owner',
        scope: 'database',
        destructive: false,
        permission: 'server.files.write',
      },
      results: [],
      notices: [],
      duration_ms: 0,
    }),
    rows: (body: {
      schema_name: string
      table: string
      filters?: RowFilter[]
      sort?: RowSort[]
      limit?: 25 | 50 | 100 | 500
      offset?: number
    }) =>
      api<StudioRows>(`${base}/rows?path=${encPath}`, {
        method: 'POST',
        body: JSON.stringify({
          table: body.table,
          filters: body.filters || [],
          sort: body.sort || [],
          limit: body.limit || 50,
          offset: body.offset || 0,
        }),
      }),
    insertRow: async (_schema: string, table: string, values: Record<string, Json>) => {
      await api<{ message: string; last_id?: number }>(`${base}/row/insert?path=${encPath}`, {
        method: 'POST',
        body: JSON.stringify({ table, values }),
      })
      return { columns: Object.keys(values), row: Object.values(values) }
    },
    updateRow: async (_schema: string, table: string, key: StudioRowKey, changes: Record<string, Json>) => {
      await api<{ message: string; affected: number }>(`${base}/row/update?path=${encPath}`, {
        method: 'POST',
        body: JSON.stringify({ table, key: key.values, changes }),
      })
      return { columns: Object.keys(changes), row: Object.values(changes) }
    },
    deleteRows: async (_schema: string, table: string, keys: StudioRowKey[]) => {
      const res = await api<{ message: string; affected: number }>(`${base}/row/delete?path=${encPath}`, {
        method: 'POST',
        body: JSON.stringify({ table, keys: keys.map((k) => k.values) }),
      })
      return { deleted: res.affected }
    },
    importRows: async () => ({ inserted: 0 }),
    exportRows: async (body: {
      schema_name: string
      table: string
      format: 'csv' | 'json' | 'sql'
      filters?: RowFilter[]
      sort?: RowSort[]
    }) => {
      // Client-seitige Abfrage der Zeilen und Erzeugung des Blobs
      const rowsData = await api<StudioRows>(`${base}/rows?path=${encPath}`, {
        method: 'POST',
        body: JSON.stringify({
          table: body.table,
          filters: body.filters || [],
          sort: body.sort || [],
          limit: 500,
          offset: 0,
        }),
      })

      let text = ''
      let mime = 'text/plain'
      const filename = `${body.table}.${body.format}`

      if (body.format === 'csv') {
        mime = 'text/csv'
        const header = rowsData.columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')
        const lines = rowsData.rows.map((row) =>
          row.map((val) => (val === null ? '' : `"${String(val).replace(/"/g, '""')}"`)).join(','),
        )
        text = [header, ...lines].join('\n')
      } else if (body.format === 'json') {
        mime = 'application/json'
        const jsonObjects = rowsData.rows.map((row) => {
          const obj: Record<string, any> = {}
          rowsData.columns.forEach((col, idx) => {
            obj[col] = row[idx]
          })
          return obj
        })
        text = JSON.stringify(jsonObjects, null, 2)
      } else {
        mime = 'application/sql'
        text = rowsData.rows
          .map((row) => {
            const cols = rowsData.columns.map((c) => `"${c}"`).join(', ')
            const vals = row.map((v) => (v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)).join(', ')
            return `INSERT INTO "${body.table}" (${cols}) VALUES (${vals});`
          })
          .join('\n')
      }

      return {
        blob: new Blob([text], { type: mime }),
        filename,
        headers: new Headers(),
      }
    },
    dump: async () => Promise.reject(new Error('Nutze Dateimanager zum Herunterladen der .db-Datei')),
    restore: async () => Promise.reject(new Error('Nicht unterstützt')),
    pending: async () => [],
    applyPending: async () => ({ ok: true }),
    discardPending: async () => ({ ok: true }),
  }
}
