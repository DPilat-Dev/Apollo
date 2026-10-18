import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import {
  cardLabel,
  displayTitle,
  formatRuntime,
  itemSubtitle,
  playedFraction,
  remainingLabel,
} from '../lib/format'
import { blurhashBackground } from '../lib/blurhash'
import { boxSetHref } from '../lib/boxSets'
import { useTogglePlayed } from '../lib/queries'
import { MatchBadge } from './MatchBadge'
import { PlayIcon, ChevronDown, CloseIcon, WatchedIcon } from './icons'
import { useReducedMotion } from '../lib/useReducedMotion'

export type CardShape = 'poster' | 'landscape'

interface Props {
  item: BaseItemDto
  shape?: CardShape
  /** Landscape cards on the Continue Watching row show a progress bar. */
  showProgress?: boolean
  /** Given, the card gets a dismiss control. */
  onRemove?: () => void
  /**
   * What that control says it does. It used to say "Continue Watching"
   * unconditionally, which was true of the only caller — a collection's grid
   * takes something out of the collection, and a button that names the wrong
   * list is a button people are right not to trust.
   */
  removeLabel?: string
}

/**
 * A row tile. On hover it lifts and reveals a detail tray, the way Netflix
 * expands cards in place — implemented with scale + z-index so it doesn't
 * reflow the row.
 */
/**
 * One card. Memoised, because a library grid appends to itself.
 *
 * Paging in the next 60 items re-rendered every card already on screen. By the
 * seventh page that is 420 cards rebuilt to add 60, and it showed: scrolling a
 * real library produced 422ms of blocking work in three long tasks, and the two
 * biggest — 176ms and 195ms — landed exactly on the two page appends. It was
 * never the scrolling.
 *
 * The grid passes `item` and nothing else, and those objects come straight from
 * the query cache, so their references survive an append and the comparison is
 * a pointer check. Call sites that pass an inline `onRemove` opt themselves out,
 * which is fine — those are short lists.
 */
