// The update state machine: idle → available → downloading → installing | error.
// Natives are injected (structural types match expo-file-system/legacy and
// expo-intent-launcher), so this runs under node tests and the package needs no RN types.
import { LATEST_RELEASE_URL, isNewer, parseLatestRelease, shouldCheck, toVersionCode, type LatestRelease } from './core.js'

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'available'; release: LatestRelease }
  /** progress 0..1, or null when the server sent no size */
  | { kind: 'downloading'; release: LatestRelease; progress: number | null }
  /** Android's installer was opened. Shown with the "allow installs" hint + retry, because
   *  the first time Android blocks it until the user allows this app as a source. */
  | { kind: 'installing'; release: LatestRelease }
  | { kind: 'error'; release: LatestRelease }

interface DownloadResumableLike {
  downloadAsync(): Promise<{ uri: string; status: number } | undefined>
  cancelAsync(): Promise<void>
}

export interface UpdaterDeps {
  /** defaults to the global fetch */
  fetch?: (url: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>
  /** `import * as FileSystem from 'expo-file-system/legacy'` */
  fs: {
    cacheDirectory: string | null
    deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>
    createDownloadResumable(
      url: string, fileUri: string, options?: object,
      callback?: (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
    ): DownloadResumableLike
    getContentUriAsync(fileUri: string): Promise<string>
  }
  /** `import * as IntentLauncher from 'expo-intent-launcher'` */
  intent: {
    startActivityAsync(action: string, params?: { data?: string; type?: string; flags?: number }): Promise<unknown>
  }
  /** Android applicationId — expo-application `applicationId` */
  packageName: string
  now?: () => number
}

export interface UpdaterOptions {
  /** the hub's release.app_id */
  appId: string
  /** expo-application `nativeBuildVersion`; null/unparseable → never checks */
  installedVersionCode: string | number | null | undefined
  deps: UpdaterDeps
  endpoint?: string
  timeoutMs?: number
}

export interface Updater {
  check(): Promise<void>
  update(): Promise<void>
  later(): void
  openInstallSettings(): Promise<void>
}

const FLAG_GRANT_READ_URI_PERMISSION = 1
const APK_MIME = 'application/vnd.android.package-archive'

export function createUpdater(opts: UpdaterOptions & { onChange: (s: UpdateState) => void }): Updater {
  const { appId, deps, onChange } = opts
  const installed = toVersionCode(opts.installedVersionCode)
  const now = deps.now ?? Date.now
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init))
  let state: UpdateState = { kind: 'idle' }
  let lastCheckedAt: number | null = null
  let dismissed = false
  let checking = false
  let download: DownloadResumableLike | null = null

  const set = (s: UpdateState) => { state = s; onChange(s) }

  async function fetchLatest(): Promise<LatestRelease | null> {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000)
    try {
      const res = await doFetch(opts.endpoint ?? LATEST_RELEASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, platform: 'android' }),
        signal: ac.signal,
      })
      return res.ok ? parseLatestRelease(await res.json()) : null
    } catch {
      return null // an update check must never get in the way of using the app
    } finally {
      clearTimeout(timer)
    }
  }

  async function check() {
    if (installed === null || dismissed || checking) return
    if (state.kind !== 'idle' && state.kind !== 'available') return
    if (!shouldCheck(lastCheckedAt, now())) return
    lastCheckedAt = now()
    checking = true
    try {
      const r = await fetchLatest()
      if (dismissed || (state.kind !== 'idle' && state.kind !== 'available')) return
      if (r && isNewer(r.versionCode, installed)) set({ kind: 'available', release: r })
      else if (state.kind === 'available') set({ kind: 'idle' })
    } finally {
      checking = false
    }
  }

  async function update() {
    if (state.kind === 'idle' || state.kind === 'downloading') return
    let release = state.release
    set({ kind: 'downloading', release, progress: 0 })
    // The url from the check may be hours old; signed links live 5 minutes.
    const fresh = await fetchLatest()
    if (dismissed) return
    if (fresh && installed !== null && isNewer(fresh.versionCode, installed)) release = fresh
    const dest = `${deps.fs.cacheDirectory ?? ''}enderra-update.apk`
    try {
      await deps.fs.deleteAsync(dest, { idempotent: true })
      let pct = 0
      download = deps.fs.createDownloadResumable(release.url, dest, {}, (p) => {
        if (state.kind !== 'downloading') return
        if (p.totalBytesExpectedToWrite <= 0) {
          if (state.progress !== null) set({ kind: 'downloading', release, progress: null })
          return
        }
        const next = Math.floor((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100)
        if (next !== pct) { pct = next; set({ kind: 'downloading', release, progress: next / 100 }) }
      })
      const res = await download.downloadAsync()
      download = null
      if (dismissed) return
      if (!res || res.status !== 200) return set({ kind: 'error', release })
      const data = await deps.fs.getContentUriAsync(res.uri)
      set({ kind: 'installing', release })
      await deps.intent.startActivityAsync('android.intent.action.VIEW', {
        data, type: APK_MIME, flags: FLAG_GRANT_READ_URI_PERMISSION,
      })
    } catch {
      download = null
      if (!dismissed) set({ kind: 'error', release })
    }
  }

  function later() {
    dismissed = true
    const d = download
    download = null
    if (d) void d.cancelAsync().catch(() => {})
    set({ kind: 'idle' })
  }

  async function openInstallSettings() {
    try {
      await deps.intent.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
        data: `package:${deps.packageName}`,
      })
    } catch { /* nothing useful to show; the hint text still says what to toggle */ }
  }

  return { check, update, later, openInstallSettings }
}
