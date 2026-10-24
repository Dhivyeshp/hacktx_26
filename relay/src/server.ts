// Centerpiece relay: one websocket fabric for the Pi (robot + USB webcam), the
// Vision Pro Game Master app, the game hub, and dashboards.
//
//   wss://<host>/ws?room=table&role=pi&token=...
//
// Text frames are JSON envelopes ({ type, to?, ...payload }) routed to everyone
// else in the room, or only to the roles listed in `to`. Binary frames from the
// Pi are JPEG camera frames, fanned out to clients that asked for video.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket, type RawData } from 'ws'

const PORT = Number(process.env.PORT ?? 8080)
const TOKEN = process.env.RELAY_TOKEN ?? ''
// Skip video frames for a client whose socket is this far behind; JSON is never dropped.
const MAX_BUFFERED_BYTES = Number(process.env.MAX_BUFFERED_BYTES ?? 1_500_000)
const HEARTBEAT_MS = 15_000

export const ROLES = ['pi', 'visionpro', 'hub', 'ai', 'dashboard'] as const
export type Role = (typeof ROLES)[number]
const VIDEO_BY_DEFAULT: ReadonlySet<Role> = new Set(['visionpro', 'dashboard'])

interface Client {
  id: string
  ws: WebSocket
  room: string
  role: Role
  video: boolean
  alive: boolean
}

const rooms = new Map<string, Set<Client>>()
const stats = { textIn: 0, framesIn: 0, framesDropped: 0 }

function peersOf(room: string) {
  return [...(rooms.get(room) ?? [])].map((c) => ({ id: c.id, role: c.role }))
}

function sendJson(c: Client, msg: object) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg))
}

function broadcastPresence(room: string) {
  const msg = { type: 'presence', room, peers: peersOf(room), ts: Date.now() }
  for (const c of rooms.get(room) ?? []) sendJson(c, msg)
}

function onText(from: Client, raw: string) {
  stats.textIn++
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw)
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') throw new Error()
  } catch {
    return sendJson(from, { type: 'error', error: 'expected JSON object with a string "type"' })
  }

  if (msg.type === 'ping') return sendJson(from, { type: 'pong', t: msg.t, serverTs: Date.now() })

  const to = msg.to === undefined ? null : new Set([msg.to].flat() as string[])
  const out = JSON.stringify({ ...msg, from: from.role, fromId: from.id, ts: msg.ts ?? Date.now() })
  for (const c of rooms.get(from.room) ?? []) {
    if (c === from || c.ws.readyState !== WebSocket.OPEN) continue
    if (to && !to.has(c.role) && !to.has(c.id)) continue
    c.ws.send(out)
  }
}

function onBinary(from: Client, data: Buffer) {
  if (from.role !== 'pi') return sendJson(from, { type: 'error', error: 'only the pi may send binary frames' })
  stats.framesIn++
  for (const c of rooms.get(from.room) ?? []) {
    if (c === from || !c.video || c.ws.readyState !== WebSocket.OPEN) continue
    if (c.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      stats.framesDropped++
      continue
    }
    c.ws.send(data, { binary: true })
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

export function createRelay() {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/') {
      const body = {
        ok: true,
        rooms: Object.fromEntries([...rooms].map(([name, set]) => [name, [...set].map((c) => c.role)])),
        stats,
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(body))
    }
    res.writeHead(404).end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://relay')
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    const token = url.searchParams.get('token') ?? bearer ?? ''
    const role = url.searchParams.get('role') as Role | null
    const reject = (code: number, reason: string) => {
      socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`)
      socket.destroy()
    }
    if (url.pathname !== '/ws') return reject(404, 'Not Found')
    if (TOKEN && token !== TOKEN) return reject(401, 'Unauthorized')
    if (!role || !ROLES.includes(role)) return reject(400, 'Bad Request')

    wss.handleUpgrade(req, socket, head, (ws) => {
      const videoParam = url.searchParams.get('video')
      const client: Client = {
        id: url.searchParams.get('id') || `${role}-${randomUUID().slice(0, 6)}`,
        ws,
        room: url.searchParams.get('room') || 'table',
        role,
        video: videoParam === null ? VIDEO_BY_DEFAULT.has(role) : videoParam === '1',
        alive: true,
      }
      if (!rooms.has(client.room)) rooms.set(client.room, new Set())
      rooms.get(client.room)!.add(client)
      sendJson(client, { type: 'welcome', id: client.id, room: client.room, role, peers: peersOf(client.room) })
      broadcastPresence(client.room)

      ws.on('pong', () => (client.alive = true))
      ws.on('message', (data, isBinary) => {
        if (isBinary) onBinary(client, toBuffer(data))
        else onText(client, toBuffer(data).toString('utf8'))
      })
      ws.on('close', () => {
        const set = rooms.get(client.room)
        set?.delete(client)
        if (set?.size === 0) rooms.delete(client.room)
        else broadcastPresence(client.room)
      })
      ws.on('error', () => ws.terminate())
    })
  })

  // Pings keep proxies (Render, Wi-Fi NAT) from closing idle sockets and reap dead clients.
  const heartbeat = setInterval(() => {
    for (const set of rooms.values())
      for (const c of set) {
        if (!c.alive) {
          c.ws.terminate()
          continue
        }
        c.alive = false
        c.ws.ping()
      }
  }, HEARTBEAT_MS)
  server.on('close', () => clearInterval(heartbeat))

  return server
}

export function startRelay(port = PORT) {
  return createRelay().listen(port, () => {
    console.log(`relay listening on :${port}${TOKEN ? ' (token required)' : ' (no token set)'}`)
  })
}
