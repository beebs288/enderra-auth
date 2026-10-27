// In-app update check — the pure core (feedback a6cb18ce). No RN / expo imports, so it
// unit-tests under node. Spec: enderra-dashboard/docs/superpowers/specs/2026-10-26-in-app-update-check-design.md

/** The public edge function every app asks "is there a newer me?". */
export const LATEST_RELEASE_URL = 'https://rdmsqcunvdoekzupjzyo.supabase.co/functions/v1/latest-release'

/** Foreground checks at most this often; a cold start always checks. */
export const THROTTLE_MS = 6 * 60 * 60 * 1000

export interface LatestRelease {
  version: string
  versionCode: number
  notes: string | null
  notesFr: string | null
  /** 5-minute signed download URL. */
  url: string
  fileSize: number | null
}

export type UpdateLang = 'en' | 'fr'

/** expo-application's `nativeBuildVersion` (Android versionCode as a string) → number, or
 *  null where there is no real installed build (web, Expo Go, garbage). */
export function toVersionCode(v: string | number | null | undefined): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

export function isNewer(latest: number, installed: number): boolean {
  return latest > installed
}

/** `lastAt` null = never checked in this process (cold start) → always check. */
export function shouldCheck(lastAt: number | null, now: number): boolean {
  return lastAt === null || now < lastAt || now - lastAt >= THROTTLE_MS
}

export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  if (typeof j.version !== 'string' || !Number.isInteger(j.version_code)) return null
  if (typeof j.url !== 'string' || !j.url.startsWith('https://')) return null
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    version: j.version,
    versionCode: j.version_code as number,
    notes: str(j.notes),
    notesFr: str(j.notes_fr),
    url: j.url,
    fileSize: typeof j.file_size === 'number' ? j.file_size : null,
  }
}

export function notesFor(r: LatestRelease, lang: UpdateLang): string | null {
  return (lang === 'fr' ? r.notesFr : null) ?? r.notes
}

/** Banner copy for all six apps — one translation place instead of six dictionaries. */
export const UPDATE_COPY = {
  en: {
    ready: (app: string, version: string) => `${app} ${version} is ready`,
    update: 'Update',
    later: 'Later',
    downloading: 'Downloading…',
    failed: 'Download failed. Check your connection and try again.',
    installHint: (app: string) => `If Android blocks the install, allow installs from ${app}, then tap Update again.`,
    settings: 'Settings',
  },
  fr: {
    ready: (app: string, version: string) => `${app} ${version} est disponible`,
    update: 'Mettre à jour',
    later: 'Plus tard',
    downloading: 'Téléchargement…',
    failed: 'Échec du téléchargement. Vérifiez votre connexion et réessayez.',
    installHint: (app: string) => `Si Android bloque l'installation, autorisez les installations depuis ${app}, puis touchez Mettre à jour de nouveau.`,
    settings: 'Paramètres',
  },
} as const
