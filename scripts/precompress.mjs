#!/usr/bin/env node
/**
 * Write `.br` and `.gz` beside every compressible file in a build.
 *
 *   node scripts/precompress.mjs [dist]
 *
 * Part of `npm run build`, so a release artifact cannot be cut without them —
 * which is the whole point of doing it here rather than in a proxy config
 * somebody has to remember. The server picks a variant per request; if one is
 * missing it sends the original, so a failure here degrades to what Apollo
 * did for its first nineteen releases rather than to a broken site.
 *
 * Brotli at quality 11, because this runs once per build and the files are
 * then served unchanged until the next one. It is roughly thirty times slower
 * than quality 9 and worth it on the two libass modules: 668 kB against
 * 770 kB, on a file every ASS subtitle in a cold browser waits for.
 *
 * A variant is kept only if it is actually smaller than the original. A file
 * that does not compress — anything already compressed that slipped past the
 * extension list — would otherwise cost a browser bytes to save none.
 */
import { existsSync } from 'node:fs'
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { isCompressible, VARIANT_EXTENSIONS } from '../server/static.mjs'

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

const DIST = path.resolve(process.argv[2] ?? 'dist')

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`

async function main() {
  if (!existsSync(DIST)) {
    console.error(`precompress: no such directory: ${DIST}`)
    process.exit(1)
  }

  const all = await walk(DIST)
  // A rebuild into an existing dist would otherwise leave variants of files
  // that are no longer there. Vite empties the directory, but `--outDir` and
  // a hand-run of this script against a kept build both do not.
  const stale = all.filter((f) => VARIANT_EXTENSIONS.includes(path.extname(f)))
  await Promise.all(stale.map((f) => rm(f, { force: true })))

  const originals = all.filter((f) => !VARIANT_EXTENSIONS.includes(path.extname(f)))

  let before = 0
  let brAfter = 0
  let count = 0

  for (const file of originals) {
    const { size } = await stat(file)
    if (!isCompressible(file, size)) continue

    const source = await readFile(file)
    const [br, gzipped] = await Promise.all([
      brotli(source, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      }),
      gz(source, { level: 9 }),
    ])

    // Both or neither, per file: a browser that takes only gzip must not be
    // left on the original while a brotli one is served 4× less.
    if (br.length >= source.length && gzipped.length >= source.length) continue

    await Promise.all([writeFile(`${file}.br`, br), writeFile(`${file}.gz`, gzipped)])

    before += source.length
    brAfter += br.length
    count++
  }

  const rel = path.relative(process.cwd(), DIST) || DIST
  if (count === 0) {
    console.log(`precompress: nothing to compress in ${rel}`)
    return
  }
  console.log(
    `precompress: ${count} files in ${rel} — ${kb(before)} → ${kb(brAfter)} brotli ` +
      `(${(before / brAfter).toFixed(1)}× smaller)`,
  )
}

await main()
