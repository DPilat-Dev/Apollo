import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Which picture a card shows for an episode.
 *
 * `posterUrl` and `coverUrl` differ on exactly one item type, and the
 * difference is invisible until a library holds both films and shows: an
 * episode's own Primary image is a still from the episode, so a portrait card
 * drawn with `posterUrl` is a cropped frame of a scene with nothing on it
 * that names the show. `coverUrl` asks the series for its poster and falls
 * back to the still only when there is no series poster to ask for.
 *
 * Checked by reading source, in the shape `overlays` and `filterSurfaces`
 * already use, because the rule lives across two files and neither can be
 * wrong about it alone.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

describe('a portrait card identifies the title, not the moment', () => {
  const card = code('components/MediaCard.tsx')

  it('draws the portrait shape from the cover, never the episode still', () => {
    // The ?? fallback may name anything; the first choice may not be posterUrl.
    expect(card).toMatch(/api\.coverUrl\(item, 400\)/)
    expect(card).not.toMatch(/:\s*\(api\.posterUrl\(item, 400\)/)
  })

  it('leaves the landscape shape on backdropUrl', () => {
    // Continue Watching is about where you are, and backdropUrl already
    // inherits the series Thumb — swapping it for a poster would put a 2:3
    // image in a 16:9 frame.
    expect(card).toMatch(/isLandscape\s*\n?\s*\?\s*\(api\.backdropUrl\(item, 640\)/)
  })

  it('opens an episode card on the series, which is what its art now shows', () => {
    expect(card).toMatch(/item\.Type === 'Episode' \? \(item\.SeriesId \?\? item\.Id\)/)
  })

  it('keeps the two helpers genuinely different', () => {
    // If coverUrl ever stops preferring the series poster, every caller that
    // chose it over posterUrl silently loses the thing it chose it for.
    const api = code('lib/api.ts')
    expect(api).toMatch(
      /coverUrl\([\s\S]{0,400}?item\.Type === 'Episode'[\s\S]{0,200}?SeriesPrimaryImageTag/,
    )
  })
})
