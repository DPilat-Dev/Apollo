/**
 * Waiting for a PGS track, and what to say while it happens.
 *
 * ── What the server is doing ───────────────────────────────────────────────
 *
 * The first request for a subtitle stream inside a Matroska file does not
 * return a file; it starts one being made. Jellyfin extracts the track and
 * sends nothing at all until it has finished. Measured against 10.11.8:
 *
 *   first ever request, 100-minute film     185 s to the first byte
 *   first ever request, 138-minute film     still going at 7 minutes
 *   either of them once extracted           0.2–0.8 s for ~40 MB
 *
 * So this is not a download and not a stall. It is one-off work on the server,
 * it scales with the length of the film, and every later request is instant.
 *
 * ── Why there is no deadline here ──────────────────────────────────────────
 *
 * There used to be one, of sixty seconds, and it was worse than useless.
 *
 * Nothing is blocked while the wait runs — the film is playing, and this only
 * decides how long to keep hoping. Giving up does not rescue anybody: there is
 * no `<track>` to fall back to for a picture format, so failing means asking
 * the server to burn the track in, which rebuilds the stream and restarts the
 * film as a transcode. That is a heavy thing to do to someone who is watching,
 * and it fired a minute into an extraction that would have succeeded.
 *
 * Worse, giving up destroys the work. Aborting the request appears to take
 * ffmpeg with it: a film abandoned four minutes into its extraction was asked
 * again, patiently, and had produced nothing seven minutes later — where an
 * uninterrupted request for a comparable film finished in three. So a deadline
 * does not merely fail to help, it guarantees the next attempt starts from
 * nothing.
 *
 * What is left is to wait, to say so honestly, and to fall back only on a real
 * failure: a response that is not OK, a network that drops, a renderer that
 * will not start. Those are quick and unambiguous, and `usePgsSubtitles` still
 * hands every one of them to the burn-in path.
 */

/**
 * How long the renderer gets, once the bytes are actually in hand.
 *
 * Short, and it can afford to be: this no longer covers a download. It is a
 * worker starting and a buffer being parsed, and if that has not happened in
 * fifteen seconds it is not going to.
 */
export const PGS_RENDER_TIMEOUT_MS = 15_000

/** After this, stop claiming it is loading and say what is really happening. */
export const PGS_PREPARING_AFTER_MS = 12_000

/**
 * What to put on screen while waiting.
 *
 * "Loading subtitles…" is true for a second or two and a lie for the next
 * three minutes, and a viewer reading it cannot tell a slow server from a
 * broken one. Naming the work, and saying it is a first-time cost, is the
 * difference between waiting and wondering whether to give up and reload.
 */
export function pgsWaitMessage(elapsedMs: number): string {
  return elapsedMs >= PGS_PREPARING_AFTER_MS
    ? 'Preparing subtitles on the server — this can take a few minutes the first time'
    : 'Loading subtitles…'
}
