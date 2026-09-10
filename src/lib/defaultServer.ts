/**
 * Where the sign-in screen should point before anybody types anything.
 *
 * Three answers, in order of how much they can be trusted to be right for the
 * browser asking:
 *
 *   1. What this install was told at runtime. The server reads it from its own
 *      environment and hands it over, so it is right for every browser that
 *      reaches this deployment, including one that has never been here.
 *   2. What was compiled in. Correct for a build made by the person deploying
 *      it, which is how this used to work everywhere and still is for anyone
 *      building their own.
 *   3. Nothing, and the field is left for the viewer.
 *
 * The first exists because the second stopped being enough. `VITE_JELLYFIN_SERVER`
 * is substituted into the bundle when it is built, and once releases began
 * shipping a prebuilt client that build came from CI, which cannot know anyone's
 * address. Installs kept working only because browsers remembered the address
 * from before — until a private window, or a new phone, arrived with no memory
 * and nothing to fall back on.
 */

/** Compiled in, when someone built this themselves. */
export const BUILT_IN_SERVER: string = import.meta.env.VITE_JELLYFIN_SERVER ?? ''

/** Only an http(s) origin is worth putting in the field. */
export function usableServer(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? value.trim() : ''
  } catch {
    return ''
  }
}

/**
 * The address to start from.
 *
 * `remembered` wins over both: somebody who has signed in here before has
 * already answered this question, possibly with a different address than the
 * one this install suggests, and being moved off it would be worse than being
 * asked.
 */
export function defaultServer(input: {
  remembered?: string | null
  fromRuntime?: string | null
  builtIn?: string
}): string {
  const remembered = usableServer(input.remembered)
  if (remembered) return remembered
  const runtime = usableServer(input.fromRuntime)
  if (runtime) return runtime
  return usableServer(input.builtIn ?? BUILT_IN_SERVER)
}
