import { describe, expect, it } from 'vitest'
import { resolveServerConnect } from './serverConnect'

describe('resolveServerConnect', () => {
  it('prefers game port over query and rcon for standard game servers', () => {
    const res = resolveServerConnect({
      public_bind_ip: '192.0.2.10',
      game_port: 7777,
      query_port: 27015,
      rcon_port: 27020,
      ports: [
        { role: 'rcon', port: 27020, protocol: 'tcp' },
        { role: 'query', port: 27015, protocol: 'udp' },
        { role: 'game', port: 7777, protocol: 'udp' },
      ],
    })

    expect(res.host).toBe('192.0.2.10')
    expect(res.primary).toEqual({
      role: 'game',
      baseRole: 'game',
      port: 7777,
      protocol: 'udp',
      address: '192.0.2.10:7777',
    })
    expect(res.hasMultipleUserPorts).toBe(true)
    expect(res.endpoints.map((e) => e.role)).toEqual(['game', 'query', 'rcon'])
  })

  it('picks query port when game_port is missing (e.g. Enshrouded)', () => {
    const res = resolveServerConnect({
      public_bind_ip: '198.51.100.4',
      game_port: null,
      query_port: 15637,
      rcon_port: null,
      ports: [{ role: 'query', port: 15637, protocol: 'udp' }],
    })

    expect(res.primary).toEqual({
      role: 'query',
      baseRole: 'query',
      port: 15637,
      protocol: 'udp',
      address: '198.51.100.4:15637',
    })
    expect(res.hasMultipleUserPorts).toBe(false)
  })

  it('picks database and web ports for application/database blueprints', () => {
    const db = resolveServerConnect({
      public_bind_ip: '10.0.0.5',
      game_port: null,
      query_port: null,
      rcon_port: null,
      ports: [{ role: 'database', port: 5432, protocol: 'tcp' }],
    })
    expect(db.primary?.role).toBe('database')
    expect(db.primary?.address).toBe('10.0.0.5:5432')

    const web = resolveServerConnect({
      public_bind_ip: '10.0.0.6',
      game_port: null,
      query_port: null,
      rcon_port: null,
      ports: [{ role: 'web', port: 3000, protocol: 'tcp' }],
    })
    expect(web.primary?.role).toBe('web')
    expect(web.primary?.address).toBe('10.0.0.6:3000')
  })

  it('falls back to legacy game_port/query_port/rcon_port when ports array is omitted', () => {
    const res = resolveServerConnect({
      public_bind_ip: '127.0.0.1',
      game_port: 25565,
      query_port: null,
      rcon_port: 25575,
    })

    expect(res.primary?.address).toBe('127.0.0.1:25565')
    expect(res.hasMultipleUserPorts).toBe(false)
    expect(res.endpoints).toHaveLength(2)
  })

  it('treats 0.0.0.0 or empty IP as missing public host and brackets IPv6 addresses', () => {
    const unset = resolveServerConnect({
      public_bind_ip: '0.0.0.0',
      game_port: 28015,
      query_port: null,
      rcon_port: null,
    })
    expect(unset.host).toBeNull()
    expect(unset.primary?.address).toBeNull()
    expect(unset.primary?.port).toBe(28015)

    const ipv6 = resolveServerConnect({
      public_bind_ip: '2001:db8::42',
      game_port: 25565,
      query_port: null,
      rcon_port: null,
    })
    expect(ipv6.primary?.address).toBe('[2001:db8::42]:25565')
  })
})
