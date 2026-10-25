// OpenAPI 3.1 description of the chain service, served at GET /openapi.json so a
// frontend can browse it (e.g. paste the URL into https://editor.swagger.io).
type Op = { summary: string; params?: string[]; query?: string[]; body?: Record<string, string>; auth?: boolean }

const ops: Record<string, Record<'get' | 'post', Op | undefined>> = {
  '/status': { get: { summary: 'Program id, coin mint, counts, relay link' }, post: undefined },
  '/leaderboard': { get: { summary: 'Players ranked', query: ['by=xp|coins|kudos|connections', 'limit'] }, post: undefined },
  '/players': {
    get: undefined,
    post: { summary: 'Register a player (custodial wallet created when omitted) and mint their soulbound badge', body: { wallet: 'string?' }, auth: true },
  },
  '/players/{wallet}': { get: { summary: 'Profile: level, xp, coins, kudos, achievements, badge fields', params: ['wallet'] }, post: undefined },
  '/players/{wallet}/keepsakes': { get: { summary: 'Keepsake NFTs the wallet holds', params: ['wallet'] }, post: undefined },
  '/players/{wallet}/receipts': { get: { summary: 'Shop redemptions, newest first', params: ['wallet'] }, post: undefined },
  '/achievements': { get: { summary: 'Achievement catalog (bit, key, title, emoji)' }, post: undefined },
  '/achievements/grant': {
    get: undefined,
    post: { summary: 'Grant a server-judged achievement (bits 16+)', body: { wallet: 'string', achievement: 'key or bit' }, auth: true },
  },
  '/shop': { get: { summary: 'Item catalog, cheapest first' }, post: undefined },
  '/shop/pending': { get: { summary: 'Unfulfilled redemptions (the hub\'s to-do list)' }, post: undefined },
  '/shop/items': {
    get: undefined,
    post: { summary: 'List a new item', body: { id: 'u16', name: 'string<=32', price: 'int', supply: 'int (0=unlimited)', minLevel: 'int', kind: 'int' }, auth: true },
  },
  '/shop/items/{id}': {
    get: undefined,
    post: { summary: 'Reprice / restock / deactivate an item', params: ['id'], body: { price: 'int', supply: 'int', minLevel: 'int', active: 'bool' }, auth: true },
  },
  '/shop/redeem': {
    get: undefined,
    post: { summary: 'Burn TABLE for an item on behalf of a custodial player', body: { wallet: 'string', itemId: 'int' }, auth: true },
  },
  '/receipts/{address}/fulfill': {
    get: undefined,
    post: { summary: 'Mark a redemption delivered', params: ['address'], auth: true },
  },
  '/kudos': {
    get: undefined,
    post: { summary: 'Send kudos (moves TABLE sender to receiver; 60 s cooldown per pair)', body: { from: 'string', to: 'string', amount: 'int 1..maxKudos' }, auth: true },
  },
  '/sessions': {
    get: undefined,
    post: { summary: 'Open a session with a table goal', body: { sessionId: 'string', goal: 'int', bonusPerPlayer: 'int' }, auth: true },
  },
  '/sessions/{sessionId}': { get: { summary: 'Table goal progress', params: ['sessionId'] }, post: undefined },
  '/sessions/{sessionId}/bonus': {
    get: undefined,
    post: { summary: 'Pay the table-goal bonus to each wallet that played', params: ['sessionId'], body: { wallets: 'string[]' }, auth: true },
  },
  '/rounds/settle': {
    get: undefined,
    post: {
      summary: 'Attest a round hash and pay each player once (fills the table goal)',
      body: { sessionId: 'string', roundNo: 'int', eventsHash: 'hex sha256', awards: '[{wallet, points, connections}]' },
      auth: true,
    },
  },
  '/rounds/{sessionId}/{roundNo}': { get: { summary: 'On-chain round attestation', params: ['sessionId', 'roundNo'] }, post: undefined },
  '/keepsakes': {
    get: undefined,
    post: { summary: 'Mint a keepsake NFT', body: { sessionId: 'string', roundNo: 'int', wallet: 'string', name: 'string', image: 'url', challenge: 'string' }, auth: true },
  },
  '/events': { get: { summary: 'Server-Sent Events stream of program events', query: ['replay'] }, post: undefined },
  '/events/recent': { get: { summary: 'Last program events (newest first)', query: ['limit', 'name'] }, post: undefined },
  '/idl.json': { get: { summary: 'Anchor IDL' }, post: undefined },
}

export function openApi(serverUrl: string) {
  const paths: Record<string, unknown> = {}
  for (const [path, methods] of Object.entries(ops)) {
    const entry: Record<string, unknown> = {}
    for (const [method, op] of Object.entries(methods)) {
      if (!op) continue
      entry[method] = {
        summary: op.summary,
        security: op.auth ? [{ bearer: [] }] : [],
        parameters: [
          ...(op.params ?? []).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
          ...(op.query ?? []).map((q) => ({ name: q.split('=')[0], in: 'query', description: q, schema: { type: 'string' } })),
        ],
        requestBody: op.body
          ? {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: Object.fromEntries(Object.entries(op.body).map(([k, d]) => [k, { description: d }])),
                  },
                },
              },
            }
          : undefined,
        responses: {
          200: { description: 'OK' },
          400: { description: 'Bad input, or a program rule ({ error: "KudosCooldown" | "SoldOut" | ... })' },
          ...(op.auth ? { 401: { description: 'Missing/invalid bearer token' } } : {}),
        },
      }
    }
    paths[path] = entry
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Centerpiece chain service', version: '2.0.0', description: 'Solana devnet program for Centerpiece: coin, badges, kudos, shop, achievements, table goals.' },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths,
  }
}
