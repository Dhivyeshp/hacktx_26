// Live program events for frontends: subscribes to the program's logs, keeps the
// last 200 parsed events, streams them to Server-Sent Events clients, and (when
// RELAY_URL and RELAY_TOKEN are set) forwards each one into the websocket relay
// as {type: "chain_event"} so the Vision Pro and dashboards see payouts live.
import type http from 'node:http'
import type { Connection, PublicKey } from '@solana/web3.js'
import { subscribeEvents, type ChainEvent } from './core.ts'

const KEEP = 200
const KEEPALIVE_MS = 25_000

export class EventHub {
  private recent: ChainEvent[] = []
  private clients = new Set<http.ServerResponse>()
  private relay: WebSocket | null = null
  private stopped = false
  private unsubscribe: (() => void) | null = null

  constructor(
    private connection: Connection,
    private programId: PublicKey,
  ) {}

  start() {
    this.unsubscribe = subscribeEvents(this.connection, (e) => this.publish(e), this.programId)
    this.connectRelay()
    setInterval(() => {
      for (const res of this.clients) res.write(': keepalive\n\n')
    }, KEEPALIVE_MS).unref()
    return this
  }

  stop() {
    this.stopped = true
    this.unsubscribe?.()
    this.relay?.close()
    for (const res of this.clients) res.end()
  }

  latest(limit = 50, name?: string) {
    const list = name ? this.recent.filter((e) => e.name === name) : this.recent
    return list.slice(-limit).reverse()
  }

  publish(e: ChainEvent) {
    this.recent.push(e)
    if (this.recent.length > KEEP) this.recent.splice(0, this.recent.length - KEEP)
    const frame = `event: ${e.name}\ndata: ${JSON.stringify(e)}\n\n`
    for (const res of this.clients) res.write(frame)
    if (this.relay?.readyState === WebSocket.OPEN) this.relay.send(JSON.stringify({ type: 'chain_event', ...e }))
  }

  /** GET /events: an SSE stream. `?replay=N` first sends the last N events. */
  sse(req: http.IncomingMessage, res: http.ServerResponse, replay = 0) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    for (const e of this.recent.slice(-replay)) res.write(`event: ${e.name}\ndata: ${JSON.stringify(e)}\n\n`)
    this.clients.add(res)
    req.on('close', () => this.clients.delete(res))
  }

  get relayConnected() {
    return this.relay?.readyState === WebSocket.OPEN
  }

  private connectRelay() {
    const base = process.env.RELAY_URL
    const token = process.env.RELAY_TOKEN
    if (!base || !token || this.stopped) return
    const url = new URL(base)
    url.searchParams.set('role', 'hub')
    url.searchParams.set('id', 'chain-service')
    url.searchParams.set('room', process.env.RELAY_ROOM ?? 'table')
    url.searchParams.set('token', token)
    const ws = new WebSocket(url)
    this.relay = ws
    ws.addEventListener('close', () => {
      if (this.relay === ws) this.relay = null
      setTimeout(() => this.connectRelay(), 5000)
    })
    ws.addEventListener('error', () => ws.close())
  }
}
