/**
 * Shown only on the hosted demo.
 *
 * The demo is served over HTTPS, and a browser refuses to let an HTTPS page
 * talk to a plain-HTTP server. Most self-hosted Jellyfin installs are exactly
 * that, so this has to be said up front rather than left as a mystery failure.
 */
export function DemoNotice() {
  if (!import.meta.env.VITE_DEMO) return null

  return (
    <div className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100/90">
      <p className="font-semibold text-amber-200">Live demo — bring your own server</p>
      <p className="mt-1.5">
        This page is served over HTTPS, so it can only reach a Jellyfin server that is
        also on HTTPS with a valid certificate. A plain <code>http://192.168.x.x:8096</code>{' '}
        address will be blocked by your browser, and no client can work around that.
      </p>
      <p className="mt-1.5 text-amber-100/70">
        Nothing is sent anywhere except your own server. Your password is used to sign in
        and never stored; the access token stays in this browser.
      </p>
    </div>
  )
}
