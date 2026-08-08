import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Stops one thrown render from taking the whole app with it.
 *
 * Without this a single bad assumption — an item missing a field, a null id —
 * white-screens everything, which is a far worse outcome than losing one
 * screen. Reset is keyed on the route so navigating away recovers.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack somewhere reachable — the overlay only shows the message.
    console.error('[apollo] render failed', error, info.componentStack)
  }

  componentDidUpdate(previous: { children: ReactNode; resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold">This screen hit a problem</h1>
        <p className="max-w-md text-sm text-white/55">{this.state.error.message}</p>
        <div className="flex gap-3">
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-white/85"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded border border-white/25 px-5 py-2 text-sm transition hover:border-white/50"
          >
            Go home
          </a>
        </div>
        <p className="text-xs text-white/30">The full stack is in the browser console.</p>
      </div>
    )
  }
}
