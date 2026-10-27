import { describe, it, expect, vi } from 'vitest'
import { createUpdater, type UpdateState, type UpdaterDeps } from './updater'
import { THROTTLE_MS } from './core'

const payload = (vc: number, url = 'https://r2/signed.apk') =>
  ({ version: `1.0.${vc}`, version_code: vc, notes: 'n', notes_fr: 'nf', url, file_size: 100 })

function harness(opts: { installed?: string | null; serverVc?: number; status?: number; dlStatus?: number } = {}) {
  let t = 1_000_000
  let serverVc = opts.serverVc ?? 50
  let urlN = 0
  const fetch = vi.fn(async () => ({
    ok: (opts.status ?? 200) === 200,
    json: async () => payload(serverVc, `https://r2/signed-${++urlN}.apk`),
  }))
  let progressCb: ((p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void) | undefined
  let finishDownload!: (r: { uri: string; status: number } | undefined) => void
  const resumable = {
    downloadAsync: vi.fn(() => new Promise<{ uri: string; status: number } | undefined>((res) => { finishDownload = res })),
    cancelAsync: vi.fn(async () => { finishDownload(undefined) }),
  }
  const fs = {
    cacheDirectory: 'file:///cache/',
    deleteAsync: vi.fn(async () => {}),
    createDownloadResumable: vi.fn((_u: string, _f: string, _o: object, cb: typeof progressCb) => { progressCb = cb; return resumable }),
    getContentUriAsync: vi.fn(async (u: string) => u.replace('file://', 'content://')),
  }
  const intent = { startActivityAsync: vi.fn(async () => ({ resultCode: 0 })) }
  const states: UpdateState[] = []
  const deps: UpdaterDeps = { fetch: fetch as never, fs, intent, packageName: 'com.enderra.x', now: () => t }
  const u = createUpdater({
    appId: 'aldris', installedVersionCode: opts.installed === undefined ? '49' : opts.installed,
    endpoint: 'https://fn/latest-release', deps, onChange: (s) => states.push(s),
  })
  return {
    u, fetch, fs, intent, resumable, states,
    last: () => states[states.length - 1],
    advance: (ms: number) => { t += ms },
    setServer: (vc: number) => { serverVc = vc },
    progress: (w: number, e: number) => progressCb!({ totalBytesWritten: w, totalBytesExpectedToWrite: e }),
    finish: (r: { uri: string; status: number } | undefined) => finishDownload(r),
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('createUpdater.check', () => {
  it('cold start: asks the server with app_id + android and offers a newer release', async () => {
    const h = harness()
    await h.u.check()
    expect(h.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = h.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fn/latest-release')
    expect(JSON.parse(init.body as string)).toEqual({ app_id: 'aldris', platform: 'android' })
    expect(h.last()).toMatchObject({ kind: 'available', release: { versionCode: 50 } })
  })
  it('stays idle when the installed build is current', async () => {
    const h = harness({ serverVc: 49 })
    await h.u.check()
    expect(h.states).toEqual([])
  })
  it('never checks without an installed version code (web / Expo Go)', async () => {
    const h = harness({ installed: null })
    await h.u.check()
    expect(h.fetch).not.toHaveBeenCalled()
  })
  it('is silent on server errors', async () => {
    const h = harness({ status: 404 })
    await h.u.check()
    expect(h.states).toEqual([])
  })
  it('is silent when fetch throws', async () => {
    const h = harness()
    h.fetch.mockRejectedValueOnce(new Error('offline'))
    await expect(h.u.check()).resolves.toBeUndefined()
    expect(h.states).toEqual([])
  })
  it('throttles foreground re-checks to once per 6 h', async () => {
    const h = harness({ serverVc: 49 })
    await h.u.check()
    h.advance(60_000); await h.u.check()
    expect(h.fetch).toHaveBeenCalledTimes(1)
    h.advance(THROTTLE_MS); h.setServer(51); await h.u.check()
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(h.last()).toMatchObject({ kind: 'available', release: { versionCode: 51 } })
  })
  it('passes an abort signal so the request has a deadline', async () => {
    const h = harness()
    await h.u.check()
    const init = (h.fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBeDefined()
  })
})

describe('createUpdater.later', () => {
  it('hides the banner and stops re-checking until the next cold start', async () => {
    const h = harness()
    await h.u.check()
    h.u.later()
    expect(h.last()).toEqual({ kind: 'idle' })
    h.advance(THROTTLE_MS * 2); await h.u.check()
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('createUpdater.update', () => {
  it('re-fetches a fresh signed url, downloads with progress, then opens the installer', async () => {
    const h = harness()
    await h.u.check()
    const p = h.u.update()
    await flush()
    expect(h.fetch).toHaveBeenCalledTimes(2) // the url from the check may be past its 5 min
    expect(h.fs.deleteAsync).toHaveBeenCalledWith('file:///cache/enderra-update.apk', { idempotent: true })
    expect(h.fs.createDownloadResumable.mock.calls[0][0]).toBe('https://r2/signed-2.apk')
    expect(h.last()).toMatchObject({ kind: 'downloading', progress: 0 })
    h.progress(50, 100)
    expect(h.last()).toMatchObject({ kind: 'downloading', progress: 0.5 })
    h.finish({ uri: 'file:///cache/enderra-update.apk', status: 200 })
    await p
    expect(h.intent.startActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content:///cache/enderra-update.apk',
      type: 'application/vnd.android.package-archive',
      flags: 1,
    })
    expect(h.last()).toMatchObject({ kind: 'installing' })
  })
  it('reports unknown size as null progress', async () => {
    const h = harness()
    await h.u.check()
    const p = h.u.update(); await flush()
    h.progress(50, -1)
    expect(h.last()).toMatchObject({ kind: 'downloading', progress: null })
    h.finish({ uri: 'file:///cache/enderra-update.apk', status: 200 }); await p
  })
  it('goes to error on a non-200 download and allows retry', async () => {
    const h = harness()
    await h.u.check()
    const p = h.u.update(); await flush()
    h.finish({ uri: 'file:///cache/enderra-update.apk', status: 403 }); await p
    expect(h.last()).toMatchObject({ kind: 'error' })
    expect(h.intent.startActivityAsync).not.toHaveBeenCalled()
    const p2 = h.u.update(); await flush()
    expect(h.last()).toMatchObject({ kind: 'downloading' })
    h.finish({ uri: 'file:///cache/enderra-update.apk', status: 200 }); await p2
    expect(h.last()).toMatchObject({ kind: 'installing' })
  })
  it('goes to error when the installer cannot be opened', async () => {
    const h = harness()
    await h.u.check()
    h.intent.startActivityAsync.mockRejectedValueOnce(new Error('no activity'))
    const p = h.u.update(); await flush()
    h.finish({ uri: 'file:///cache/enderra-update.apk', status: 200 }); await p
    expect(h.last()).toMatchObject({ kind: 'error' })
  })
  it('Later during a download cancels it and stays hidden', async () => {
    const h = harness()
    await h.u.check()
    const p = h.u.update(); await flush()
    h.u.later()
    await p
    expect(h.resumable.cancelAsync).toHaveBeenCalled()
    expect(h.last()).toEqual({ kind: 'idle' })
    expect(h.intent.startActivityAsync).not.toHaveBeenCalled()
  })
  it('does not re-check (and so does not reset the banner) while installing', async () => {
    const h = harness()
    await h.u.check()
    const p = h.u.update(); await flush()
    h.finish({ uri: 'file:///cache/enderra-update.apk', status: 200 }); await p
    h.advance(THROTTLE_MS); await h.u.check()
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(h.last()).toMatchObject({ kind: 'installing' })
  })
})

describe('createUpdater.openInstallSettings', () => {
  it("opens this app's 'install unknown apps' page", async () => {
    const h = harness()
    await h.u.openInstallSettings()
    expect(h.intent.startActivityAsync).toHaveBeenCalledWith('android.settings.MANAGE_UNKNOWN_APP_SOURCES', { data: 'package:com.enderra.x' })
  })
})
