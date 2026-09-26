import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { injectConnectTimeout, CONNECT_TIMEOUT_S } = require('./withConnectTimeout.cjs')

// Verbatim shape of the Expo SDK 55/56 template (aldris, 2026-09-26).
const MAIN_APP = `package com.enderra.daelies

import android.app.Application

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
`

describe('withConnectTimeout', () => {
  it('installs the factory right after super.onCreate(), with its imports', () => {
    const out = injectConnectTimeout(MAIN_APP)
    expect(out).toContain('import com.facebook.react.modules.network.OkHttpClientProvider')
    expect(out).toContain('import java.util.concurrent.TimeUnit')
    expect(out).toMatch(/super\.onCreate\(\)\n\s+\/\/ @enderra\/auth: connect timeout\n\s+OkHttpClientProvider\.setOkHttpClientFactory/)
    // before RN loads, or the first client is built without it
    expect(out.indexOf('setOkHttpClientFactory')).toBeLessThan(out.indexOf('loadReactNative'))
  })

  it('is idempotent across repeated prebuilds', () => {
    const once = injectConnectTimeout(MAIN_APP)
    expect(injectConnectTimeout(once)).toBe(once)
  })

  it('fails loudly when the template changes shape', () => {
    expect(() => injectConnectTimeout('package x\nclass A')).toThrow(/anchor not found/)
  })

  // The real test: a blackholed first address must not hang the request.
  const jars = findOkHttpJars()
  it.skipIf(!jars)('falls through a blackholed address within the timeout', () => {
    const out = execFileSync('java', ['-cp', jars!, join(__dirname, 'ConnectFallback.java'), String(CONNECT_TIMEOUT_S)], {
      encoding: 'utf8',
    })
    expect(out).toContain('HTTP 200')
  }, 30_000)
})

function findOkHttpJars(): string | null {
  const c = join(homedir(), '.gradle/caches/modules-2/files-2.1')
  const pick = (dir: string, file: string) => {
    const d = join(c, dir)
    if (!existsSync(d)) return null
    for (const h of readdirSync(d)) if (existsSync(join(d, h, file))) return join(d, h, file)
    return null
  }
  const parts = [
    pick('com.squareup.okhttp3/okhttp/4.9.2', 'okhttp-4.9.2.jar'),
    pick('com.squareup.okio/okio/2.9.0', 'okio-jvm-2.9.0.jar'),
    pick('org.jetbrains.kotlin/kotlin-stdlib/1.9.10', 'kotlin-stdlib-1.9.10.jar'),
  ]
  return parts.every(Boolean) ? parts.join(':') : null
}
