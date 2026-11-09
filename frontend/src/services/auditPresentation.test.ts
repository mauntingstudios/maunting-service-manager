import { describe, expect, it, vi } from 'vitest'
import {
  auditAktionText,
  auditErgebnis,
  auditKategorie,
  containsSecretFragment,
  formatAuditTarget,
  formatAuditTime,
  formatAuditZeitKurz,
  mapAuditApiRows,
  mapAuditSeite,
  parseAuditDetails,
  safeAuditDetails,
} from './auditPresentation'

const uebersetzen = () => vi.fn((key: string) => key)

describe('auditPresentation', () => {
  it('maps valid API rows and drops invalid ones', () => {
    const rows = mapAuditApiRows([
      {
        id: 3,
        user_id: 1,
        username: 'Mai',
        action: 'postgres.admin.rotate',
        category: 'security',
        result: 'failed',
        target_type: 'managed_postgres',
        target_id: null,
        origin: 'ai',
        correlation_id: '0a613465-487d-44a0-af1c-5aa031a873c9',
        details: '{"nodes_updated":[1]}',
        created_at: '2026-07-30T12:00:00Z',
      },
      { id: 'x', action: 'bad' },
      null,
      { id: 4, action: '' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('postgres.admin.rotate')
    expect(rows[0].username).toBe('Mai')
    expect(rows[0].category).toBe('security')
    expect(rows[0].result).toBe('failed')
    expect(rows[0].user_id).toBe(1)
    expect(rows[0].origin).toBe('ai')
    expect(rows[0].correlation_id).toBe('0a613465-487d-44a0-af1c-5aa031a873c9')
  })

  it('liest die paginierte Antwort und eine blosse Liste', () => {
    expect(mapAuditSeite({ items: [{ id: 1, action: 'a.b' }], total: 12 })).toMatchObject({
      total: 12,
      items: [{ id: 1, action: 'a.b' }],
    })
    expect(mapAuditSeite([{ id: 2, action: 'c.d' }])).toMatchObject({
      total: 1,
      items: [{ id: 2, action: 'c.d' }],
    })
    expect(mapAuditSeite(null)).toEqual({ items: [], total: 0 })
  })

  it('ordnet Kategorien in derselben Reihenfolge wie das Backend zu', () => {
    expect(auditKategorie('server.lifecycle.requested')).toBe('server')
    expect(auditKategorie('server.backups.create')).toBe('backup')
    expect(auditKategorie('user.roles.updated')).toBe('role')
    expect(auditKategorie('roles.update')).toBe('role')
    expect(auditKategorie('team.member.invited')).toBe('team')
    expect(auditKategorie('team.vault.reset')).toBe('security')
    expect(auditKategorie('server.credential.bound')).toBe('security')
    expect(auditKategorie('panel.settings.update')).toBe('security')
    expect(auditKategorie('blueprints.import')).toBe('configuration')
    expect(auditKategorie('server.firewall_opened')).toBe('configuration')
    expect(auditKategorie('hoster.product.saved')).toBe('billing')
    expect(auditKategorie('auto_restart')).toBe('system')
    expect(auditKategorie('auth.login.failed')).toBe('security')
    expect(auditKategorie('device.pairing.generated')).toBe('security')
    expect(auditKategorie('docs.access.denied')).toBe('docs')
    expect(auditKategorie('server.incident.detected')).toBe('server')
  })

  it('erkennt Fehlschlaege nur mit Beleg', () => {
    expect(auditErgebnis('server.lifecycle.failed', null)).toBe('failed')
    expect(auditErgebnis('server.lifecycle.completed', '{"error_code":null}')).toBe('success')
    expect(auditErgebnis('server.lifecycle.completed', '{"error_code":"timeout"}')).toBe('failed')
    expect(auditErgebnis('server.lifecycle.completed', '{"success":false}')).toBe('failed')
    expect(auditErgebnis('server.lifecycle.completed', 'kein json')).toBe('success')
    expect(auditErgebnis('docs.access.denied', null)).toBe('failed')
    expect(auditErgebnis('device.pairing.failed', null)).toBe('failed')
    expect(auditErgebnis('server.incident.detected', null)).toBe('success')
  })

  it('formatiert Ziel und Zeit ohne erfundene Daten', () => {
    expect(formatAuditTarget({ target_type: 'server', target_id: '12' })).toBe('server #12')
    expect(formatAuditTarget({ target_type: null, target_id: null })).toBe('—')
    expect(formatAuditTime(null)).toBe('—')
    expect(formatAuditTime('not-a-date')).toBe('—')
  })

  it('nennt heute und gestern als Kalendertag, nicht als 24-Stunden-Abstand', () => {
    const jetzt = new Date(2026, 10, 9, 12, 0)
    const heute = new Date(2026, 10, 9, 21, 8)
    const gestern = new Date(2026, 10, 8, 9, 14)
    expect(formatAuditZeitKurz(heute.toISOString(), 'de-DE', { heute: 'Heute', gestern: 'Gestern' }, jetzt))
      .toMatch(/^Heute, 21:08/)
    expect(formatAuditZeitKurz(gestern.toISOString(), 'de-DE', { heute: 'Heute', gestern: 'Gestern' }, jetzt))
      .toMatch(/^Gestern, 09:14/)
  })

  it('beschriftet Aktionen in drei Stufen', () => {
    const t = uebersetzen()
    expect(auditAktionText(t, 'server.lifecycle.completed', '{"operation":"restart"}'))
      .toBe('audit.action.lifecycle.completed.restart')
    expect(auditAktionText(t, 'server.lifecycle.requested', null)).toBe('audit.action.phase.requested')
    expect(auditAktionText(t, 'roles.create', null)).toBe('audit.action.roleCreated')
    expect(auditAktionText(t, 'hoster.product.saved', null)).toBe('audit.action.generic')
    expect(t).toHaveBeenCalledWith('audit.subject.hosterProduct')
    expect(t).toHaveBeenCalledWith('audit.verb.saved')
    expect(auditAktionText(t, 'unbekannt', null)).toBe('unbekannt')
    expect(auditAktionText(t, 'auth.login.failed', null)).toBe('audit.action.loginFailed')
    expect(auditAktionText(t, 'ai.run.failed', null)).toBe('audit.action.aiRunFailed')
    expect(auditAktionText(t, 'docs.document.created', null)).toBe('audit.action.documentCreated')
    expect(auditAktionText(t, 'server.incident.detected', null)).toBe('audit.action.serverIncidentDetected')
    expect(auditAktionText(t, 'device.pairing.redeemed', null)).toBe('audit.action.devicePairingRedeemed')
  })

  it('liest Details nur als Objekt', () => {
    expect(parseAuditDetails('{"a":1}')).toEqual({ a: 1 })
    expect(parseAuditDetails('[1,2]')).toBeNull()
    expect(parseAuditDetails('kein json')).toBeNull()
  })

  it('never leaves raw password-like fragments unredacted in details helper', () => {
    const raw = 'password=super-secret-value token=abc'
    expect(containsSecretFragment(raw)).toBe(true)
    const safe = safeAuditDetails(raw)
    expect(safe).not.toContain('super-secret-value')
    expect(safe.toLowerCase()).toContain('[redacted]')
  })

  it('returns empty list for non-array payloads', () => {
    expect(mapAuditApiRows(null)).toEqual([])
    expect(mapAuditApiRows({ items: [] })).toEqual([])
  })
})
