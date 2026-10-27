// `@enderra/auth/updates` — in-app "update available" check for the Android apps (a6cb18ce).
export {
  LATEST_RELEASE_URL, THROTTLE_MS, UPDATE_COPY,
  toVersionCode, isNewer, shouldCheck, parseLatestRelease, notesFor,
} from './core.js'
export type { LatestRelease, UpdateLang } from './core.js'
export { createUpdater } from './updater.js'
export type { UpdateState, UpdaterDeps, UpdaterOptions, Updater } from './updater.js'
export { useAppUpdate } from './useAppUpdate.js'
export type { AppStateLike } from './useAppUpdate.js'
