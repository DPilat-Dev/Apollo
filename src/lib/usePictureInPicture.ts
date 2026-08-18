import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Pops the video out into a floating window that survives leaving the tab.
 *
 * Support is decided per element, not per browser: `disablePictureInPicture`
 * is a real attribute, and Firefox exposes its own UI while implementing none
 * of this API — so the button appears only where pressing it would work.
 */
export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement | null>) {
  const [supported, setSupported] = useState(false)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    setSupported(
      Boolean(document.pictureInPictureEnabled) &&
        !video.disablePictureInPicture &&
        typeof video.requestPictureInPicture === 'function',
    )

    const onEnter = () => setActive(true)
    const onLeave = () => setActive(false)
    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)

    /*
      A source change while the window is open keeps the window — the next
      episode simply plays in it. The state is re-read rather than assumed so
      the button does not fall out of step with what is on screen.
    */
    setActive(document.pictureInPictureElement === video)

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [videoRef])

  const toggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {})
    } else {
      // Rejects when the video has no metadata yet, or without a user gesture.
      void video.requestPictureInPicture().catch(() => {})
    }
  }, [videoRef])

  return { supported, active, toggle }
}
