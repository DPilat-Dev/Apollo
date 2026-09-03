/// <reference types="vite/client" />

/**
 * package.json's `version`, substituted by Vite's `define` in vite.config.ts.
 *
 * Declared as possibly-absent rather than a plain string on purpose: the
 * substitution is textual, so any consumer Vite does not transform sees no
 * such identifier at all. Reading it through a `typeof` guard is what keeps
 * that case from becoming `Version="undefined"` on the wire.
 */
declare const __APOLLO_VERSION__: string | undefined
