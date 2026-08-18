// lib/secureStoreAdapter.ts — a Supabase storage adapter backed by the OS secure
// enclave (Android Keystore / iOS Keychain) via expo-secure-store, instead of
// plaintext AsyncStorage. SecureStore caps each value at 2048 bytes, but a
// Supabase session (access JWT + refresh token + user object) routinely exceeds
// that — so we chunk the value across `${key}.0`, `${key}.1`, … and keep the
// chunk count in a marker at `key`. Session secrets never touch unencrypted disk.
//
// The store dependency is injected so the chunking logic is unit-testable without
// the native module. Auth tokens are ASCII/base64 (1 char = 1 byte), so a
// character-length chunk size stays safely under the byte ceiling.

export const SECURE_CHUNK_SIZE = 2000; // < 2048, leaving headroom

export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface SupabaseStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const chunkKey = (key: string, i: number) => `${key}.${i}`;

export function createSecureStoreAdapter(store: SecureStoreLike): SupabaseStorage {
  // Delete the marker + every chunk currently recorded under `key`.
  async function clear(key: string): Promise<void> {
    const marker = await store.getItemAsync(key);
    if (marker == null) return;
    const count = Number.parseInt(marker, 10);
    if (Number.isFinite(count)) {
      for (let i = 0; i < count; i++) {
        await store.deleteItemAsync(chunkKey(key, i));
      }
    }
    await store.deleteItemAsync(key);
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const marker = await store.getItemAsync(key);
      if (marker == null) return null;
      const count = Number.parseInt(marker, 10);
      if (!Number.isFinite(count) || count < 1) return null;
      let out = '';
      for (let i = 0; i < count; i++) {
        const part = await store.getItemAsync(chunkKey(key, i));
        if (part == null) return null; // partial/corrupt write → treat as signed-out
        out += part;
      }
      return out;
    },

    async setItem(key: string, value: string): Promise<void> {
      // Remove any prior chunks first so a shrinking value leaves no orphans.
      await clear(key);
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += SECURE_CHUNK_SIZE) {
        chunks.push(value.slice(i, i + SECURE_CHUNK_SIZE));
      }
      if (chunks.length === 0) chunks.push(''); // persist empty string as one chunk
      for (let i = 0; i < chunks.length; i++) {
        await store.setItemAsync(chunkKey(key, i), chunks[i]);
      }
      await store.setItemAsync(key, String(chunks.length));
    },

    async removeItem(key: string): Promise<void> {
      await clear(key);
    },
  };
}
