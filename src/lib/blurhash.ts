import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

/**
 * BlurHash decoding.
 *
 * Jellyfin puts a hash beside every image it knows about, so a blurred preview
 * of the real artwork can be painted immediately — no extra request, no grey
 * rectangle while the image travels. Implemented here rather than pulled in as
 * a dependency: it is one small, fully specified algorithm.
 *
 * Reference: https://github.com/woltapp/blurhash/blob/master/Algorithm.md
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

function decode83(str: string): number {
  let value = 0
  for (const char of str) {
    const index = DIGITS.indexOf(char)
    if (index === -1) throw new Error(`Invalid BlurHash character: ${char}`)
    value = value * 83 + index
  }
  return value
}

const sRGBToLinear = (value: number) => {
  const v = value / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const linearToSRGB = (value: number) => {
  const v = Math.max(0, Math.min(1, value))
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255)
}

const signPow = (value: number, exp: number) => Math.sign(value) * Math.abs(value) ** exp

function decodeDC(value: number): [number, number, number] {
  return [sRGBToLinear(value >> 16), sRGBToLinear((value >> 8) & 255), sRGBToLinear(value & 255)]
}

function decodeAC(value: number, maxValue: number): [number, number, number] {
  const quant = (v: number) => signPow((v - 9) / 9, 2) * maxValue
  return [quant(Math.floor(value / (19 * 19))), quant(Math.floor(value / 19) % 19), quant(value % 19)]
}

export function isValidBlurhash(hash: string): boolean {
  if (!hash || hash.length < 6) return false
  const components = decode83(hash[0])
  const x = (components % 9) + 1
  const y = Math.floor(components / 9) + 1
  return hash.length === 4 + 2 * x * y
}

/** Decodes to raw RGBA at the given size. Keep the size small — it is a blur. */
export function decodeBlurhash(hash: string, width: number, height: number, punch = 1) {
  if (!isValidBlurhash(hash)) throw new Error('Invalid BlurHash')

  const components = decode83(hash[0])
  const numX = (components % 9) + 1
  const numY = Math.floor(components / 9) + 1
  const maxValue = (decode83(hash[1]) + 1) / 166

  const colors: [number, number, number][] = [decodeDC(decode83(hash.slice(2, 6)))]
  for (let i = 1; i < numX * numY; i++) {
    colors.push(decodeAC(decode83(hash.slice(4 + i * 2, 6 + i * 2)), maxValue * punch))
  }

  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let j = 0; j < numY; j++) {
        for (let i = 0; i < numX; i++) {
          const basis =
            Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height)
          const color = colors[i + j * numX]
          r += color[0] * basis
          g += color[1] * basis
          b += color[2] * basis
        }
      }
      const index = 4 * (x + y * width)
      pixels[index] = linearToSRGB(r)
      pixels[index + 1] = linearToSRGB(g)
      pixels[index + 2] = linearToSRGB(b)
      pixels[index + 3] = 255
    }
  }
  return pixels
}

// Decoding is cheap at this size, but the same artwork appears in many rows.
const cache = new Map<string, string>()
const CACHE_LIMIT = 300
const SIZE = 32

/** Decodes to a data URL suitable for `background-image`. Null if unusable. */
export function blurhashToDataUrl(hash: string): string | null {
  const cached = cache.get(hash)
  if (cached !== undefined) return cached || null
  if (typeof document === 'undefined') return null

  try {
    const pixels = decodeBlurhash(hash, SIZE, SIZE)
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(new ImageData(pixels, SIZE, SIZE), 0, 0)
    const url = canvas.toDataURL()
    if (cache.size > CACHE_LIMIT) cache.clear()
    cache.set(hash, url)
    return url
  } catch {
    // A malformed hash must never take a card down with it.
    cache.set(hash, '')
    return null
  }
}

/**
 * Finds the hash matching an image URL this client built.
 *
 * The builders already resolved which image and tag to request, and Jellyfin
 * keys its hashes by that same tag, so the tag in the URL is the join.
 */
export function blurhashFor(item: BaseItemDto, url: string | null): string | null {
  if (!url) return null
  const hashes = item.ImageBlurHashes as
    | Record<string, Record<string, string> | undefined>
    | undefined
  if (!hashes) return null

  let tag: string | null = null
  try {
    tag = new URL(url).searchParams.get('tag')
  } catch {
    return null
  }
  if (!tag) return null

  for (const byTag of Object.values(hashes)) {
    const hash = byTag?.[tag]
    if (hash) return hash
  }
  return null
}

/**
 * Style props that paint the blurred preview behind an image.
 *
 * Applied to the `<img>` itself rather than a wrapper, so nothing about the
 * layout changes: the background shows through until the real pixels arrive,
 * then the image covers it. Only for artwork drawn with `object-cover` —
 * a transparent logo would let the blur show through permanently.
 */
export function blurhashBackground(
  item: BaseItemDto,
  url: string | null,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } | undefined {
  const hash = blurhashFor(item, url)
  if (!hash) return undefined
  const dataUrl = blurhashToDataUrl(hash)
  if (!dataUrl) return undefined
  return {
    backgroundImage: `url("${dataUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  }
}
