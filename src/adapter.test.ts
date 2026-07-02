import { describe, it, expect, vi } from 'vitest'
import { createEnderraAuth } from './adapter'
import type { AuthAdapter, EnderraSession } from './index'

function fakeAdapter(overrides: Partial<AuthAdapter> = {}): AuthAdapter {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    onAuthStateChange: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    sendPasswordReset: vi.fn().mockResolvedValue({ error: null }),
    updatePassword: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  }
}

describe('createEnderraAuth', () => {
  it('exposes the adapter contract as the app-facing surface', async () => {
    const session: EnderraSession = { user: { id: 'u1', email: 'a@b.co' }, accessToken: 't' }
    const adapter = fakeAdapter({ getSession: vi.fn().mockResolvedValue(session) })
    const auth = createEnderraAuth(adapter)
    expect(await auth.getSession()).toEqual(session)
    expect((await auth.signInWithPassword('a@b.co', 'pw')).error).toBeNull()
  })
})
