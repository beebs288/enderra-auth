export interface EnderraUser {
  id: string
  email: string | null
}

export interface EnderraSession {
  user: EnderraUser
  accessToken: string
}

export type AuthResult = { error: string | null }

export interface AuthStateSubscription {
  unsubscribe(): void
}
