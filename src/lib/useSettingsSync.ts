import { useEffect, useRef } from 'react'
import type { JellyfinApi } from './api'
import { applySettings, currentSettings, useSettings, type Settings } from './settings'
import {
  decodeSettings,
  encodeSettings,
  mergeFromServer,
  SYNC_CLIENT,
  SYNC_PREFERENCES_ID,
  syncedPartChanged,
} from './settingsSync'

/**
 * How long to sit on a change before sending it.
 *
 * Long enough that dragging the subtitle size slider from 100 to 200 is one
 * request rather than twenty, short enough that picking up another device
 * straight afterwards finds the new value.
 */
const PUSH_DELAY_MS = 1500

/**
 * Keeps the travelling half of the settings in step with the server.
 *
 * Pulls once when the account is known, then pushes changes. Everything about
 * *which* settings travel, and what happens when the two disagree, is in
 * `settingsSync.ts` where it can be tested; this is the part that needs a
 * network and a clock.
 *
 * Failure is silent by design. Settings that do not sync are a small
 * disappointment; an error toast over a working app because a preferences
 * write 404'd on an old server is worse, and there is nothing the viewer could
 * do about it.
 */
export function useSettingsSync(api: JellyfinApi | null | undefined, userId: string | undefined) {
  const settings = useSettings()

  /*
    Nothing is pushed until the pull has finished. Otherwise the first render
    would send this device's defaults up and overwrite the very settings it is
    about to ask for.
  */
  const pulled = useRef(false)
  const lastPushed = useRef<Settings | null>(null)

  useEffect(() => {
    if (!api || !userId) return
    pulled.current = false
    let cancelled = false

    const pull = async () => {
      const prefs = await api.displayPreferences(SYNC_PREFERENCES_ID, SYNC_CLIENT)
      if (cancelled) return
      const remote = decodeSettings(prefs?.CustomPrefs ?? null)
      const merged = mergeFromServer(currentSettings(), remote)
      if (merged !== currentSettings()) applySettings(merged)
      lastPushed.current = merged
      pulled.current = true
    }

    pull().catch(() => {
      // An older server, a user with no preferences yet, or no network. Local
      // settings keep working; pushing is still allowed, which is what creates
      // the record the first time.
      if (!cancelled) {
        lastPushed.current = currentSettings()
        pulled.current = true
      }
    })

    return () => {
      cancelled = true
    }
  }, [api, userId])

  useEffect(() => {
    if (!api || !userId || !pulled.current) return
    const previous = lastPushed.current
    if (previous && !syncedPartChanged(previous, settings)) return

    const timer = setTimeout(() => {
      const snapshot = currentSettings()
      lastPushed.current = snapshot
      /*
        Read before write: the route replaces the whole record rather than
        patching it, so anything on it that Apollo does not use has to be sent
        back or it is blanked.
      */
      void api
        .displayPreferences(SYNC_PREFERENCES_ID, SYNC_CLIENT)
        .catch(() => null)
        .then((existing) =>
          api.saveDisplayPreferences(SYNC_PREFERENCES_ID, SYNC_CLIENT, {
            ...(existing ?? {}),
            Id: SYNC_PREFERENCES_ID,
            Client: SYNC_CLIENT,
            CustomPrefs: { ...(existing?.CustomPrefs ?? {}), ...encodeSettings(snapshot) },
          }),
        )
        .catch(() => {})
    }, PUSH_DELAY_MS)

    return () => clearTimeout(timer)
  }, [api, userId, settings])
}
