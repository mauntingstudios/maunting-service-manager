import { describe, expect, it, vi, beforeEach } from 'vitest'
import { scrubMessage, scrubUrl, errorReporter } from './errorReporter'

describe('errorReporter', () => {
  describe('scrubMessage', () => {
    it('bereinigt Bearer-Tokens, Passwörter, Hashes und E-Mails', () => {
      const raw = 'Error: Bearer eyJhbGciOi.secret.signature failed with password=supersecret123 and token=abc123456789012345678901234567890 for admin@example.com'
      const scrubbed = scrubMessage(raw)

      expect(scrubbed).not.toContain('eyJhbGciOi')
      expect(scrubbed).not.toContain('supersecret123')
      expect(scrubbed).not.toContain('admin@example.com')
      expect(scrubbed).toContain('Bearer [REDACTED]')
      expect(scrubbed).toContain('password=[REDACTED]')
      expect(scrubbed).toContain('[EMAIL]')
    })

    it('behandelt leere oder ungültige Strings schadlos', () => {
      expect(scrubMessage('')).toBe('')
    })
  })

  describe('scrubUrl', () => {
    it('entfernt sensible Query-Parameter und Hashes aus URLs', () => {
      const rawUrl = 'https://panel.example.com/api/v1/auth?token=secret123&session=active#debug'
      const scrubbed = scrubUrl(rawUrl)
      expect(scrubbed).toBe('https://panel.example.com/api/v1/auth')
    })
  })

  describe('Sentry-Initialisierung', () => {
    it('integriert globales window.Sentry und filtert Event-Payloads', async () => {
      let capturedBeforeSend: ((event: any) => any) | null = null
      const mockSentry = {
        init: vi.fn((opts: any) => {
          capturedBeforeSend = opts.beforeSend
        }),
        withScope: vi.fn(),
        captureException: vi.fn(),
      }

      ;(window as any).Sentry = mockSentry

      await errorReporter.initSentry('https://dummy@sentry.example.com/1')
      expect(mockSentry.init).toHaveBeenCalledWith(
        expect.objectContaining({ dsn: 'https://dummy@sentry.example.com/1' })
      )

      expect(capturedBeforeSend).toBeDefined()
      const event = {
        request: {
          url: 'https://panel.example.com/api/test?secret=123',
          headers: {
            authorization: 'Bearer secrettoken',
            cookie: 'msm_session=abc',
            'x-csrf-token': 'csrf123',
          },
          cookies: 'msm_session=abc',
          data: { secret: 'pw' },
        },
        message: 'Fehler mit password=geheim',
        exception: {
          values: [{ value: 'DB Connection failed: postgresql://admin:secretpw@db:5432' }],
        },
        breadcrumbs: {
          values: [{ data: { query: 'SELECT * FROM users' } }],
        },
      }

      const filtered = capturedBeforeSend!(event)
      expect(filtered.request.url).toBe('https://panel.example.com/api/test')
      expect(filtered.request.headers.authorization).toBeUndefined()
      expect(filtered.request.headers.cookie).toBeUndefined()
      expect(filtered.request.cookies).toBeUndefined()
      expect(filtered.request.data).toBeUndefined()
      expect(filtered.message).toBe('Fehler mit password=[REDACTED]')
      expect(filtered.breadcrumbs.values[0].data).toBe('[FILTERED]')
    })
  })
})
