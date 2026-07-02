import type { EnderraSession, AuthResult, AuthStateSubscription } from './types'

export interface AuthAdapter {
  getSession(): Promise<EnderraSession | null>
  onAuthStateChange(cb: (session: EnderraSession | null) => void): AuthStateSubscription
  signInWithPassword(email: string, password: string): Promise<AuthResult>
  signOut(): Promise<AuthResult>
  sendPasswordReset(email: string): Promise<AuthResult>
  updatePassword(newPassword: string): Promise<AuthResult>
}

// The app-facing surface IS the contract. The factory is the single indirection
// point where cross-cutting concerns could later be added without touching apps.
export type EnderraAuth = AuthAdapter

export function createEnderraAuth(adapter: AuthAdapter): EnderraAuth {
  return adapter
}
