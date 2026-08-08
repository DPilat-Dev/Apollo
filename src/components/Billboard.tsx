import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { displayTitle, episodeCode, formatRuntime, isResumable, playedFraction } from '../lib/format'
import { MatchBadge } from './MatchBadge'
import { useSettings } from '../lib/settings'
import { InfoIcon, PlayIcon } from './icons'

/**
 * Full-bleed hero at the top of Home, cycling through five candidates every 12s.
 *
 * Home draws those from what this person watches — part-way through, or
 * finished and worth another go — shuffled per visit, so the set changes rather
 * than showing the same titles forever.
 */
export function Billboard({ items }: { items: BaseItemDto[] }) {
  const api = useApi()
  const navigate = useNavigate()
  const { reduceMotion } = useSettings()
  const [index, setIndex] = useState(0)

  const pool = items.slice(0, 5)

  useEffect(() => {
    if (pool.length < 2 || reduceMotion) return
    const t = setInterval(() => setIndex((i) => (i + 1) % pool.length), 12_000)
    return () => clearInterval(t)
  }, [pool.length, reduceMotion])

  if (pool.length === 0) return <div className="h-24" />

  // The hero spans the viewport, so ask for what is actually on screen rather
  // than a fixed 1920 that is too small on a wide display and wasteful on a phone.
  const heroWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const item = pool[Math.min(index, pool.length - 1)]
  const backdrop = api.heroBackdropUrl(item, heroWidth)
  const logo = api.logoUrl(item, 640)

  // Say why this is here — an unexplained rewatch suggestion reads as a bug.
  const resuming = isResumable(item)
  const context = resuming
    ? item.Type === 'Episode'
      ? `Continue watching · ${episodeCode(item) ?? ''}`.trim()
      : 'Continue watching'
    : item.UserData?.Played
      ? 'Watch it again'
      : null

  return (
    <header className="relative h-[68vh] min-h-[30rem] w-full sm:h-[84vh]">
      {pool.map((candidate, i) => {
        const src = api.heroBackdropUrl(candidate, heroWidth)
        if (!src) return null
        return (
          <img
            key={candidate.Id}
            src={src}
            alt=""
            aria-hidden={i !== index}
            className={`absolute inset-0 h-full w-full object-cover object-top ${
              reduceMotion ? '' : 'transition-opacity duration-[1200ms] ease-out'
            }`}
            style={{ opacity: i === index ? 1 : 0 }}
          />
        )
      })}
      {!backdrop && <div className="absolute inset-0 bg-ink-soft" />}

      {/* Two-axis scrim: bottom fade into the rows, left fade behind the copy. */}
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/50 to-transparent" />

      {/*
        Bottom padding here must exceed the negative margin Home applies to the
        row stack, otherwise the first row lands on top of these buttons.
      */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-16 sm:px-14 sm:pb-28">
        <div className="max-w-xl">
          {context && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/60">
              {context}
            </p>
          )}

          {logo ? (
            <img
              src={logo}
              alt={displayTitle(item)}
              className="mb-5 max-h-32 w-auto max-w-[85%] object-contain object-left drop-shadow-2xl sm:max-h-40"
            />
          ) : (
            <h1 className="mb-5 text-4xl font-black tracking-tight text-white drop-shadow-2xl sm:text-6xl">
              {displayTitle(item)}
            </h1>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/75">
            <MatchBadge item={item} />
            {item.ProductionYear && <span>{item.ProductionYear}</span>}
            {item.OfficialRating && (
              <span className="border border-white/30 px-1.5 text-xs leading-relaxed">
                {item.OfficialRating}
              </span>
            )}
            {formatRuntime(item.RunTimeTicks) && <span>{formatRuntime(item.RunTimeTicks)}</span>}
          </div>

          {resuming && (
            <div className="mb-5 max-w-sm">
              <div className="h-1 overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.round(playedFraction(item) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {item.Overview && (
            <p className="mb-6 line-clamp-3 text-sm text-white/80 drop-shadow sm:text-base">
              {item.Overview}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/watch/${item.Id}`)}
              className="flex items-center gap-2 rounded bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-white/80 sm:text-base"
            >
              <PlayIcon className="size-5" />
              {resuming ? 'Resume' : 'Play'}
            </button>
            <button
              onClick={() => navigate(`/item/${item.Id}`)}
              className="flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/30 sm:text-base"
            >
              <InfoIcon className="size-5" />
              More Info
            </button>
          </div>
        </div>
      </div>

      {/* Aligned to the button row, not the hero's edge — the bottom strip is
          overlapped by the first carousel. */}
      {pool.length > 1 && (
        <div className="absolute bottom-16 right-4 hidden gap-1.5 sm:bottom-28 sm:right-14 sm:flex">
          {pool.map((c, i) => (
            <button
              key={c.Id}
              onClick={() => setIndex(i)}
              aria-label={`Show ${displayTitle(c)}`}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === index ? 'w-7 bg-white' : 'w-3 bg-white/35 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      )}
    </header>
  )
}
