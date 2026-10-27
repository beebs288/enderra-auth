import { describe, it, expect } from 'vitest'
import { isNewer, shouldCheck, parseLatestRelease, notesFor, toVersionCode, UPDATE_COPY, THROTTLE_MS } from './core'

describe('toVersionCode', () => {
  it('parses expo-application nativeBuildVersion strings', () => {
    expect(toVersionCode('49')).toBe(49)
    expect(toVersionCode(135)).toBe(135)
  })
  it.each([null, undefined, '', 'abc', '1.0.0', 0, -3, NaN])('is null for unusable input %j (web / Expo Go)', (v) => {
    expect(toVersionCode(v as never)).toBeNull()
  })
})

describe('isNewer', () => {
  it('is true only for a strictly higher version code', () => {
    expect(isNewer(50, 49)).toBe(true)
    expect(isNewer(49, 49)).toBe(false)
    expect(isNewer(48, 49)).toBe(false)
  })
  it('compares numerically, not as strings', () => {
    expect(isNewer(100, 99)).toBe(true)
  })
})

describe('shouldCheck', () => {
  it('always checks on cold start (never checked)', () => {
    expect(shouldCheck(null, 0)).toBe(true)
  })
  it('throttles foreground checks to once per 6 h', () => {
    expect(THROTTLE_MS).toBe(6 * 60 * 60 * 1000)
    expect(shouldCheck(1000, 1000 + THROTTLE_MS - 1)).toBe(false)
    expect(shouldCheck(1000, 1000 + THROTTLE_MS)).toBe(true)
  })
  it('re-checks if the clock went backwards', () => {
    expect(shouldCheck(5000, 1000)).toBe(true)
  })
})

describe('parseLatestRelease', () => {
  const ok = { version: '1.0.1', version_code: 50, notes: 'n', notes_fr: 'nf', url: 'https://x/y.apk', file_size: 10 }
  it('maps the edge-function payload', () => {
    expect(parseLatestRelease(ok)).toEqual({ version: '1.0.1', versionCode: 50, notes: 'n', notesFr: 'nf', url: 'https://x/y.apk', fileSize: 10 })
  })
  it('tolerates missing optional fields', () => {
    expect(parseLatestRelease({ version: '1', version_code: 2, url: 'https://u' }))
      .toEqual({ version: '1', versionCode: 2, notes: null, notesFr: null, url: 'https://u', fileSize: null })
  })
  it.each([
    null, 'x', {}, { error: 'no release' },
    { ...ok, version_code: '50' }, { ...ok, version_code: 1.5 }, { ...ok, url: '' }, { ...ok, url: 'http://insecure' }, { ...ok, version: 3 },
  ])('rejects a malformed payload %j', (j) => {
    expect(parseLatestRelease(j)).toBeNull()
  })
})

describe('notesFor', () => {
  const r = { version: '1', versionCode: 2, url: 'https://u', fileSize: null, notes: 'Fixed', notesFr: 'Corrigé' }
  it('picks the user language with english fallback', () => {
    expect(notesFor(r, 'fr')).toBe('Corrigé')
    expect(notesFor(r, 'en')).toBe('Fixed')
    expect(notesFor({ ...r, notesFr: null }, 'fr')).toBe('Fixed')
    expect(notesFor({ ...r, notes: null, notesFr: null }, 'en')).toBeNull()
  })
})

describe('UPDATE_COPY', () => {
  it('has the same keys in both languages', () => {
    expect(Object.keys(UPDATE_COPY.fr).sort()).toEqual(Object.keys(UPDATE_COPY.en).sort())
  })
  it('formats the headline', () => {
    expect(UPDATE_COPY.en.ready('Aldris', '1.0.1')).toBe('Aldris 1.0.1 is ready')
    expect(UPDATE_COPY.fr.ready('Aldris', '1.0.1')).toContain('Aldris 1.0.1')
  })
})
