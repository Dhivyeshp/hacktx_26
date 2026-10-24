// Chain service: a small HTTP API over ChainClient so any part of the system
// (Python hub, Pi, web page) can trigger payouts without Solana libraries, and
// the metadata host that every on-chain URI points at.
//
// Public (wallets and explorers fetch these):
//   GET  /meta/coin.json  /meta/badge/:wallet.json  /meta/keepsake/:mint.json
//   GET  /img/coin.svg    /img/badge/:wallet.svg
//   GET  /players/:wallet           profile, level, coins, badge fields
//   GET  /rounds/:sessionId/:roundNo
// Requires "Authorization: Bearer $CHAIN_API_TOKEN":
//   POST /players          { wallet? }  -> registers; creates a custodial wallet when none is given
//   POST /rounds/settle    { sessionId, roundNo, eventsHash, awards: [{ wallet, points, connections }] }
//   POST /keepsakes        { sessionId, roundNo, wallet, name, image, challenge }
import http from 'node:http'
import { PublicKey } from '@solana/web3.js'
import { ChainClient } from './index.ts'

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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

function coinSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs><radialGradient id="g" cx="40%" cy="35%"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#d79a1e"/></radialGradient></defs>
  <circle cx="128" cy="128" r="120" fill="url(#g)" stroke="#8a5a00" stroke-width="8"/>
  <circle cx="128" cy="128" r="92" fill="none" stroke="#8a5a00" stroke-width="4" stroke-dasharray="6 8"/>
  <text x="128" y="148" text-anchor="middle" font-family="Helvetica, Arial" font-weight="800" font-size="56" fill="#5c3b00">TABLE</text>
</svg>`
}

function badgeSvg(p: { wallet: string; level: number; xp: number; connections: number; rounds: number }) {
  const hue = (p.level * 47) % 360
  const short = `${p.wallet.slice(0, 4)}…${p.wallet.slice(-4)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 400">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,12%)"/></linearGradient></defs>
  <rect width="320" height="400" rx="28" fill="url(#bg)"/>
  <text x="160" y="52" text-anchor="middle" font-family="Helvetica, Arial" font-size="18" letter-spacing="4" fill="#fff" opacity=".75">CENTERPIECE</text>
  <circle cx="160" cy="170" r="86" fill="none" stroke="hsl(${hue},90%,65%)" stroke-width="10"/>
  <text x="160" y="160" text-anchor="middle" font-family="Helvetica, Arial" font-size="18" fill="#fff" opacity=".8">LEVEL</text>
  <text x="160" y="214" text-anchor="middle" font-family="Helvetica, Arial" font-weight="800" font-size="72" fill="#fff">${p.level}</text>
  <text x="80" y="306" text-anchor="middle" font-family="Helvetica, Arial" font-weight="700" font-size="30" fill="#fff">${p.xp}</text>
  <text x="80" y="330" text-anchor="middle" font-family="Helvetica, Arial" font-size="13" fill="#fff" opacity=".7">XP</text>
  <text x="160" y="306" text-anchor="middle" font-family="Helvetica, Arial" font-weight="700" font-size="30" fill="#fff">${p.connections}</text>
  <text x="160" y="330" text-anchor="middle" font-family="Helvetica, Arial" font-size="13" fill="#fff" opacity=".7">CONNECTIONS</text>
  <text x="240" y="306" text-anchor="middle" font-family="Helvetica, Arial" font-weight="700" font-size="30" fill="#fff">${p.rounds}</text>
  <text x="240" y="330" text-anchor="middle" font-family="Helvetica, Arial" font-size="13" fill="#fff" opacity=".7">ROUNDS</text>
  <text x="160" y="376" text-anchor="middle" font-family="Menlo, monospace" font-size="13" fill="#fff" opacity=".55">${esc(short)}</text>
</svg>`
}

export function createService(chain: ChainClient) {
  const base = chain.metadataBaseUrl

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://chain')
    const parts = url.pathname.split('/').filter(Boolean)
    const method = req.method ?? 'GET'

    if (method === 'OPTIONS') return send(res, 204, '')
    if (url.pathname === '/healthz' || url.pathname === '/') {
      const config = await chain.getConfig()
      return send(res, 200, {
        ok: true,
        cluster: chain.cluster,
        programId: chain.programId.toBase58(),
        admin: chain.admin.publicKey.toBase58(),
        initialized: !!config,
        coinMint: chain.pda.coinMint.toBase58(),
        players: config ? Number(config.playerCount.toString()) : 0,
        keepsakes: config ? Number(config.keepsakeCount.toString()) : 0,
      })
    }

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
        image: `${base}/img/badge/${w.toBase58()}.svg?l=${p.level}&x=${p.xp}`,
        attributes: [
          { trait_type: 'Level', value: p.level },
          { trait_type: 'XP', value: p.xp },
          { trait_type: 'Connections', value: p.connections },
          { trait_type: 'Rounds played', value: p.roundsPlayed },
        ],
      })
    }
    if (method === 'GET' && parts[0] === 'img' && parts[1] === 'badge' && parts[2]?.endsWith('.svg')) {
      const w = wallet(parts[2].replace(/\.svg$/, ''))
      const p = await chain.profile(w)
      if (!p) throw new HttpError(404, 'player not registered')
      return send(
        res,
        200,
        badgeSvg({ wallet: p.wallet, level: p.level, xp: p.xp, connections: p.connections, rounds: p.roundsPlayed }),
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
    if (method === 'GET' && parts[0] === 'players' && parts[1]) {
      const p = await chain.profile(wallet(parts[1]))
      return p ? send(res, 200, p) : send(res, 404, { error: 'player not registered' })
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
    if (method === 'POST' && url.pathname === '/players') {
      requireAuth(req)
      const body = await readJson(req)
      const custodial = body.wallet ? null : chain.createCustodialWallet()
      const w = custodial ? custodial.publicKey : wallet(body.wallet)
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
    if (method === 'POST' && url.pathname === '/rounds/settle') {
      requireAuth(req)
      const b = await readJson(req)
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
    if (method === 'POST' && url.pathname === '/keepsakes') {
      requireAuth(req)
      const b = await readJson(req)
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

    throw new HttpError(404, 'not found')
  }

  return http.createServer((req, res) => {
    route(req, res).catch((err: any) => {
      const status = err instanceof HttpError ? err.status : 500
      if (status === 500) console.error(err)
      send(res, status, { error: err.message, logs: err.logs?.slice(-8) })
    })
  })
}

export function startService(chain = ChainClient.fromEnv(), port = PORT) {
  return createService(chain).listen(port, () => {
    console.log(`chain service on :${port}  program ${chain.programId.toBase58()}  (${chain.cluster})`)
    if (!API_TOKEN) console.warn('CHAIN_API_TOKEN is not set: write endpoints are open')
  })
}
