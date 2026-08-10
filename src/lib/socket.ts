import { deviceId, type Session } from './api'

/**
 * Jellyfin's WebSocket.
 *
 * SyncPlay is push-driven: the server decides when everyone plays, and tells
 * them. Polling cannot express that, so this is the transport it needs.
 *
 * Headers are not settable on a browser WebSocket, so the token goes in the
 * query string — the same way the server expects for `<video>` sources.
 */

export interface SocketMessage {
  MessageType: string
  MessageId?: string
  Data?: unknown
}

type Listener = (message: SocketMessage) => void

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30_000

export function socketUrl(session: Pick<Session, 'server' | 'token'>): string {
  const url = new URL('socket', session.server.replace(/\/?$/, '/'))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('api_key', session.token)
  url.searchParams.set('deviceId', deviceId())
  return url.toString()
}

/**
 * Backoff for reconnection: doubling, capped.
 *
 * Uncapped doubling would leave a client that dropped out overnight waiting
 * hours to come back; a fixed short delay would hammer a server that is down.
 */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_MIN_MS * 2 ** Math.max(0, attempt), RECONNECT_MAX_MS)
}

export class JellyfinSocket {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private keepAlive: number | undefined
  private reconnect: number | undefined
  private attempt = 0
  private closed = false

  private session: Pick<Session, 'server' | 'token'>

  constructor(session: Pick<Session, 'server' | 'token'>) {
    this.session = session
  }

  connect() {
    if (this.closed || this.ws) return
    const ws = new WebSocket(socketUrl(this.session))
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      // Without this the server drops idle sockets.
      this.send('KeepAlive')
    }

    ws.onmessage = (event) => {
      let message: SocketMessage
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      // The server asks for a keepalive interval; honour it rather than guess.
      if (message.MessageType === 'ForceKeepAlive') {
        const seconds = Number(message.Data) || 30
        this.startKeepAlive(seconds)
        return
      }
      if (message.MessageType === 'KeepAlive') return
      for (const listener of this.listeners) listener(message)
    }

    ws.onclose = () => {
      this.ws = null
      this.stopKeepAlive()
      if (this.closed) return
      const delay = reconnectDelayMs(this.attempt++)
      this.reconnect = window.setTimeout(() => this.connect(), delay)
    }

    // An error is always followed by close, which already handles retrying.
    ws.onerror = () => {}
  }

  private startKeepAlive(seconds: number) {
    this.stopKeepAlive()
    // Half the interval the server asked for, so a single missed tick is
    // not enough to be considered gone.
    this.keepAlive = window.setInterval(() => this.send('KeepAlive'), (seconds * 1000) / 2)
  }

  private stopKeepAlive() {
    if (this.keepAlive !== undefined) window.clearInterval(this.keepAlive)
    this.keepAlive = undefined
  }

  send(messageType: string, data?: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ MessageType: messageType, Data: data ?? '' }))
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  close() {
    this.closed = true
    this.stopKeepAlive()
    if (this.reconnect !== undefined) window.clearTimeout(this.reconnect)
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
  }
}
