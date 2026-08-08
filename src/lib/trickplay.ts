import type { BaseItemDto, TrickplayInfoDto } from '@jellyfin/sdk/lib/generated-client/models'
import type { JellyfinApi } from './api'

/**
 * Trickplay: the thumbnail strip shown while scrubbing.
 *
 * The server bakes thumbnails into sprite sheets — one JPEG holding a grid of
 * TileWidth × TileHeight frames — so showing a preview is arithmetic on a
 * cached image rather than a request per pixel of cursor movement.
 */

export interface TrickplaySelection {
  info: TrickplayInfoDto
  /** The resolution key, which is also the width segment in the tile URL. */
  width: number
}

/**
 * Picks the largest variant that isn't bigger than we intend to draw. Falls
 * back to the smallest available so an odd configuration still previews.
 */
export function selectTrickplay(
  item: BaseItemDto | null | undefined,
  mediaSourceId?: string,
  maxWidth = 320,
): TrickplaySelection | null {
  const manifest = item?.Trickplay as
    | Record<string, Record<string, TrickplayInfoDto>>
    | null
    | undefined
  if (!manifest) return null

  const forSource =
    (mediaSourceId ? manifest[mediaSourceId] : undefined) ?? Object.values(manifest)[0]
  if (!forSource) return null

  const variants = Object.entries(forSource)
    .map(([width, info]) => ({ width: Number(width), info }))
    .filter((v) => Number.isFinite(v.width) && v.info?.Interval)
    .sort((a, b) => a.width - b.width)
  if (variants.length === 0) return null

  const fitting = variants.filter((v) => v.width <= maxWidth)
  return fitting.length > 0 ? fitting[fitting.length - 1] : variants[0]
}

export interface TrickplaySprite {
  url: string
  width: number
  height: number
  /** Ready for a style object: the sheet scaled and offset to one frame. */
  backgroundSize: string
  backgroundPosition: string
}

/** Which frame covers `seconds`, and where it sits in its sheet. */
export function trickplaySprite(
  api: JellyfinApi,
  itemId: string,
  selection: TrickplaySelection,
  seconds: number,
  mediaSourceId?: string,
): TrickplaySprite | null {
  const { info, width } = selection
  const interval = info.Interval ?? 0
  const tileWidth = info.TileWidth ?? 0
  const tileHeight = info.TileHeight ?? 0
  const frameWidth = info.Width ?? width
  const frameHeight = info.Height ?? 0
  if (interval <= 0 || tileWidth <= 0 || tileHeight <= 0 || frameHeight <= 0) return null

  const perSheet = tileWidth * tileHeight
  let index = Math.floor((Math.max(seconds, 0) * 1000) / interval)
  // Past the last generated frame, hold on the final one rather than
  // requesting a sheet that doesn't exist.
  if (info.ThumbnailCount && info.ThumbnailCount > 0) {
    index = Math.min(index, info.ThumbnailCount - 1)
  }

  const sheet = Math.floor(index / perSheet)
  const within = index % perSheet
  const column = within % tileWidth
  const row = Math.floor(within / tileWidth)

  return {
    url: api.authedUrl(`/Videos/${itemId}/Trickplay/${width}/${sheet}.jpg`, {
      mediaSourceId,
    }),
    width: frameWidth,
    height: frameHeight,
    backgroundSize: `${tileWidth * frameWidth}px ${tileHeight * frameHeight}px`,
    backgroundPosition: `-${column * frameWidth}px -${row * frameHeight}px`,
  }
}
