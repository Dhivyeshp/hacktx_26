import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { createRelay } from '../src/server.ts'

const server = createRelay()
let base = ''

before(async () => {
  await new Promise<void>((r) => server.listen(0, r))
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`
})
after(() => server.close())

// Connects and queues every message so tests can await the next one of a given type.
async function connect(query: string) {
  const ws = new WebSocket(`${base}?${query}`)
  const queue: Array<{ binary: boolean; data: Buffer }> = []
  const waiters: Array<() => void> = []
  ws.on('message', (data, binary) => {
    queue.push({ binary, data: data as Buffer })
    waiters.splice(0).forEach((w) => w())
  })
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  async function next(pred: (m: { binary: boolean; data: Buffer }) => boolean, ms = 1000) {
    const deadline = Date.now() + ms
    while (true) {
      const i = queue.findIndex(pred)
      if (i >= 0) return queue.splice(i, 1)[0]
      if (Date.now() > deadline) throw new Error('timed out waiting for message')
      await new Promise<void>((r) => {
        waiters.push(r)
        setTimeout(r, 50)
      })
    }
  }
  const nextJson = async (type: string) =>
    JSON.parse((await next((m) => !m.binary && JSON.parse(m.data.toString()).type === type)).data.toString())
  return { ws, next, nextJson }
}

test('routes JSON between roles in the same room and stamps the sender', async () => {
  const pi = await connect('room=r1&role=pi')
  const vp = await connect('room=r1&role=visionpro')
  await pi.nextJson('welcome')
  pi.ws.send(JSON.stringify({ type: 'telemetry', battery_v: 7.4 }))
  const msg = await vp.nextJson('telemetry')
  assert.equal(msg.from, 'pi')
  assert.equal(msg.battery_v, 7.4)
  pi.ws.close()
  vp.ws.close()
})

test('`to` limits delivery to the named roles', async () => {
  const vp = await connect('room=r2&role=visionpro')
  const pi = await connect('room=r2&role=pi')
  const dash = await connect('room=r2&role=dashboard')
  vp.ws.send(JSON.stringify({ type: 'drive', to: 'pi', left: 0.5, right: 0.5 }))
  assert.equal((await pi.nextJson('drive')).left, 0.5)
  await assert.rejects(dash.nextJson('drive'))
  for (const c of [vp, pi, dash]) c.ws.close()
})

test('binary frames from the pi reach video subscribers only', async () => {
  const pi = await connect('room=r3&role=pi')
  const vp = await connect('room=r3&role=visionpro')
  const hub = await connect('room=r3&role=hub')
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  pi.ws.send(jpeg)
  assert.deepEqual((await vp.next((m) => m.binary)).data, jpeg)
  await assert.rejects(hub.next((m) => m.binary, 300))
  for (const c of [pi, vp, hub]) c.ws.close()
})

test('rooms are isolated', async () => {
  const a = await connect('room=ra&role=pi')
  const b = await connect('room=rb&role=visionpro')
  a.ws.send(JSON.stringify({ type: 'telemetry' }))
  await assert.rejects(b.nextJson('telemetry'))
  a.ws.close()
  b.ws.close()
})

test('rejects unknown roles', async () => {
  await assert.rejects(connect('room=r4&role=hacker'))
})
