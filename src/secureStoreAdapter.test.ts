import { describe, it, expect } from 'vitest';
import { createSecureStoreAdapter, SECURE_CHUNK_SIZE } from './secureStoreAdapter';

// In-memory fake of expo-secure-store. `limit` mimics the Android 2048-byte
// per-value ceiling so a test can prove no single write exceeds it.
function makeFakeStore(limit?: number) {
  const map = new Map<string, string>();
  return {
    map,
    getItemAsync: async (k: string) => (map.has(k) ? map.get(k)! : null),
    setItemAsync: async (k: string, v: string) => {
      if (limit != null && v.length > limit) {
        throw new Error(`SecureStore value too large for key "${k}" (${v.length} > ${limit})`);
      }
      map.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      map.delete(k);
    },
  };
}

const KEY = 'sb-rdmsqcunvdoekzupjzyo-auth-token';

describe('createSecureStoreAdapter', () => {
  it('round-trips a small value', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, 'hello');
    expect(await a.getItem(KEY)).toBe('hello');
  });

  it('returns null for a missing key', async () => {
    const a = createSecureStoreAdapter(makeFakeStore());
    expect(await a.getItem('nope')).toBeNull();
  });

  it('splits an oversized value into chunks each within the 2048 limit and round-trips it', async () => {
    const store = makeFakeStore(2048);
    const a = createSecureStoreAdapter(store);
    const big = 'x'.repeat(SECURE_CHUNK_SIZE * 3 + 17); // spans 4 chunks
    await a.setItem(KEY, big); // must NOT throw (no single write over the limit)
    expect(await a.getItem(KEY)).toBe(big);
    // every underlying entry is within the ceiling
    for (const v of store.map.values()) {
      expect(v.length).toBeLessThanOrEqual(2048);
    }
  });

  it('overwriting with a smaller value cleans up orphaned chunks', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, 'y'.repeat(SECURE_CHUNK_SIZE * 3)); // 3 chunks
    await a.setItem(KEY, 'small'); // 1 chunk — chunks .1/.2 must be gone
    expect(await a.getItem(KEY)).toBe('small');
    expect(store.map.has(`${KEY}.1`)).toBe(false);
    expect(store.map.has(`${KEY}.2`)).toBe(false);
  });

  it('removeItem clears the marker and all chunks', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, 'z'.repeat(SECURE_CHUNK_SIZE * 2));
    await a.removeItem(KEY);
    expect(await a.getItem(KEY)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('returns null if a chunk is missing (corrupt/partial write)', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, 'w'.repeat(SECURE_CHUNK_SIZE * 2));
    await store.deleteItemAsync(`${KEY}.1`); // corrupt: drop the 2nd chunk
    expect(await a.getItem(KEY)).toBeNull();
  });
});
