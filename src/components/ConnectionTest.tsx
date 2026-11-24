import { useEffect, useRef, useState } from 'react'
import { useApi } from '../lib/auth'
import { FALLBACK_BPS, formatMbps, type Measurement } from '../lib/bandwidth'
import { ensureMeasurement, readMeasurement } from '../lib/useBandwidth'
import { describeAge, supportedQualityLabel, verdict } from '../lib/connectionTest'
import { BITRATE_OPTIONS } from '../lib/settings'

/**
 * "How fast is my connection to the server?", answered on the Settings page.
 *
 * Auto has measured this for a while, but only ever told anyone sideways — a
 * figure in the quality menu during playback, and a line in the stats panel.
 * The question people actually ask comes up when video stalls, which is the
 * moment they are least likely to be in the player poking at menus. So it
 * lives next to the quality setting it explains, and it is on the page for
 * every signed-in user: Jellyfin's own speed test is behind the dashboard,
 * which is exactly the door the person with the stalling TV cannot open.
 *
 * Two things it does not do. It does not change any setting — the figure feeds
 * Auto, and a fixed cap stays fixed. And it does not start on its own: a page
 * that downloads megabytes because you opened it is a page nobody should open
 * on a hotel connection.
 */
export function ConnectionTest() {
  const api = useApi()
  /*
    Opens on whatever Auto is already using. The warm-up runs a few seconds
    after the app opens, so there is usually a real figure here for free —
    better than an empty panel with a button, which implies nothing is known.
  */
  const [cached, setCached] = useState(() => readMeasurement())
  const [testing, setTesting] = useState(false)
  const [report, setReport] = useState<Measurement | null>(null)
  /*
    Set on mount, not just cleared on unmount. StrictMode mounts, unmounts and
    remounts in development, so a flag that is only cleared in the cleanup
    stays false for the rest of the component's life — every probe came back
    200 and the panel sat on "Testing…" forever.
  */
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  async function run() {
    setTesting(true)
    setReport(null)
    try {
      // Forced: the cache is the right answer everywhere else in Auto, and the
      // wrong one for a button. See `ensureMeasurement`.
      const result = await ensureMeasurement(api, { force: true })
      if (live.current) setReport(result)
    } catch {
      // `measureBitrate` swallows a failing probe and falls back, so getting
      // here means something stranger. Report it the same way: a number that
      // is honest about being a guess.
      if (live.current) setReport({ bps: FALLBACK_BPS, rawBps: null, measured: false })
    } finally {
      if (live.current) {
        setTesting(false)
        setCached(readMeasurement())
      }
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Connection speed</p>
          <p className="mt-0.5 text-xs text-white/45">
            Downloads a few megabytes of nothing from the server and times it. This is the
            measurement Auto uses to pick a quality.
          </p>
        </div>
        <button
          onClick={() => void run()}
          disabled={testing}
          className="shrink-0 rounded border border-white/20 px-4 py-2 text-sm transition hover:border-white/50 disabled:cursor-progress disabled:opacity-60"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {/*
        One region, announced politely, holding every state this panel has.
        The result replaces the button's own label rather than appearing
        somewhere else on the page, so a screen reader hears the answer to the
        thing that was just pressed.
      */}
      <div role="status" className="mt-3">
        {testing && (
          <div>
            <p className="text-xs text-white/50">Measuring — this takes a few seconds.</p>
            {/* Decorative: the line above is what gets announced. */}
            <div
              aria-hidden="true"
              className="mt-2 h-1 w-full max-w-64 overflow-hidden rounded-full bg-white/10"
            >
              <div className="h-full w-2/5 rounded-full bg-accent animate-[bitrate-sweep_1.1s_ease-in-out_infinite]" />
            </div>
          </div>
        )}

        {!testing && report?.measured && report.rawBps != null && (
          <Result rawBps={report.rawBps} ceilingBps={report.bps} />
        )}

        {!testing && report && !report.measured && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
            <p className="text-sm text-white/85">Could not measure this connection</p>
            <p className="mt-1 text-xs text-white/55">
              The server did not answer the speed test. Auto will assume{' '}
              {formatMbps(FALLBACK_BPS)}, which is deliberately cautious — if video plays fine,
              pick a fixed quality above it.
            </p>
          </div>
        )}

        {/*
          Nothing pressed yet: say what Auto is working from. A figure with no
          age on it cannot be told from a live one, and invites a second press
          of a button that has nothing left to do.
        */}
        {!testing && !report && cached && (
          <p className="text-xs text-white/50">
            Auto is using <span className="tabular-nums text-white/75">{formatMbps(cached.bps)}</span>,
            measured {describeAge(cached.at, Date.now())}.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The measured speed and what it buys.
 *
 * Both numbers, always. Auto keeps `HEADROOM` of what it measures, so a line
 * somebody knows is 40 Mbps gets asked for at 28 — and on its own that reads
 * as a measurement that is simply wrong. Showing the pair makes the haircut
 * visible, which is the whole reason it is defensible.
 */
function Result({ rawBps, ceilingBps }: { rawBps: number; ceilingBps: number }) {
  const tier = verdict(rawBps)
  const rung = supportedQualityLabel(ceilingBps, BITRATE_OPTIONS)

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{formatMbps(rawBps)}</span>
        <span className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-white/85">
          {tier.label}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-white/55">{tier.detail}</p>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-2 sm:justify-start sm:gap-1.5">
          <dt className="text-white/40">Auto will ask for</dt>
          <dd className="tabular-nums text-white/75">{formatMbps(ceilingBps)}</dd>
        </div>
        <div className="flex justify-between gap-2 sm:justify-start sm:gap-1.5">
          <dt className="text-white/40">Plays up to</dt>
          <dd className="text-white/75">{rung}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-white/35">
        Auto asks for about 70% of what it measures, so a dip in the connection eats into the
        buffer instead of emptying it.
      </p>
    </div>
  )
}
