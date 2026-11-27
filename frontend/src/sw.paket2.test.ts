import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function loadServiceWorker() {
  const listeners = new Map<string, (event: any) => void>()
  const cacheStore = new Map<string, Response>()
  const cacheMock = {
    match: vi.fn(async (req: Request) => cacheStore.get(req.url) ?? undefined),
    put: vi.fn(async (req: Request, res: Response) => {
      cacheStore.set(req.url, res)
    }),
    addAll: vi.fn(async () => {}),
  }
  const cachesMock = {
    open: vi.fn(async () => cacheMock),
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? `https://panel.example${req}` : req.url
      return cacheStore.get(key) ?? undefined
    }),
    keys: vi.fn(async () => ['msm-v9']),
    delete: vi.fn(async () => true),
  }
  const selfMock: any = {
    location: { origin: 'https://panel.example' },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    addEventListener: (type: string, cb: (event: any) => void) => {
      listeners.set(type, cb)
    },
  }

  const swPath = path.resolve(process.cwd(), 'public/sw.js')
  const code = fs.readFileSync(swPath, 'utf-8')
  const fn = new Function('self', 'caches', 'fetch', code)
  const fetchMock = vi.fn()
  fn(selfMock, cachesMock, fetchMock)

  return { listeners, cacheStore, cacheMock, fetchMock }
}

describe('Paket 2B: Service Worker Cache-First & HTML-Fallback-Schutz', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('liefert gecachtes /assets/*.js sofort aus dem Cache ohne Netzwerkaufruf', async () => {
    const { listeners, cacheStore, fetchMock } = loadServiceWorker()
    const url = 'https://panel.example/assets/index-abc123.js'
    cacheStore.set(
      url,
      new Response('console.log("cached")', {
        status: 200,
        headers: { 'Content-Type': 'application/javascript' },
      }),
    )

    let responded: Promise<Response> | null = null
    listeners.get('fetch')!({
      request: new Request(url, { method: 'GET' }),
      respondWith: (p: Promise<Response>) => {
        responded = p
      },
    })

    const res = await responded!
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log("cached")')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('speichert niemals text/html-Antworten fuer /assets/* im Cache', async () => {
    const { listeners, cacheMock, fetchMock } = loadServiceWorker()
    const url = 'https://panel.example/assets/missing-chunk.js'
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )

    let responded: Promise<Response> | null = null
    listeners.get('fetch')!({
      request: new Request(url, { method: 'GET' }),
      respondWith: (p: Promise<Response>) => {
        responded = p
      },
    })

    const res = await responded!
    expect(res.status).toBe(200)
    await Promise.resolve()
    expect(cacheMock.put).not.toHaveBeenCalled()
  })

  it('bricht haengende HTML-Requests nach 4s ab und faellt auf den Cache zurueck', async () => {
    const { listeners, cacheStore, fetchMock } = loadServiceWorker()
    cacheStore.set(
      'https://panel.example/',
      new Response('<!doctype html><title>Cached</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    fetchMock.mockImplementation((_req: Request, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    let responded: Promise<Response> | null = null
    listeners.get('fetch')!({
      request: new Request('https://panel.example/servers', {
        method: 'GET',
        headers: { accept: 'text/html' },
      }),
      respondWith: (p: Promise<Response>) => {
        responded = p
      },
    })

    await vi.advanceTimersByTimeAsync(4100)
    const res = await responded!
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Cached')
  })
})
