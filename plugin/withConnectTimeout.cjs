// Expo config plugin: give React Native's shared OkHttp client a connect timeout.
//
// 2026-09-26: RN 0.83–0.85 ship OkHttpClientProvider with connectTimeout(0) = infinite,
// on OkHttp 4.9.2, which walks a host's addresses serially and only advances when a
// connect FAILS. On a network that advertises IPv6 but drops it, the AAAA address is
// tried first and never fails, so the IPv4 address is never reached: blank screen
// forever (Couriel on player1's Wi-Fi). Browsers are immune (Happy Eyeballs).
// Repro: plugin/ConnectFallback.java. One factory covers fetch AND supabase-js — they
// share this client.
// ponytail: fixed 5s per address; OkHttp 5's fastFallback (real Happy Eyeballs) is the
// upgrade once RN moves off 4.x.
const CONNECT_TIMEOUT_S = 5

const MARKER = '// @enderra/auth: connect timeout'
const IMPORTS = [
  'import com.facebook.react.modules.network.OkHttpClientProvider',
  'import java.util.concurrent.TimeUnit',
]
const SNIPPET = `    ${MARKER}
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder(applicationContext)
        .connectTimeout(${CONNECT_TIMEOUT_S}L, TimeUnit.SECONDS)
        .build()
    }`

function injectConnectTimeout(src) {
  if (src.includes(MARKER)) return src
  const anchor = /override fun onCreate\(\) \{\n\s*super\.onCreate\(\)\n/
  if (!anchor.test(src)) throw new Error('@enderra/auth withConnectTimeout: MainApplication.onCreate anchor not found')
  let out = src.replace(anchor, (m) => `${m}${SNIPPET}\n`)
  const missing = IMPORTS.filter((i) => !out.includes(i))
  if (missing.length) out = out.replace(/^(package [^\n]+\n)/, `$1\n${missing.join('\n')}\n`)
  return out
}

function withConnectTimeout(config) {
  const { withMainApplication } = require('expo/config-plugins')
  return withMainApplication(config, (c) => {
    if (c.modResults.language !== 'kt') throw new Error('@enderra/auth withConnectTimeout: expected Kotlin MainApplication')
    c.modResults.contents = injectConnectTimeout(c.modResults.contents)
    return c
  })
}

module.exports = withConnectTimeout
module.exports.injectConnectTimeout = injectConnectTimeout
module.exports.CONNECT_TIMEOUT_S = CONNECT_TIMEOUT_S
