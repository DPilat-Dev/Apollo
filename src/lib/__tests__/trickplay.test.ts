import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { selectTrickplay, trickplaySprite } from '../trickplay'

const info = (over: Record<string, number> = {}) => ({
  Width: 320,
  Height: 180,
  TileWidth: 10,
  TileHeight: 10,
  ThumbnailCount: 250,
  Interval: 10_000,
  Bandwidth: 1,
  ...over,
})

const item = {
  Trickplay: { 'ms-1': { '320': info(), '640': info({ Width: 640, Height: 360 }) } },
} as unknown as BaseItemDto

// Only the two methods the sprite maths needs.
const api = {
  authedUrl: (path: string) => `http://server${path}?api_key=x`,
} as never

describe('selectTrickplay', () => {
  it('prefers the largest variant within budget', () => {
    expect(selectTrickplay(item, 'ms-1', 320)?.width).toBe(320)
    expect(selectTrickplay(item, 'ms-1', 1000)?.width).toBe(640)
  })

  it('falls back to the smallest when everything is too big', () => {
    expect(selectTrickplay(item, 'ms-1', 100)?.width).toBe(320)
  })

  it('uses any source when the requested one is absent', () => {
    expect(selectTrickplay(item, 'no-such-source', 320)?.width).toBe(320)
  })

  it('returns null when there is no manifest at all', () => {
    expect(selectTrickplay({} as BaseItemDto, 'ms-1')).toBeNull()
    expect(selectTrickplay(null, 'ms-1')).toBeNull()
  })
})

describe('trickplaySprite', () => {
  const selection = { info: info(), width: 320 }

  it('maps the first frame to the top-left of sheet 0', () => {
    const s = trickplaySprite(api, 'i1', selection, 0)!
    expect(s.url).toContain('/Videos/i1/Trickplay/320/0.jpg')
    expect(s.backgroundPosition).toBe('-0px -0px')
    expect(s.backgroundSize).toBe('3200px 1800px')
  })

  it('walks across a row, then down', () => {
    // 10s interval: frame 3 is column 3 of row 0.
    expect(trickplaySprite(api, 'i1', selection, 35)!.backgroundPosition).toBe('-960px -0px')
    // Frame 12 wraps to row 1, column 2.
    expect(trickplaySprite(api, 'i1', selection, 125)!.backgroundPosition).toBe('-640px -180px')
  })

  it('moves to the next sheet after 100 frames', () => {
    const s = trickplaySprite(api, 'i1', selection, 1000)!
    expect(s.url).toContain('/Trickplay/320/1.jpg')
    expect(s.backgroundPosition).toBe('-0px -0px')
  })

  it('holds on the last frame rather than asking for a sheet that is not there', () => {
    const s = trickplaySprite(api, 'i1', selection, 999_999)!
    // 250 thumbnails -> last index 249 -> sheet 2, row 4, column 9.
    expect(s.url).toContain('/Trickplay/320/2.jpg')
    expect(s.backgroundPosition).toBe('-2880px -720px')
  })

  it('refuses a manifest with impossible numbers', () => {
    expect(trickplaySprite(api, 'i1', { info: info({ Interval: 0 }), width: 320 }, 10)).toBeNull()
    expect(trickplaySprite(api, 'i1', { info: info({ TileWidth: 0 }), width: 320 }, 10)).toBeNull()
  })
})
