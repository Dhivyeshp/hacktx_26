// Chain service: a small HTTP API over ChainClient so any part of the system
// (Python hub, Pi, web app) can use the program without Solana libraries, the
// metadata host that every on-chain URI points at, and a live event stream.
// Full route list: GET /openapi.json (and solana/FRONTEND.md).
//
// Public:   /status /leaderboard /players/:w[/keepsakes|/receipts] /shop /shop/pending
//           /sessions/:id /rounds/:id/:n /achievements /events (SSE) /events/recent
//           /idl.json /openapi.json /meta/* /img/*
// Bearer $CHAIN_API_TOKEN:
//           POST /players /rounds/settle /keepsakes /kudos /shop/items /shop/items/:id
//                /shop/redeem /receipts/:address/fulfill /sessions /sessions/:id/bonus
//                /achievements/grant
import http from 'node:http'
import { PublicKey } from '@solana/web3.js'
import { EventHub } from './events.ts'
import { ACHIEVEMENTS, ChainClient, achievementByKey, decodeAchievements, idl, type LeaderboardSort } from './index.ts'
import { openApi } from './openapi.ts'

const PORT = Number(process.env.PORT ?? 8787)
const API_TOKEN = process.env.CHAIN_API_TOKEN ?? ''

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': type === 'application/json' ? 'no-store' : 'public, max-age=30',
  })
  res.end(typeof body === 'string' ? body : JSON.stringify(body, null, 2))
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new HttpError(400, 'body must be JSON')
  }
}

function requireAuth(req: http.IncomingMessage) {
  if (!API_TOKEN) return
  if (req.headers.authorization !== `Bearer ${API_TOKEN}`) throw new HttpError(401, 'unauthorized')
}

function wallet(value: unknown): PublicKey {
  try {
    return new PublicKey(String(value))
  } catch {
    throw new HttpError(400, `invalid wallet: ${value}`)
  }
}

function int(value: unknown, name: string, min = 0): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${name} must be an integer >= ${min}`)
  return n
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

function coinSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs><radialGradient id="g" cx="40%" cy="35%"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#d79a1e"/></radialGradient></defs>
  <circle cx="128" cy="128" r="120" fill="url(#g)" stroke="#8a5a00" stroke-width="8"/>
  <circle cx="128" cy="128" r="92" fill="none" stroke="#8a5a00" stroke-width="4" stroke-dasharray="6 8"/>
  <text x="128" y="148" text-anchor="middle" font-family="Helvetica, Arial" font-weight="800" font-size="56" fill="#5c3b00">TABLE</text>
</svg>`
}

function badgeSvg(p: { wallet: string; level: number; xp: number; connections: number; kudos: number; emojis: string }) {
  const hue = (p.level * 47) % 360
  const short = `${p.wallet.slice(0, 4)}…${p.wallet.slice(-4)}`
  const stat = (x: number, value: number, label: string) =>
    `<text x="${x}" y="300" text-anchor="middle" font-family="Helvetica, Arial" font-weight="700" font-size="28" fill="#fff">${value}</text>
  <text x="${x}" y="322" text-anchor="middle" font-family="Helvetica, Arial" font-size="12" fill="#fff" opacity=".7">${label}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 420">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,12%)"/></linearGradient></defs>
  <rect width="320" height="420" rx="28" fill="url(#bg)"/>
  <text x="160" y="52" text-anchor="middle" font-family="Helvetica, Arial" font-size="18" letter-spacing="4" fill="#fff" opacity=".75">CENTERPIECE</text>
  <circle cx="160" cy="165" r="82" fill="none" stroke="hsl(${hue},90%,65%)" stroke-width="10"/>
  <text x="160" y="155" text-anchor="middle" font-family="Helvetica, Arial" font-size="18" fill="#fff" opacity=".8">LEVEL</text>
  <text x="160" y="208" text-anchor="middle" font-family="Helvetica, Arial" font-weight="800" font-size="68" fill="#fff">${p.level}</text>
  ${stat(60, p.xp, 'XP')}
  ${stat(160, p.connections, 'CONNECTIONS')}
  ${stat(260, p.kudos, 'KUDOS')}
  <text x="160" y="362" text-anchor="middle" font-size="24">${esc(p.emojis)}</text>
  <text x="160" y="400" text-anchor="middle" font-family="Menlo, monospace" font-size="13" fill="#fff" opacity=".55">${esc(short)}</text>
</svg>`
}

