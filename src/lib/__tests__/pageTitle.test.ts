import { describe, expect, it } from 'vitest'
import { APP_NAME, pageTitle } from '../pageTitle'

describe('pageTitle', () => {
  it('names the screen before the app', () => {
    // Tab strips truncate from the right, so the differing part goes first.
    expect(pageTitle('Breaking Bad')).toBe('Breaking Bad · Apollo')
  })

  it('reads most specific first', () => {
    expect(pageTitle('The Chosen Future', 'Gundam SEED Destiny')).toBe(
      'The Chosen Future · Gundam SEED Destiny · Apollo',
    )
  })

  it('is just the app name with nothing to say', () => {
    expect(pageTitle()).toBe(APP_NAME)
    expect(pageTitle(null, undefined, '')).toBe(APP_NAME)
  })

  it('drops missing parts instead of leaving a gap', () => {
    // Callers pass values that are still loading; branching on that at every
    // call site is how half of them end up not branching at all.
    expect(pageTitle(undefined, 'Anime')).toBe('Anime · Apollo')
    expect(pageTitle('Anime', null)).toBe('Anime · Apollo')
  })

  it('trims whitespace rather than trusting it', () => {
    expect(pageTitle('  Anime  ')).toBe('Anime · Apollo')
    expect(pageTitle('   ')).toBe(APP_NAME)
  })

  it('keeps the app name when the subject is enormous', () => {
    // A title missing its suffix looks like a different app; one ending mid
    // word plainly says it was cut.
    const long = pageTitle('x'.repeat(400))
    expect(long.endsWith(`· ${APP_NAME}`)).toBe(true)
    expect(long.length).toBeLessThanOrEqual(120)
    expect(long).toContain('…')
  })

  it('leaves a title that only just fits alone', () => {
    const subject = 'y'.repeat(120 - APP_NAME.length - 3)
    expect(pageTitle(subject)).toBe(`${subject} · ${APP_NAME}`)
    expect(pageTitle(subject)).not.toContain('…')
  })
})
