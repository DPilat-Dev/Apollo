import { useEffect, useRef, useState } from 'react'
import type { JellyfinApi } from './api'
import { applySettings, currentSettings, useSettings, type Settings } from './settings'
import {
  decodeSettings,
  encodeSettings,
  readLastSynced,
  reconcile,
  SYNC_CLIENT,
  SYNC_PREFERENCES_ID,
  syncedPartChanged,
  writeLastSynced,
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

    State rather than a ref, and that matters: the push effect below reads this
    on the way in and returns early while it is false. A ref would never wake it
    again, so a change made before the pull landed — or carried over from a
    previous visit — would sit unsent until something else happened to move a
    setting.
  */
  const [pulled, setPulled] = useState(false)
  const lastPushed = useRef<Settings | null>(null)
  /** The other clients' entries in the shared bag, as last seen. */
  const otherPrefs = useRef<Record<string, string | null>>({})

  useEffect(() => {
    if (!api || !userId) return
    setPulled(false)
    let cancelled = false

    const pull = async () => {
      const prefs = await api.displayPreferences(SYNC_PREFERENCES_ID, SYNC_CLIENT)
      if (cancelled) return
      otherPrefs.current = prefs?.CustomPrefs ?? {}

      const { settings: next, push } = reconcile({
        local: currentSettings(),
        remote: decodeSettings(prefs?.CustomPrefs ?? null),
        lastSynced: readLastSynced(),
      })
      if (next !== currentSettings()) applySettings(next)
      /*
        `lastPushed` decides whether the effect below sends anything. Leaving it
        unset when the local copy is the newer one is what makes an unsent
        change go out on the next load instead of being lost.
      */
      lastPushed.current = push ? null : next
      if (!push) writeLastSynced(next)
    }

    pull()
      .catch(() => {
        // An older server, a user with no preferences yet, or no network.
        // Local settings keep working, and pushing is still allowed — that is
        // what creates the record the first time.
        if (!cancelled) lastPushed.current = null
      })
      .finally(() => {
        if (!cancelled) setPulled(true)
      })

    return () => {
      cancelled = true
    }
  }, [api, userId])

  useEffect(() => {
    if (!api || !userId || !pulled) return
    const previous = lastPushed.current
    if (previous && !syncedPartChanged(previous, settings)) return

    const push = () => {
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
        .then((existing) => {
          if (existing?.CustomPrefs) otherPrefs.current = existing.CustomPrefs
          return api
            .saveDisplayPreferences(SYNC_PREFERENCES_ID, SYNC_CLIENT, {
              ...(existing ?? {}),
              Id: SYNC_PREFERENCES_ID,
              Client: SYNC_CLIENT,
              CustomPrefs: { ...(existing?.CustomPrefs ?? {}), ...encodeSettings(snapshot) },
            })
            // Only once the server has it: an agreement neither side reached
            // would let the next load discard a change that never arrived.
            .then(() => writeLastSynced(snapshot))
        })
        .catch(() => {})
    }

    const timer = setTimeout(push, PUSH_DELAY_MS)


    return () => clearTimeout(timer)
  }, [api, userId, settings, pulled])
}