export function createService(chain: ChainClient, events?: EventHub) {
  const base = chain.metadataBaseUrl
  const withExplorer = (signature: string) => ({ signature, explorer: chain.explorer(signature) })

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://chain')
    const parts = url.pathname.split('/').filter(Boolean)
    const method = req.method ?? 'GET'
    const q = url.searchParams

    if (method === 'OPTIONS') return send(res, 204, '')
    // Liveness only: Render polls this every few seconds, so it must not touch the RPC.
    if (url.pathname === '/healthz') return send(res, 200, { ok: true })
    if (url.pathname === '/status' || url.pathname === '/') {
      const info = {
        cluster: chain.cluster,
        rpc: new URL(chain.connection.rpcEndpoint).host,
        programId: chain.programId.toBase58(),
        admin: chain.admin.publicKey.toBase58(),
        coinMint: chain.pda.coinMint.toBase58(),
        relayConnected: events?.relayConnected ?? false,
      }
      try {
        const config = await chain.getConfig()
        return send(res, 200, {
          ok: true,
          ...info,
          initialized: !!config,
          players: config ? Number(config.playerCount.toString()) : 0,
          keepsakes: config ? Number(config.keepsakeCount.toString()) : 0,
          items: config?.itemCount ?? 0,
          maxKudos: config ? Number(config.maxKudos.toString()) : 0,
        })
      } catch (err) {
        return send(res, 502, { ok: false, ...info, rpcError: (err as Error).message })
      }
    }

    // ----- docs -----
    if (method === 'GET' && url.pathname === '/idl.json') return send(res, 200, idl)
    if (method === 'GET' && url.pathname === '/openapi.json') return send(res, 200, openApi(base))

    // ----- live events -----
    if (method === 'GET' && url.pathname === '/events') {
      if (!events) throw new HttpError(503, 'event stream disabled')
      return events.sse(req, res, Math.min(200, Number(q.get('replay') ?? 0) || 0))
    }
    if (method === 'GET' && url.pathname === '/events/recent')
      return send(res, 200, events?.latest(Number(q.get('limit') ?? 50), q.get('name') ?? undefined) ?? [])

    // ----- metadata -----
    if (method === 'GET' && url.pathname === '/meta/coin.json')
      return send(res, 200, {
        name: 'Centerpiece Coin',
        symbol: 'TABLE',
        description: 'Earned at Centerpiece game nights by talking with people. Devnet only; no cash value.',
        image: `${base}/img/coin.svg`,
      })
    if (method === 'GET' && url.pathname === '/img/coin.svg') return send(res, 200, coinSvg(), 'image/svg+xml')

    if (method === 'GET' && parts[0] === 'meta' && parts[1] === 'badge' && parts[2]?.endsWith('.json')) {
      const w = wallet(parts[2].replace(/\.json$/, ''))
      const p = await chain.profile(w)
      if (!p) throw new HttpError(404, 'player not registered')
      return send(res, 200, {
        name: `Centerpiece Player · Level ${p.level}`,
        symbol: 'CPPLAYER',
        description: 'Soulbound player badge. Levels up as you connect with people at Centerpiece game nights.',
        image: `${base}/img/badge/${w.toBase58()}.svg?l=${p.level}&x=${p.xp}&a=${p.achievementMask}`,
        attributes: [
          { trait_type: 'Level', value: p.level },
          { trait_type: 'XP', value: p.xp },
          { trait_type: 'Connections', value: p.connections },
          { trait_type: 'Kudos received', value: p.kudosReceived },
          { trait_type: 'Rounds played', value: p.roundsPlayed },
          ...decodeAchievements(p.achievementMask).map((a) => ({ trait_type: 'Achievement', value: a.title })),
        ],
      })
    }
    if (method === 'GET' && parts[0] === 'img' && parts[1] === 'badge' && parts[2]?.endsWith('.svg')) {
      const w = wallet(parts[2].replace(/\.svg$/, ''))
      const p = await chain.profile(w)
      if (!p) throw new HttpError(404, 'player not registered')
      const emojis = decodeAchievements(p.achievementMask).map((a) => a.emoji).join(' ')
      return send(
        res,
        200,
        badgeSvg({ wallet: p.wallet, level: p.level, xp: p.xp, connections: p.connections, kudos: p.kudosReceived, emojis }),
        'image/svg+xml',
      )
    }

    if (method === 'GET' && parts[0] === 'meta' && parts[1] === 'keepsake' && parts[2]?.endsWith('.json')) {
      const mint = wallet(parts[2].replace(/\.json$/, ''))
      const meta = await chain.tokenMetadata(mint)
      if (!meta) throw new HttpError(404, 'keepsake not found')
      const { image, ...rest } = meta.fields
      return send(res, 200, {
        name: meta.name,
        symbol: meta.symbol,
        description: `A keepsake from a Centerpiece game night: ${rest.challenge ?? 'challenge'}, round ${rest.round ?? '?'}.`,
        image,
        attributes: Object.entries(rest).map(([trait_type, value]) => ({ trait_type, value })),
      })
    }

    // ----- reads -----
    if (method === 'GET' && url.pathname === '/leaderboard') {
      const by = (q.get('by') ?? 'xp') as LeaderboardSort
      if (!['xp', 'coins', 'kudos', 'connections'].includes(by)) throw new HttpError(400, 'by must be xp|coins|kudos|connections')
      return send(res, 200, await chain.leaderboard(by, Math.min(100, Number(q.get('limit') ?? 20) || 20)))
    }
    if (method === 'GET' && url.pathname === '/achievements') return send(res, 200, ACHIEVEMENTS)
    if (method === 'GET' && url.pathname === '/shop') return send(res, 200, await chain.items())
    if (method === 'GET' && url.pathname === '/shop/pending') return send(res, 200, await chain.pendingReceipts())
    if (method === 'GET' && parts[0] === 'players' && parts[1] && parts[2] === 'keepsakes')
      return send(res, 200, await chain.keepsakes(wallet(parts[1])))
    if (method === 'GET' && parts[0] === 'players' && parts[1] && parts[2] === 'receipts')
      return send(res, 200, await chain.receipts(wallet(parts[1])))
    if (method === 'GET' && parts[0] === 'players' && parts[1] && parts.length === 2) {
      const p = await chain.profile(wallet(parts[1]))
      return p
        ? send(res, 200, { ...p, achievementDetails: decodeAchievements(p.achievementMask) })
        : send(res, 404, { error: 'player not registered' })
    }
    if (method === 'GET' && parts[0] === 'sessions' && parts[1] && parts.length === 2) {
      const s = await chain.session(parts[1])
      return s ? send(res, 200, s) : send(res, 404, { error: 'session has no table goal' })
    }
    if (method === 'GET' && parts[0] === 'rounds' && parts.length === 3) {
      const r = await chain.getRound(parts[1], Number(parts[2]))
      if (!r) return send(res, 404, { error: 'round not attested' })
      return send(res, 200, {
        round: chain.pda.round(parts[1], Number(parts[2])).toBase58(),
        eventsHash: Buffer.from(r.eventsHash).toString('hex'),
        playerCount: r.playerCount,
        awardedCount: r.awardedCount,
        totalAwarded: Number(r.totalAwarded.toString()),
        attestedAt: new Date(Number(r.attestedAt.toString()) * 1000).toISOString(),
      })
    }

    // ----- writes -----
    if (method !== 'POST') throw new HttpError(404, 'not found')
    requireAuth(req)
    const b = await readJson(req)

    if (url.pathname === '/players') {
      const custodial = b.wallet ? null : chain.createCustodialWallet()
      const w = custodial ? custodial.publicKey : wallet(b.wallet)
      const existing = await chain.getPlayer(w)
      const result = existing ? null : await chain.registerPlayer(w)
      return send(res, existing ? 200 : 201, {
        wallet: w.toBase58(),
        // Devnet-only custodial key; the caller stores it so the player can claim later.
        secretKey: custodial ? [...custodial.secretKey] : undefined,
        badgeMint: chain.pda.badge(w).toBase58(),
        signature: result?.signature ?? null,
        explorer: result ? chain.explorer(result.signature) : chain.explorer(w.toBase58(), 'address'),
        alreadyRegistered: !!existing,
      })
    }
    if (url.pathname === '/rounds/settle') {
      if (!b.sessionId || !Number.isInteger(b.roundNo) || !b.eventsHash || !Array.isArray(b.awards))
        throw new HttpError(400, 'need sessionId, roundNo, eventsHash (hex sha256), awards[]')
      const result = await chain.settleRound({
        sessionId: String(b.sessionId),
        roundNo: b.roundNo,
        eventsHash: String(b.eventsHash),
        awards: b.awards.map((a: any) => ({
          wallet: wallet(a.wallet),
          points: Math.max(0, Math.floor(Number(a.points) || 0)),
          connections: Math.max(0, Math.floor(Number(a.connections) || 0)),
        })),
      })
      return send(res, 200, {
        ...result,
        attestExplorer: result.attestSignature ? chain.explorer(result.attestSignature) : null,
        awards: result.awards.map((a) => ({ ...a, explorer: a.signature ? chain.explorer(a.signature) : null })),
      })
    }
    if (url.pathname === '/keepsakes') {
      for (const f of ['sessionId', 'wallet', 'name', 'image', 'challenge'])
        if (!b[f]) throw new HttpError(400, `missing ${f}`)
      const { signature, mint } = await chain.mintKeepsake({
        sessionId: String(b.sessionId),
        roundNo: Number(b.roundNo),
        wallet: wallet(b.wallet),
        name: String(b.name),
        image: String(b.image),
        challenge: String(b.challenge),
      })
      return send(res, 201, {
        mint: mint.toBase58(),
        signature,
        explorer: chain.explorer(mint.toBase58(), 'address'),
        metadata: `${base}/meta/keepsake/${mint.toBase58()}.json`,
      })
    }
    if (url.pathname === '/kudos') {
      const { signature } = await chain.giveKudos(wallet(b.from), wallet(b.to), int(b.amount, 'amount', 1))
      return send(res, 200, { ...withExplorer(signature), to: await chain.profile(wallet(b.to)) })
    }
    if (url.pathname === '/shop/items') {
      if (!b.name) throw new HttpError(400, 'missing name')
      const { signature, item } = await chain.createItem({
        id: int(b.id, 'id'),
        name: String(b.name),
        price: int(b.price, 'price'),
        supply: int(b.supply ?? 0, 'supply'),
        minLevel: int(b.minLevel ?? 0, 'minLevel'),
        kind: int(b.kind ?? 0, 'kind'),
      })
      return send(res, 201, { ...withExplorer(signature), item: item.toBase58() })
    }
    if (parts[0] === 'shop' && parts[1] === 'items' && parts[2]) {
      const signature = await chain.updateItem(int(parts[2], 'id'), {
        price: int(b.price, 'price'),
        supply: int(b.supply ?? 0, 'supply'),
        minLevel: int(b.minLevel ?? 0, 'minLevel'),
        active: b.active !== false,
      })
      return send(res, 200, withExplorer(signature))
    }
    if (url.pathname === '/shop/redeem') {
      const { signature, receipt, number } = await chain.redeemItem(wallet(b.wallet), int(b.itemId, 'itemId'))
      return send(res, 200, { ...withExplorer(signature), receipt: receipt.toBase58(), number })
    }
    if (parts[0] === 'receipts' && parts[1] && parts[2] === 'fulfill')
      return send(res, 200, withExplorer(await chain.fulfillReceipt(wallet(parts[1]))))
    if (url.pathname === '/sessions') {
      if (!b.sessionId) throw new HttpError(400, 'missing sessionId')
      const { signature, session } = await chain.openSession({
        sessionId: String(b.sessionId),
        goal: int(b.goal, 'goal', 1),
        bonusPerPlayer: int(b.bonusPerPlayer ?? 0, 'bonusPerPlayer'),
      })
      return send(res, 201, { ...withExplorer(signature), session: session.toBase58() })
    }
    if (parts[0] === 'sessions' && parts[1] && parts[2] === 'bonus') {
      if (!Array.isArray(b.wallets)) throw new HttpError(400, 'need wallets[]')
      const results = []
      for (const w of b.wallets) {
        try {
          results.push({ wallet: String(w), ...withExplorer((await chain.claimTableBonus(parts[1], wallet(w))).signature) })
        } catch (err: any) {
          results.push({ wallet: String(w), error: err?.error?.errorCode?.code ?? err.message })
        }
      }
      return send(res, 200, results)
    }
    if (url.pathname === '/achievements/grant') {
      const a = typeof b.achievement === 'string' ? achievementByKey(b.achievement) : ACHIEVEMENTS.find((x) => x.bit === b.achievement)
      if (!a) throw new HttpError(400, 'unknown achievement (use a key from GET /achievements)')
      return send(res, 200, withExplorer(await chain.grantAchievement(wallet(b.wallet), a.bit)))
    }

    throw new HttpError(404, 'not found')
  }

  return http.createServer((req, res) => {
    route(req, res).catch((err: any) => {
      // Program rule violations (KudosCooldown, SoldOut, ...) come back as 400 with the error code.
      const code = err?.error?.errorCode?.code
      if (code) return send(res, 400, { error: code, message: err.error.errorMessage })
      const status = err instanceof HttpError ? err.status : 500
      if (status === 500) console.error(err)
      send(res, status, { error: err.message, logs: err.logs?.slice(-8) })
    })
  })
}

export function startService(chain = ChainClient.fromEnv(), port = PORT) {
  const events = new EventHub(chain.connection, chain.programId).start()
  return createService(chain, events).listen(port, () => {
    console.log(`chain service on :${port}  program ${chain.programId.toBase58()}  (${chain.cluster})`)
    if (!API_TOKEN) console.warn('CHAIN_API_TOKEN is not set: write endpoints are open')
  })
}
