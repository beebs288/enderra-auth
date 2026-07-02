import type { SupabaseClient, Session } from '@supabase/supabase-js'
import type { AuthAdapter } from './adapter.js'
import type { EnderraSession, AuthResult, AuthStateSubscription } from './types.js'

function toEnderraSession(session: Session | null): EnderraSession | null {
  if (session === null) return null
  return {
    user: { id: session.user.id, email: session.user.email ?? null },
    accessToken: session.access_token,
  }
}

export class SupabaseAuthAdapter implements AuthAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async getSession(): Promise<EnderraSession | null> {
    const { data } = await this.client.auth.getSession()
    return toEnderraSession(data.session)
  }

  onAuthStateChange(cb: (session: EnderraSession | null) => void): AuthStateSubscription {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => cb(toEnderraSession(session)))
    return { unsubscribe: () => data.subscription.unsubscribe() }
  }

  async signInWithPassword(email: string, password: string): Promise<AuthResult> {
    const { error } = await this.client.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async signUp(email: string, password: string): Promise<AuthResult> {
    const { error } = await this.client.auth.signUp({ email, password })
    return { error: error?.message ?? null }
  }

  async signOut(): Promise<AuthResult> {
    const { error } = await this.client.auth.signOut()
    return { error: error?.message ?? null }
  }

  async sendPasswordReset(email: string): Promise<AuthResult> {
    const { error } = await this.client.auth.resetPasswordForEmail(email)
    return { error: error?.message ?? null }
  }

  async updatePassword(newPassword: string): Promise<AuthResult> {
    const { error } = await this.client.auth.updateUser({ password: newPassword })
    return { error: error?.message ?? null }
  }
}
