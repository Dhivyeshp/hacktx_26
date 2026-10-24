// Pretends to be the Pi: streams telemetry at 10 Hz and a tiny placeholder
// "frame" at 2 Hz, and logs any command addressed to it.
//   RELAY_URL=wss://<host>/ws RELAY_TOKEN=... npm run fake-pi
import { WebSocket } from 'ws'

const url = new URL(process.env.RELAY_URL ?? 'ws://localhost:8080/ws')
url.searchParams.set('role', 'pi')
url.searchParams.set('room', process.env.RELAY_ROOM ?? 'table')
if (process.env.RELAY_TOKEN) url.searchParams.set('token', process.env.RELAY_TOKEN)

const ws = new WebSocket(url)
let t = 0

ws.on('open', () => {
  console.log('connected to', url.origin)
  setInterval(() => {
    t += 0.1
    ws.send(
      JSON.stringify({
        type: 'telemetry',
        robot_id: 'bot-1',
        x: Math.cos(t / 4),
        y: Math.sin(t / 4),
        heading: (t * 20) % 360,
        speed: 0.2,
        battery_v: 7.6 - t * 0.001,
        state: 'idle',
        capsules_left: 6,
      }),
    )
  }, 100)
  // Smallest valid JPEG markers: enough to exercise the binary path.
  setInterval(() => ws.send(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), 500)
})
ws.on('message', (data, binary) => {
  if (!binary) console.log('<-', data.toString())
})
ws.on('close', (code) => {
  console.log('closed', code)
  process.exit(1)
})
