/**
 * Which of libass's two WebAssembly builds a browser gets.
 *
 * JASSUB ships a SIMD build and a plain one and chooses between them with
 * `WebAssembly.validate` on a tiny module that uses a v128 instruction. None
 * of that is exported, and Apollo needs the same answer for one reason: to
 * warm the browser's cache with the file JASSUB is about to ask for, so the
 * two megabytes are already there when the worker starts rather than being
 * fetched while somebody waits for the first line of dialogue.
 *
 * Guessing wrong costs a wasted download and nothing else — JASSUB still
 * fetches whichever build it wants. `assStartup.test.ts` pins these bytes
 * against the copy in `node_modules`, so a jassub upgrade that changes the
 * probe fails the suite instead of quietly warming the wrong file.
 */

/**
 * A module whose only function returns a v128 — valid under the SIMD
 * proposal and rejected without it. Byte for byte JASSUB's own probe.
 */
export const SIMD_PROBE = new Uint8Array([
  // WASM magic number + version 1
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // Type section: 1 type, func () -> v128
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  // Function section: 1 function, type index 0
  0x03, 0x02, 0x01, 0x00,
  // Code section: 1 body, 0 locals
  0x0a, 0x2b, 0x01, 0x29, 0x00,
  // v128.const i32x4 0 0 0 0
  0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00,
  // v128.const i32x4 0 0 0 0
  0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00,
  // i8x16.swizzle, end
  0xfd, 0x80, 0x02, 0x0b,
])

/** What the engine itself says, with no user-agent sniffing anywhere. */
export function supportsSimd(
  validate: (bytes: Uint8Array<ArrayBuffer>) => boolean = (bytes) => WebAssembly.validate(bytes),
): boolean {
  try {
    return validate(SIMD_PROBE) === true
  } catch {
    // WebAssembly disabled by policy. libass cannot run here either way, and
    // the smaller file is the less wasteful thing to have guessed.
    return false
  }
}

export function pickWasmUrl(urls: { modern: string; legacy: string }, simd: boolean): string {
  return simd ? urls.modern : urls.legacy
}
