import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * `useApi()` throws when there is no session. It exists for screens behind the
 * auth gate, where an api is guaranteed, and saying so with an exception is
 * better than handing every one of them a nullable value to check.
 *
 * The components *above* that gate are a different matter. `App` renders the
 * sign-in screen, so it runs with no session on every new browser and after
 * every sign-out — and a hook that throws there takes the sign-in screen down
 * with it, which is a dead end rather than a bad screen. That shipped, and it
 * shipped because nothing in a suite that never mounts a component could
 * notice.
 *
 * So: read the files, and require the ones above the gate to take `api` from
 * the context, where it is honestly nullable.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Rendered before a session exists, or able to be. */
const ABOVE_THE_GATE = ['App.tsx', 'routes/Login.tsx', 'components/ErrorBoundary.tsx']

/** Block and line comments removed, so prose about the rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('components above the auth gate', () => {
  for (const file of ABOVE_THE_GATE) {
    it(`${file} does not call useApi()`, () => {
      const source = readFileSync(path.join(SRC, file), 'utf8')
      // Code, not prose. The comment explaining why this rule exists names the
      // hook, and a check that cannot tell those apart fails on its own
      // documentation — which it did, the first time.
      expect(withoutComments(source)).not.toMatch(/\buseApi\s*\(/)
    })
  }

  it('useApi still throws, because that is what makes it useful below the gate', () => {
    const source = readFileSync(path.join(SRC, 'lib/auth.tsx'), 'utf8')
    expect(source).toMatch(/useApi used outside an authenticated route/)
  })
})
