export interface EnderraUser {
  id: string
  email: string | null
  // Display fields from the identity provider (e.g. Google). Optional/null
  // for password users, who have no provider profile.
  name?: string | null
  avatarUrl?: string | null
}

export interface EnderraSession {
  user: EnderraUser
  accessToken: string
  // Google (or other) OAuth provider access token, e.g. a Drive-scoped token.
  // Optional/null for password sessions, which have no provider token.
  providerToken?: string | null
}

export type AuthResult = { error: string | null }

export interface AuthStateSubscription {
  unsubscribe(): void
}
