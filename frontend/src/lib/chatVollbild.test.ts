import { describe, expect, it } from 'vitest'

import { chatIstOffen } from './chatVollbild'

describe('chatIstOffen', () => {
  it('erkennt Direktchat und Gruppe an der Adresse', () => {
    expect(chatIstOffen('?userId=7')).toBe(true)
    expect(chatIstOffen('?contact=alice')).toBe(true)
    expect(chatIstOffen('?groupId=12')).toBe(true)
    expect(chatIstOffen('userId=7')).toBe(true)
  })

  it('schweigt ohne Chat-Parameter', () => {
    expect(chatIstOffen('')).toBe(false)
    expect(chatIstOffen('?')).toBe(false)
    expect(chatIstOffen('?tab=chats')).toBe(false)
  })

  it('zählt einen leeren Parameter nicht als offenen Chat', () => {
    expect(chatIstOffen('?userId=')).toBe(false)
    expect(chatIstOffen('?groupId=%20')).toBe(false)
  })
})
