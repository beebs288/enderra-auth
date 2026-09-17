import { describe, it, expect } from 'vitest';
import { createSecureStoreAdapter, SECURE_CHUNK_SIZE } from './secureStoreAdapter';

// In-memory fake of expo-secure-store. `limit` mimics the Android 2048-BYTE
// per-value ceiling so a test can prove no single write exceeds it. `failAfter`
// makes the store start throwing mid-sequence, standing in for the app being
// killed or the Keystore refusing a write partway through a session save.
function makeFakeStore(opts: { limit?: number; failAfter?: number } = {}) {
  const map = new Map<string, string>();
  let writes = 0;
  const byteLen = (s: string) => new TextEncoder().encode(s).length;
  return {
    map,
    get writes() {
      return writes;
    },
    getItemAsync: async (k: string) => (map.has(k) ? map.get(k)! : null),
    setItemAsync: async (k: string, v: string) => {
      if (opts.failAfter != null && writes >= opts.failAfter) {
        throw new Error('SecureStore unavailable');
      }
      writes++;
      if (opts.limit != null && byteLen(v) > opts.limit) {
        throw new Error(`SecureStore value too large for key "${k}" (${byteLen(v)} > ${opts.limit})`);
      }
      map.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      map.delete(k);
    },
  };
}

const KEY = 'sb-rdmsqcunvdoekzupjzyo-auth-token';

