// React glue: one updater per mount, checked on mount (cold start) and whenever the app
// returns to the foreground. The banner component itself lives in each app (its own theme).
import { useEffect, useRef, useState } from 'react'
import { createUpdater, type UpdateState, type Updater, type UpdaterOptions } from './updater.js'

/** `import { AppState } from 'react-native'` */
export interface AppStateLike {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void }
}

export function useAppUpdate(opts: UpdaterOptions & { appState: AppStateLike }) {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' })
  const ref = useRef<Updater | null>(null)
  if (!ref.current) ref.current = createUpdater({ ...opts, onChange: setState })
  const u = ref.current

  useEffect(() => {
    void u.check()
    const sub = opts.appState.addEventListener('change', (s) => { if (s === 'active') void u.check() })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount by design
  }, [])

  return { state, update: u.update, later: u.later, openInstallSettings: u.openInstallSettings }
}
