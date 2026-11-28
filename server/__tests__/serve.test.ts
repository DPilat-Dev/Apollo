import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import http from 'node:http'

/**
 * The compression fix, end to end, against the real server process.
 *
 * The unit tests in `static.test.ts` cover which variant should be chosen.
 * What they cannot see is whether the server sends it, and every way of
 * getting this wrong is silent in exactly the way a browser does not report:
 *
 * - No `Content-Encoding`, and the browser hands 144 kB of brotli to the
 *   JavaScript parser.
 * - No `Vary: Accept-Encoding`, and the proxy every install sits behind
 *   caches one variant and serves it to clients that cannot read it. Apollo's
 *   own deployment is openresty in front of this server.
 * - `Content-Type: application/brotli`, and the browser downloads the bundle
 *   instead of running it.
 * - A `Content-Length` left over from the original file, and the response is
 *   truncated or hangs.
 *
 * So this boots `server/index.mjs` over a throwaway dist and reads the
 * headers and the bytes.
 */
/**
 * Raw HTTP, because `fetch` is not a witness here.
 *
 * undici decodes a compressed body transparently and strips nothing, so a
 * test built on `fetch` reads the original bytes back whatever the server
 * sent, and would pass just as happily if the server had sent brotli with no
 * `Content-Encoding` at all — the exact bug this file exists to catch.
 */
function raw(
  urlPath: string,
  acceptEncoding?: string,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${BASE}${urlPath}`,
      { headers: acceptEncoding === undefined ? {} : { 'Accept-Encoding': acceptEncoding } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    req.on('error', reject)
  })
}

const ROOT = path.resolve(import.meta.dirname, '../..')
const PORT = 41000 + Math.floor(Math.random() * 3000)
const BASE = `http://127.0.0.1:${PORT}`

// Long enough to be worth compressing and repetitive enough to compress well.
const SCRIPT = `export const greeting = ${JSON.stringify('hello '.repeat(400))}\n`
const PAGE = `<!doctype html><html><head><title>Apollo</title></head><body>${'x'.repeat(900)}</body></html>`

let dist: string
let server: ChildProcess

beforeAll(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'apollo-serve-'))
  mkdirSync(path.join(dist, 'assets'))
  writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), SCRIPT)
  writeFileSync(path.join(dist, 'index.html'), PAGE)
  // A file the build must leave alone: already compressed, and under no
  // circumstances should a .woff2.br appear beside it.
  writeFileSync(path.join(dist, 'assets', 'font-abc123.woff2'), Buffer.alloc(2000, 7))

  // The real build step, not a stand-in for it.
  execFileSync(process.execPath, ['scripts/precompress.mjs', dist], { cwd: ROOT })

  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), APOLLO_DIST: dist },
    stdio: 'ignore',
  })

  // Poll rather than sleep: a fixed wait is either flaky or slow.
  for (let i = 0; i < 100; i++) {
    try {
      await raw('/index.html')
      return
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  throw new Error('the server did not start')
}, 30_000)

afterAll(() => {
  server?.kill()
})

describe('the server, serving a built app', () => {
  it('sends brotli to a browser that takes it, and the right bytes', async () => {
    const res = await raw('/assets/app-abc123.js', 'gzip, deflate, br')
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('br')
    // The type of what is inside, not of the wrapper.
    expect(res.headers['content-type']).toMatch(/^text\/javascript/)
    expect(res.headers.vary).toMatch(/accept-encoding/i)

    expect(brotliDecompressSync(res.body).toString('utf8')).toBe(SCRIPT)
    // The saving this whole change exists for.
    expect(res.body.length).toBeLessThan(SCRIPT.length / 2)
  })

  it('sends gzip to a client that cannot take brotli', async () => {
    const res = await raw('/assets/app-abc123.js', 'gzip')
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(res.body).toString('utf8')).toBe(SCRIPT)
  })

  it('sends the original, unflagged, to a client that wants neither', async () => {
    for (const header of ['identity', '', undefined]) {
      const res = await raw('/assets/app-abc123.js', header)
      expect(res.headers['content-encoding'], `for ${JSON.stringify(header)}`).toBeUndefined()
      expect(res.body.toString('utf8')).toBe(SCRIPT)
    }
  })

  it('declares a Content-Length matching the bytes it actually sent', async () => {
    for (const encoding of ['br', 'gzip', 'identity']) {
      const res = await raw('/assets/app-abc123.js', encoding)
      expect(Number(res.headers['content-length']), `Content-Length for ${encoding}`).toBe(
        res.body.length,
      )
    }
  })

  it('compresses the page too, and still never caches it', async () => {
    const res = await raw('/', 'br')
    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers['content-type']).toMatch(/^text\/html/)
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('serves a route through the page, compressed', async () => {
    // The SPA fallback has to pick a variant the same way a direct hit does.
    const res = await raw('/item/abc123', 'br')
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('br')
    expect(brotliDecompressSync(res.body).toString('utf8')).toBe(PAGE)
  })

  it('keeps hashed assets immutable and still 404s a missing one', async () => {
    const asset = await raw('/assets/app-abc123.js', 'br')
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')

    // Regression that predates this change: a missing chunk must not be
    // answered with the page.
    expect((await raw('/assets/app-OLDHASH.js', 'br')).status).toBe(404)
  })

  it('leaves an already-compressed font alone', async () => {
    const res = await raw('/assets/font-abc123.woff2', 'gzip, br')
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['content-type']).toBe('font/woff2')
    expect(res.body.length).toBe(2000)
  })
})

/*
  The one failure mode none of the above can see: a release artifact built
  without the variants. The server falls back to the original file by design,
  so a build that skipped precompression serves a perfectly working site that
  is silently back to sending 697 kB — no error, no warning, and nothing to
  notice until someone measures it again months later.

  The release workflow tars whatever `npm run build` produced, so the build
  script is the only place this can be guaranteed.
*/
describe('the build', () => {
  it('precompresses, so a release cannot ship without the variants', async () => {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts.build).toMatch(/precompress/)
  })

  it('wrote both variants beside a compressible file, and neither beside a font', async () => {
    const { existsSync } = await import('node:fs')
    for (const ext of ['.br', '.gz']) {
      expect(existsSync(path.join(dist, 'assets', `app-abc123.js${ext}`)), `app.js${ext}`).toBe(
        true,
      )
      expect(
        existsSync(path.join(dist, 'assets', `font-abc123.woff2${ext}`)),
        `font.woff2${ext}`,
      ).toBe(false)
    }
  })
})
