import { useEffect, useState } from 'react'
import { buildUrl, normalizeServer } from './api'

export interface Branding {
  LoginDisclaimer?: string
  CustomCss?: string
  SplashscreenEnabled?: boolean
}

const STYLE_ID = 'apollo-server-css'

/**
 * Branding is readable without a token, so the login screen can show the
 * server's disclaimer and custom CSS before anyone signs in.
 */
export function useBranding(server: string | undefined): Branding | null {
  const [branding, setBranding] = useState<Branding | null>(null)

  useEffect(() => {
    if (!server) {
      setBranding(null)
      return
    }
    let cancelled = false
    fetch(buildUrl(normalizeServer(server), '/Branding/Configuration'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => !cancelled && setBranding(data))
      .catch(() => !cancelled && setBranding(null))
    return () => {
      cancelled = true
    }
  }, [server])

  // Server CSS is injected as a single managed <style>, replaced on change and
  // removed when the server goes away, so it can never accumulate.
  useEffect(() => {
    const css = branding?.CustomCss?.trim()
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null

    if (!css) {
      style?.remove()
      return
    }
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = css
  }, [branding?.CustomCss])

  useEffect(() => () => document.getElementById(STYLE_ID)?.remove(), [])

  return branding
}
