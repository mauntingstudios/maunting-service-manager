import { describe, expect, it } from 'vitest'
import {
  calculateCardExpiry,
  formatCardNumber,
  formatFingerprint,
  getCardStatus,
} from './mauntingCard'

describe('mauntingCard', () => {
  it('formatiert Bucket-ID sauber als Smartcard-Nummer', () => {
    const bucket = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(formatCardNumber(bucket)).toBe('MSM-E3B0-C442-98FC')
  })

  it('nutzt deterministischen Fallback bei fehlender oder kurzer Bucket-ID', () => {
    expect(formatCardNumber(null, 42)).toBe('MSM-0000-0000-0042')
    expect(formatCardNumber('short', 99)).toBe('MSM-0000-0000-0099')
  })

  it('berechnet 24 Monate Gültigkeit korrekt', () => {
    const basis = new Date('2026-01-15T12:00:00Z')
    const { validThru, isExpired, isExpiringSoon } = calculateCardExpiry(basis, 24)
    expect(validThru).toBe('01/28')
    expect(isExpired).toBe(false)
    expect(isExpiringSoon).toBe(false)
  })

  it('erkennt abgelaufene Gültigkeit', () => {
    const alt = new Date('2020-01-01T00:00:00Z')
    const { isExpired } = calculateCardExpiry(alt, 24)
    expect(isExpired).toBe(true)
  })

  it('ermittelt korrekten Kartenstatus', () => {
    expect(getCardStatus({ isInitialized: false, isUnlocked: false })).toBe('uninitialized')
    expect(getCardStatus({ isInitialized: true, isUnlocked: false, isDeviceAuthorized: false })).toBe('unauthorized')
    expect(getCardStatus({ isInitialized: true, isUnlocked: false })).toBe('locked')
    expect(getCardStatus({ isInitialized: true, isUnlocked: true })).toBe('active')
    expect(getCardStatus({ isInitialized: true, isUnlocked: true, isExpired: true })).toBe('rotation_due')
    expect(getCardStatus({ isInitialized: true, isUnlocked: true, needsRotation: true })).toBe('rotation_due')
  })

  it('kürzt Fingerprint sauber', () => {
    expect(formatFingerprint('e3b0c44298fc1c149afbf4c8996fb924')).toBe('e3b0c442...996fb924')
    expect(formatFingerprint(null)).toBe('NO-CIPHER-SEED')
    expect(formatFingerprint('short-hex')).toBe('short-hex')
  })
})