export const MediaCard = memo(function MediaCard({
  item,
  shape = 'poster',
  showProgress = false,
  onRemove,
  removeLabel = 'Continue Watching',
}: Props) {
  const api = useApi()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const played = useTogglePlayed()

  const isLandscape = shape === 'landscape'
  const img = isLandscape
    ? (api.backdropUrl(item, 640) ?? api.posterUrl(item, 400))
    : (api.posterUrl(item, 400) ?? api.backdropUrl(item, 640))

  const progress = playedFraction(item)
  /** The resume overlay and the "1h 12m left" block, which own the bottom edge. */
  const hasProgressBlock = showProgress && progress > 0
  const watched = Boolean(item.UserData?.Played)
  const detailId = item.Type === 'Episode' ? (item.SeriesId ?? item.Id) : item.Id

  // A collection has nothing to show on a detail page and nothing to play:
  // opening one means seeing what is in it. Everything else is unaffected,
  // because this is null for everything else.
  const collection = boxSetHref(item)
  const isCollection = collection !== null

  const open = () => navigate(collection ?? `/item/${detailId}`)
  const play = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(`/watch/${item.Id}`)
  }
  const toggleWatched = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (item.Id) played.mutate({ itemId: item.Id, played: !watched })
  }
  const watchedLabel = watched ? 'Mark as unwatched' : 'Mark as watched'
  /*
    The tile behind every one of these is a role="button" that opens the item
    on Enter and Space, and keydown bubbles — so without this, marking
    something watched from the keyboard also navigated to it.
  */
  const keepKeysHere = (e: React.KeyboardEvent) => e.stopPropagation()

  return (
    <div
      className={`group/card relative shrink-0 ${
        isLandscape ? 'w-[17rem] sm:w-[21rem]' : 'w-[9.5rem] sm:w-[11.5rem]'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        /*
          Named explicitly, because otherwise the name is assembled from
          everything inside — including the tray below, which is hidden. A
          screen reader read "Play Dune, More info, Mark as watched, 92% match,
          PG-13, 2h 35m, Sci-Fi · Adventure, button" for one poster.

          Through `cardLabel`, so the name still carries what the badges say:
          the title alone made a series with three episodes left, a watched film
          and a half-watched one into three identical announcements.
        */
        aria-label={cardLabel(item, { showProgress })}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        className={`relative cursor-pointer rounded-lg outline-none transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/card:z-30 group-hover/card:shadow-2xl group-hover/card:shadow-black/70 ${
          reduceMotion ? '' : 'group-hover/card:scale-[1.09] focus-visible:scale-[1.09]'
        }`}
      >
        <div
          className={`relative overflow-hidden rounded-lg bg-ink-card ${
            isLandscape ? 'aspect-video' : 'aspect-2/3'
          }`}
        >
          {img ? (
            <img
              src={img}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              style={blurhashBackground(item, img)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs font-medium text-white/40">
              {displayTitle(item)}
            </div>
          )}

          {/* Scrim so the title stays readable over bright art on hover. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover/card:opacity-100" />

          {/* Resume affordance: one click straight back into playback. */}
          {hasProgressBlock && (
            <button
              onClick={play}
              aria-label={`Resume ${displayTitle(item)}`}
              className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 touch:opacity-100"
            >
              <span className="flex size-12 items-center justify-center rounded-full border-2 border-white/90 bg-black/45 backdrop-blur-sm">
                <PlayIcon className="ml-0.5 size-6" />
              </span>
            </button>
          )}

          {hasProgressBlock && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2.5 pb-2.5 pt-6 bg-gradient-to-t from-black/85 to-transparent">
              {remainingLabel(item) && (
                <p className="mb-1.5 text-[11px] font-medium text-white/80">
                  {remainingLabel(item)}
                </p>
              )}
              <div className="h-[3px] overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {item.UserData?.UnplayedItemCount ? (
            <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
              {item.UserData.UnplayedItemCount}
            </span>
          ) : watched ? (
            <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-black">
              <WatchedIcon className="size-4" />
            </span>
          ) : null}

          {/*
            The watched toggle, again, for the two cases the tray below cannot
            serve.

            On a touchscreen the tray is unreachable — there is no hover — and
            revealing it under `touch:` is not the answer: it is absolutely
            positioned at `top-full`, so on a phone grid it would sit over the
            next row of posters on every card at once. Play and More info
            survive that, since tapping the tile is More info and the detail
            page has a Play button; marking something watched had nowhere else
            to go from a grid.

            Bottom left, because the right corner carries the count or the tick
            and the top left carries the dismiss control — except on a Continue
            Watching card, where the progress block runs the full width of the
            bottom: at `bottom-2` this circle sat on the left end of the bar and
            over the first characters of "1h 12m left". It is touch-only, so
            nothing about that was visible while developing on a desktop.
          */}
          <button
            onClick={toggleWatched}
            onKeyDown={keepKeysHere}
            disabled={played.isPending}
            aria-label={watchedLabel}
            title={watchedLabel}
            className={`absolute left-2 z-10 hidden size-7 items-center justify-center rounded-full bg-black/65 backdrop-blur-sm transition disabled:opacity-50 touch:flex ${
              hasProgressBlock ? 'bottom-11' : 'bottom-2'
            } ${watched ? 'text-emerald-400' : 'text-white/75'}`}
          >
            <WatchedIcon className="size-4" filled={watched} />
          </button>

          {/*
            Top *left*: the right corner already carries the unwatched count or
            the watched tick. Sits above the resume overlay, which covers the
            whole tile, so a click here dismisses rather than resuming.

            Revealed by hover for a mouse and always on show under `touch:`
            (`hover: none`), the same bargain the resume overlay strikes — a
            touchscreen has no hover state to reveal it, and a control nobody
            can reach is worse than a slightly busier tile.
          */}
          {onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              // The tile behind is a role="button" that opens the item on Enter
              // and Space, and the event bubbles — dismissing with the keyboard
              // would otherwise navigate to what was just dismissed.
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={`Remove ${displayTitle(item)} from ${removeLabel}`}
              title={`Remove from ${removeLabel}`}
              className="absolute left-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-black/65 text-white/75 opacity-0 backdrop-blur-sm transition hover:bg-black/85 hover:text-white focus-visible:opacity-100 group-hover/card:opacity-100 touch:opacity-100"
            >
              <CloseIcon className="size-3.5" />
            </button>
          )}
        </div>

        {/*
          Hover tray — absolutely positioned so it never affects row height.

          `invisible` rather than opacity alone. `pointer-events-none` hides it
          from the mouse but not from the accessibility tree and not from Tab,
          so a keyboard user walked three invisible buttons per card — 180 of
          them in a sixty-card grid — and a screen reader read all three out as
          part of the tile's name. `visibility: hidden` takes it out of both,
          and the focus variant brings it back the moment something in the card
          is focused, which is what makes Tab land on Play next rather than on
          the following card. Visibility is in the transition so the fade out
          still finishes before it disappears.

          `has-[:focus-visible]` and not `focus-within`. Chromium focuses a
          `<button>` on tap, and the touch-only watched toggle above is inside
          this group — so on Android, tapping it satisfied `:focus-within` and
          dropped this tray over the next row of posters, where it stayed: the
          card lost its caption, and the next tap aimed at a poster landed on
          the previous card's Play button and started the wrong film. That is
          the exact failure refusing `touch:` here was avoiding, through the
          other door. `:focus-visible` is not applied on tap.
        */}
        <div className="invisible pointer-events-none absolute inset-x-0 top-full z-30 origin-top rounded-b-lg bg-ink-card/95 px-3 pb-3 pt-2 opacity-0 shadow-2xl shadow-black/70 backdrop-blur-sm transition-[opacity,visibility] duration-200 group-hover/card:visible group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-has-[:focus-visible]/card:visible group-has-[:focus-visible]/card:pointer-events-auto group-has-[:focus-visible]/card:opacity-100">
          <div className="flex items-center gap-2">
            {/* There is no stream behind a collection, so it gets no Play. */}
            {!isCollection && (
              <button
                onClick={play}
                onKeyDown={keepKeysHere}
                aria-label={`Play ${displayTitle(item)}`}
                className="flex size-8 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/85"
              >
                <PlayIcon className="ml-0.5 size-4" />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                open()
              }}
              onKeyDown={keepKeysHere}
              aria-label={isCollection ? 'See what is in this collection' : 'More info'}
              className="flex size-8 items-center justify-center rounded-full border border-white/40 text-white/90 transition hover:border-white"
            >
              <ChevronDown className="size-4" />
            </button>
            <button
              onClick={toggleWatched}
              onKeyDown={keepKeysHere}
              disabled={played.isPending}
              aria-label={watchedLabel}
              title={watchedLabel}
              className={`ml-auto flex size-8 items-center justify-center rounded-full border transition disabled:opacity-50 ${
                watched
                  ? 'border-emerald-400 text-emerald-400'
                  : 'border-white/40 text-white/80 hover:border-white'
              }`}
            >
              <WatchedIcon className="size-4" filled={watched} />
            </button>
          </div>

          <p className="mt-2 line-clamp-1 text-[13px] font-semibold text-white">
            {displayTitle(item)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/55">
            <MatchBadge item={item} />
            {item.OfficialRating && (
              <span className="border border-white/25 px-1 leading-tight">{item.OfficialRating}</span>
            )}
            {formatRuntime(item.RunTimeTicks) && <span>{formatRuntime(item.RunTimeTicks)}</span>}
          </p>
          {item.Genres && item.Genres.length > 0 && (
            <p className="mt-1 line-clamp-1 text-[11px] text-white/45">
              {item.Genres.slice(0, 3).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* Static caption, hidden while the tray is open to avoid doubled titles —
          on the same condition as the tray, or a tap would take the caption
          away without putting anything in its place. */}
      <div className="mt-2 px-0.5 transition-opacity duration-200 group-hover/card:opacity-0 group-has-[:focus-visible]/card:opacity-0">
        <p className="line-clamp-1 text-[13px] font-medium text-white/85">{displayTitle(item)}</p>
        {itemSubtitle(item) && (
          <p className="line-clamp-1 text-[11px] text-white/45">{itemSubtitle(item)}</p>
        )}
      </div>
    </div>
  )
})

export function CardSkeleton({ shape = 'poster' }: { shape?: CardShape }) {
  const isLandscape = shape === 'landscape'
  return (
    <div className={`shrink-0 ${isLandscape ? 'w-[17rem] sm:w-[20rem]' : 'w-[9.5rem] sm:w-[11.5rem]'}`}>
      <div className={`skeleton rounded-lg ${isLandscape ? 'aspect-video' : 'aspect-2/3'}`} />
      <div className="skeleton mt-2 h-3 w-3/4 rounded" />
    </div>
  )
}
