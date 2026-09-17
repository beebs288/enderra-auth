// secureStoreAdapter.ts — a Supabase storage adapter backed by the OS secure
// enclave (Android Keystore / iOS Keychain) via expo-secure-store, instead of
// plaintext AsyncStorage. SecureStore caps each value at 2048 bytes, but a
// Supabase session (access JWT + refresh token + user object) routinely exceeds
// that — so we chunk the value and keep a marker at `key` describing the chunks.
// Session secrets never touch unencrypted disk.
//
// THE WRITE MUST BE ATOMIC. The first version of this adapter deleted the marker
// and every chunk before writing the replacement, then committed the marker last.
// Supabase calls setItem on every token refresh (hourly while foregrounded), so
// that destructive window was entered on a schedule — and anything interrupting
// it (the OS killing a backgrounded RN app, a SecureStore write throwing, the
// user swiping the app away) left no marker at all. getItem reads that as
// signed-out, and because refresh-token rotation is enabled the previous token is
// already dead server-side, so the sign-out is permanent and silent. Found
// 2026-09-17 after a session vanished from Aldris on device with no user action.
//
// The fix: never overwrite the live copy. Chunks live under a GENERATION
// (`${key}.g0.*` / `${key}.g1.*`); a write fills the inactive generation, then
// flips the marker in one small write — that single write is the commit point.
// A crash anywhere before it leaves the previous generation completely intact.
// Stale generations are swept after the flip, so leftovers are garbage, not loss.
//
// The store dependency is injected so the chunking logic is unit-testable without
// the native module.

/** Per-chunk budget in UTF-8 BYTES, held well under SecureStore's 2048 ceiling. */
export const SECURE_CHUNK_SIZE = 1800;

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

type Gen = 0 | 1;

/** Chunk address in the current (generation-tagged) layout. */
const chunkKey = (key: string, gen: Gen, i: number) => `${key}.g${gen}.${i}`;
/** Chunk address in the ORIGINAL layout, still read so an upgrade keeps you signed in. */
const legacyChunkKey = (key: string, i: number) => `${key}.${i}`;

/** Marker payload: which generation is live and how many chunks it holds. */
interface Marker {
  gen: Gen | null; // null = legacy layout (no generation tag)
  count: number;
}

const encodeMarker = (gen: Gen, count: number) => `g${gen}:${count}`;

function decodeMarker(raw: string | null): Marker | null {
  if (raw == null) return null;
  const tagged = /^g([01]):(\d+)$/.exec(raw);
  if (tagged) {
    return { gen: Number(tagged[1]) as Gen, count: Number(tagged[2]) };
  }
  // Original layout: the marker was the bare chunk count.
  const count = Number.parseInt(raw, 10);
  if (!Number.isFinite(count) || count < 1) return null;
  return { gen: null, count };
}

/**
 * UTF-8 byte length of a single code point. Sessions carry user metadata — a name
 * with an accent or an emoji — so a character count is not a byte count, and the
 * original adapter's 2000-CHARACTER chunks could exceed the 2048-BYTE ceiling.
 */
function utf8Len(codePoint: string): number {
  const c = codePoint.codePointAt(0) ?? 0;
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c < 0x10000) return 3;
  return 4;
}

/**
 * Split on code-point boundaries under a byte budget. Slicing by UTF-16 index
 * could cut a surrogate pair in half; each half is invalid UTF-8 on its own and
 * SecureStore would round-trip it as U+FFFD, corrupting the session.
 */
function splitIntoChunks(value: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const cp of value) {
    const size = utf8Len(cp);
    if (bytes + size > SECURE_CHUNK_SIZE && current !== '') {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += cp;
    bytes += size;
  }
  chunks.push(current); // always at least one, so an empty value persists as one chunk
  return chunks;
}

export function createSecureStoreAdapter(store: SecureStoreLike): SupabaseStorage {
  async function readMarker(key: string): Promise<Marker | null> {
    return decodeMarker(await store.getItemAsync(key));
  }

  /** Delete the chunks a marker describes. Safe to call for a generation that is already gone. */
  async function dropChunks(key: string, marker: Marker | null): Promise<void> {
    if (marker == null) return;
    for (let i = 0; i < marker.count; i++) {
      await store.deleteItemAsync(
        marker.gen == null ? legacyChunkKey(key, i) : chunkKey(key, marker.gen, i),
      );
    }
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const marker = await readMarker(key);
      if (marker == null || marker.count < 1) return null;
      let out = '';
      for (let i = 0; i < marker.count; i++) {
        const part = await store.getItemAsync(
          marker.gen == null ? legacyChunkKey(key, i) : chunkKey(key, marker.gen, i),
        );
        if (part == null) return null; // genuinely incomplete → treat as signed-out
        out += part;
      }
      return out;
    },

    async setItem(key: string, value: string): Promise<void> {
      const previous = await readMarker(key);
      // Write into the generation that is NOT live, so the live one stays readable
      // the whole time. Legacy (untagged) and absent both start at g0.
      const target: Gen = previous?.gen === 0 ? 1 : 0;

      const chunks = splitIntoChunks(value);
      for (let i = 0; i < chunks.length; i++) {
        await store.setItemAsync(chunkKey(key, target, i), chunks[i]);
      }

      // COMMIT. Until this single write lands, `previous` is still what getItem sees.
      await store.setItemAsync(key, encodeMarker(target, chunks.length));

      // Past the commit point: everything below is cleanup. Failing here leaves
      // unreferenced chunks, never a lost session.
      await dropChunks(key, previous);
    },

    async removeItem(key: string): Promise<void> {
      const marker = await readMarker(key);
      // Drop the marker FIRST: for a sign-out the absence IS the intended state, so
      // an interrupted removal must not leave a readable session behind.
      await store.deleteItemAsync(key);
      await dropChunks(key, marker);
      // Sweep the generation that was not live plus any legacy chunks, so a swapped
      // or partially-upgraded key leaves nothing behind. Counts are unknown here;
      // scan until a gap, which is enough because chunks are written densely from 0.
      for (const address of [
        (i: number) => chunkKey(key, 0, i),
        (i: number) => chunkKey(key, 1, i),
        (i: number) => legacyChunkKey(key, i),
      ]) {
        for (let i = 0; ; i++) {
          if ((await store.getItemAsync(address(i))) == null) break;
          await store.deleteItemAsync(address(i));
        }
      }
    },
  };
}
