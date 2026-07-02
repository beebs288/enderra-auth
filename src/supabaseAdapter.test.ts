import { describe, it, expect, vi } from 'vitest'
import { SupabaseAuthAdapter } from './supabaseAdapter'

function fakeClient(auth: Record<string, unknown>) {
  return { auth } as unknown as import('@supabase/supabase-js').SupabaseClient
}

const supaSession = {
  access_token: 'tok',
  user: { id: 'u1', email: 'a@b.co' },
}

describe('SupabaseAuthAdapter', () => {
  it('maps getSession to an EnderraSession', async () => {
    const a = new SupabaseAuthAdapter(fakeClient({
      getSession: vi.fn().mockResolvedValue({ data: { session: supaSession }, error: null }),
    }))
    expect(await a.getSession()).toEqual({ user: { id: 'u1', email: 'a@b.co' }, accessToken: 'tok' })
  })

  it('returns null when there is no session', async () => {
    const a = new SupabaseAuthAdapter(fakeClient({
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    }))
    expect(await a.getSession()).toBeNull()
  })

  it('translates onAuthStateChange payloads to EnderraSession and unsubscribes', () => {
    const unsubscribe = vi.fn()
    const onAuthStateChange = vi.fn().mockReturnValue({ data: { subscription: { unsubscribe } } })
    const a = new SupabaseAuthAdapter(fakeClient({ onAuthStateChange }))
    const received: unknown[] = []
    const sub = a.onAuthStateChange(s => received.push(s))
    // Invoke the callback Supabase would have registered.
    const supaCb = onAuthStateChange.mock.calls[0][0] as (e: string, s: unknown) => void
    supaCb('SIGNED_IN', supaSession)
    supaCb('SIGNED_OUT', null)
    expect(received).toEqual([{ user: { id: 'u1', email: 'a@b.co' }, accessToken: 'tok' }, null])
    sub.unsubscribe()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('signInWithPassword forwards args and returns error message on failure', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ error: { message: 'bad creds' } })
    const a = new SupabaseAuthAdapter(fakeClient({ signInWithPassword }))
    const res = await a.signInWithPassword('a@b.co', 'pw')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' })
    expect(res).toEqual({ error: 'bad creds' })
  })

  it('signInWithPassword returns { error: null } on success', async () => {
    const a = new SupabaseAuthAdapter(fakeClient({
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    }))
    expect(await a.signInWithPassword('a@b.co', 'pw')).toEqual({ error: null })
  })

  it('signOut, sendPasswordReset, updatePassword map through', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    const updateUser = vi.fn().mockResolvedValue({ error: null })
    const a = new SupabaseAuthAdapter(fakeClient({ signOut, resetPasswordForEmail, updateUser }))
    expect(await a.signOut()).toEqual({ error: null })
    expect(await a.sendPasswordReset('a@b.co')).toEqual({ error: null })
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.co')
    expect(await a.updatePassword('newpw')).toEqual({ error: null })
    expect(updateUser).toHaveBeenCalledWith({ password: 'newpw' })
  })
})