// Shaped like a real Supabase session: big enough to span several chunks.
const session = (label: string) =>
  JSON.stringify({ access_token: label.repeat(600), refresh_token: `${label}-refresh`, user: { id: label } });

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

  it('splits an oversized value into chunks each within the 2048-byte limit and round-trips it', async () => {
    const store = makeFakeStore({ limit: 2048 });
    const a = createSecureStoreAdapter(store);
    const big = 'x'.repeat(SECURE_CHUNK_SIZE * 3 + 17); // spans 4 chunks
    await a.setItem(KEY, big); // must NOT throw (no single write over the limit)
    expect(await a.getItem(KEY)).toBe(big);
  });

  it('keeps every write under the byte ceiling for multi-byte content', async () => {
    // The original adapter chunked by CHARACTER count, so 2000 accented characters
    // were ~4000 bytes and blew the ceiling.
    const store = makeFakeStore({ limit: 2048 });
    const a = createSecureStoreAdapter(store);
    const accented = 'é'.repeat(SECURE_CHUNK_SIZE * 2);
    await a.setItem(KEY, accented);
    expect(await a.getItem(KEY)).toBe(accented);
  });

  it('never splits a surrogate pair', async () => {
    const store = makeFakeStore({ limit: 2048 });
    const a = createSecureStoreAdapter(store);
    const emoji = '🙂'.repeat(SECURE_CHUNK_SIZE); // 4 bytes each, spans many chunks
    await a.setItem(KEY, emoji);
    expect(await a.getItem(KEY)).toBe(emoji);
    for (const v of store.map.values()) {
      // A chunk cut mid-pair would contain a lone surrogate.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v)).toBe(false);
    }
  });

  it('overwriting with a smaller value leaves no stale chunks behind', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, 'y'.repeat(SECURE_CHUNK_SIZE * 3)); // 3 chunks
    await a.setItem(KEY, 'small'); // 1 chunk
    expect(await a.getItem(KEY)).toBe('small');
    expect(store.map.size).toBe(2); // marker + one chunk, nothing orphaned
  });

  it('removeItem clears the marker and every chunk of every generation', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, 'z'.repeat(SECURE_CHUNK_SIZE * 2));
    await a.setItem(KEY, 'z'.repeat(SECURE_CHUNK_SIZE * 2)); // flip to the other generation
    await a.removeItem(KEY);
    expect(await a.getItem(KEY)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it('returns null if a chunk is genuinely missing', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, 'w'.repeat(SECURE_CHUNK_SIZE * 2));
    const marker = store.map.get(KEY)!;
    const gen = marker[1]; // "g0:2" → "0"
    await store.deleteItemAsync(`${KEY}.g${gen}.1`);
    expect(await a.getItem(KEY)).toBeNull();
  });

  // ── The regression this adapter exists for.

  it('a write interrupted partway through keeps the PREVIOUS session readable', async () => {
    const first = session('a');
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, first);
    expect(await a.getItem(KEY)).toBe(first);

    // Refresh arrives; the store dies after the very next write.
    const failing = createSecureStoreAdapter({
      ...store,
      setItemAsync: async () => {
        throw new Error('app killed mid-write');
      },
    });
    await expect(failing.setItem(KEY, session('b'))).rejects.toThrow();

    // The old session must still be there. The original adapter returned null here,
    // which — with refresh-token rotation on — is a permanent silent sign-out.
    expect(await a.getItem(KEY)).toBe(first);
  });

  it('survives interruption at every point in the write sequence', async () => {
    const first = session('a');
    const second = session('b');
    for (let failAt = 0; failAt < 12; failAt++) {
      const store = makeFakeStore();
      const a = createSecureStoreAdapter(store);
      await a.setItem(KEY, first);

      const budget = store.writes + failAt;
      const flaky = createSecureStoreAdapter({
        ...store,
        setItemAsync: async (k: string, v: string) => {
          if (store.writes >= budget) throw new Error('interrupted');
          return store.setItemAsync(k, v);
        },
      });
      await flaky.setItem(KEY, second).catch(() => {});

      // Whatever we read back is one of the two real sessions — never null, never a splice.
      const got = await a.getItem(KEY);
      expect([first, second]).toContain(got);
    }
  });

  // ── Upgrade path off the original layout.

  it('reads a session written by the ORIGINAL layout (bare count marker)', async () => {
    const store = makeFakeStore();
    const value = 'legacy'.repeat(500);
    // Hand-build the old on-disk shape: `${key}.0`, `${key}.1`, marker = "2".
    const half = Math.ceil(value.length / 2);
    await store.setItemAsync(`${KEY}.0`, value.slice(0, half));
    await store.setItemAsync(`${KEY}.1`, value.slice(half));
    await store.setItemAsync(KEY, '2');

    const a = createSecureStoreAdapter(store);
    expect(await a.getItem(KEY)).toBe(value);
  });

  it('migrates the original layout on first write and sweeps its chunks', async () => {
    const store = makeFakeStore();
    await store.setItemAsync(`${KEY}.0`, 'old-a');
    await store.setItemAsync(`${KEY}.1`, 'old-b');
    await store.setItemAsync(KEY, '2');

    const a = createSecureStoreAdapter(store);
    const fresh = session('c');
    await a.setItem(KEY, fresh);

    expect(await a.getItem(KEY)).toBe(fresh);
    expect(store.map.has(`${KEY}.0`)).toBe(false);
    expect(store.map.has(`${KEY}.1`)).toBe(false);
  });

  it('an interrupted migration still leaves the original session readable', async () => {
    const store = makeFakeStore();
    const value = 'legacy'.repeat(500);
    const half = Math.ceil(value.length / 2);
    await store.setItemAsync(`${KEY}.0`, value.slice(0, half));
    await store.setItemAsync(`${KEY}.1`, value.slice(half));
    await store.setItemAsync(KEY, '2');

    const failing = createSecureStoreAdapter({
      ...store,
      setItemAsync: async () => {
        throw new Error('killed during upgrade');
      },
    });
    await failing.setItem(KEY, session('d')).catch(() => {});

    expect(await createSecureStoreAdapter(store).getItem(KEY)).toBe(value);
  });

  it('alternates generations so a write never overwrites the live chunks', async () => {
    const store = makeFakeStore();
    const a = createSecureStoreAdapter(store);
    await a.setItem(KEY, session('a'));
    expect(store.map.get(KEY)!.startsWith('g0:')).toBe(true);
    await a.setItem(KEY, session('b'));
    expect(store.map.get(KEY)!.startsWith('g1:')).toBe(true);
    await a.setItem(KEY, session('c'));
    expect(store.map.get(KEY)!.startsWith('g0:')).toBe(true);
  });
});
