export * from './types.js'
export * from './adapter.js'
export { SupabaseAuthAdapter } from './supabaseAdapter.js'
// Native-app helpers. Both shipped duplicated in aldris/ and elmclock/ first; the
// third app (prevision-mobile) folds them here instead of re-porting by hand.
export { createSecureStoreAdapter, SECURE_CHUNK_SIZE } from './secureStoreAdapter.js'
export type { SecureStoreLike, SupabaseStorage } from './secureStoreAdapter.js'
export { friendlyAuthError } from './authError.js'
