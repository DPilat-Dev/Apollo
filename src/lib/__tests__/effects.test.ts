import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') ? [full] : []
  })
}

/**
 * React treats whatever an effect returns as its cleanup function, and
 * production React only checks the value is not undefined before calling it —
 * it never checks that it is callable.
 *
 * So `useEffect(() => window.scrollTo(0, 0), [pathname])` is a live grenade:
 * it returns whatever scrollTo returns. On browsers where that is undefined
 * nothing happens, and on the ones where it is not, the next run of the effect
 * throws `is not a function` from the commit phase — which unmounts the whole
 * tree and leaves a black page. That reached production and only showed up on
 * mobile.
 *
 * An effect body must therefore be a block, or return a function directly.
 */
describe('effect bodies', () => {
  /** The effect body is safe when it is a block, or is itself a function. */
  const leaksAReturn = (code: string) => {
    const body = code.match(/useEffect\(\s*\(\s*\)\s*=>(.*)$/)?.[1]?.trimStart()
    if (body === undefined) return false
    return !(body.startsWith('{') || /^(\(\s*\)|\w+)\s*=>/.test(body) || body === '')
  }

  /** Strips comments line by line so prose about the bug is not read as code. */
  function codeLines(text: string) {
    let inBlock = false
    return text.split('\n').map((raw, i) => {
      let code = raw
      if (inBlock) {
        const close = code.indexOf('*/')
        if (close === -1) return { code: '', n: i + 1, raw }
        code = code.slice(close + 2)
        inBlock = false
      }
      code = code.replace(/\/\*.*?\*\//g, '')
      const open = code.indexOf('/*')
      if (open !== -1) {
        inBlock = true
        code = code.slice(0, open)
      }
      return { code: code.replace(/\/\/.*$/, ''), n: i + 1, raw }
    })
  }

  const offenders = sourceFiles(SRC).flatMap((file) =>
    codeLines(readFileSync(file, 'utf8'))
      .filter(({ code }) => leaksAReturn(code))
      .map(({ raw, n }) => `${path.relative(SRC, file)}:${n}  ${raw.trim()}`),
  )

  it('never leak a return value that React would call as cleanup', () => {
    expect(offenders).toEqual([])
  })
})
