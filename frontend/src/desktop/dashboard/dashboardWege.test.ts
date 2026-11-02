import { describe, expect, it } from 'vitest'

import { dashboardElternroute, dashboardTitelKey, istDashboardRoute } from './dashboardWege'

describe('dashboardWege', () => {
  it('erkennt Uebersicht, Listen und Unterseiten der Server-Verwaltung', () => {
    for (const pfad of ['/', '/servers', '/servers/7', '/users', '/admin/nodes', '/panel-database']) {
      expect(istDashboardRoute(pfad), pfad).toBe(true)
    }
  })

  it('laesst die eigenen Bereiche der App und fremde Adressen in Ruhe', () => {
    for (const pfad of ['/ai', '/chat', '/kalender', '/einstellungen', '/dokumente/42', 'javascript:alert(1)', '/serversx']) {
      expect(istDashboardRoute(pfad), pfad).toBe(false)
    }
  })

  it('nennt die Liste, zu der eine Unterseite gehoert', () => {
    expect(dashboardElternroute('/servers/7')).toBe('/servers')
    expect(dashboardElternroute('/servers')).toBeNull()
    expect(dashboardElternroute('/users')).toBeNull()
  })

  it('waehlt den Titel aus derselben Beschriftung wie die Navigation', () => {
    expect(dashboardTitelKey('/')).toBe('nav.dashboard')
    expect(dashboardTitelKey('/servers')).toBe('nav.servers')
    // Eine Unterseite traegt den Namen ihrer Liste.
    expect(dashboardTitelKey('/servers/7')).toBe('nav.servers')
    expect(dashboardTitelKey('/panel-backups')).toBe('nav.panelBackups')
    // Ein unbekannter Pfad faellt auf die Uebersicht zurueck.
    expect(dashboardTitelKey('/gibt-es-nicht')).toBe('nav.dashboard')
  })
})
