// Browser-safe half of @centerpiece/chain: no fs, env or node: imports, so a web
// app can import it directly (`@centerpiece/chain/core`). It reads everything
// the program stores and builds transactions a wallet adapter (Phantom) can sign.
// Admin writes live in index.ts (Node only).
import { AnchorProvider, BN, BorshCoder, EventParser, Program, type Wallet } from '@anchor-lang/core'
import { sha256 } from '@noble/hashes/sha2'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getTokenMetadata,
} from '@solana/spl-token'
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import idl from './idl/centerpiece.json' with { type: 'json' }
import type { Centerpiece } from './idl/centerpiece.ts'

export type { Centerpiece }
export { idl }
export const PROGRAM_ID = new PublicKey(idl.address)

type Key = PublicKey | string
export const pk = (k: Key) => (typeof k === 'string' ? new PublicKey(k) : k)
const num = (v: { toString(): string } | number) => Number(v.toString())

// ---------- seeds and PDAs (seed strings come from the program's #[constant]s in the IDL) ----------

function idlConstant(name: string): string {
  const c = (idl as any).constants?.find((x: any) => x.name === name)
  if (!c) throw new Error(`IDL constant ${name} missing; rebuild and sync the IDL`)
  return c.value
}

function seedConstant(name: string): Uint8Array {
  const v = idlConstant(name)
  if (v.startsWith('[')) return Uint8Array.from(JSON.parse(v))
  const m = v.match(/^b?"(.*)"$/)
  return new TextEncoder().encode(m ? m[1] : v)
}

export const SEEDS = Object.fromEntries(
  ['CONFIG', 'COIN', 'MINT_AUTH', 'PLAYER', 'BADGE', 'ROUND', 'AWARD', 'KEEPSAKE', 'SESSION', 'ITEM', 'RECEIPT', 'KUDOS', 'BONUS'].map(
    (k) => [k, seedConstant(`${k}_SEED`)],
  ),
) as Record<
  'CONFIG' | 'COIN' | 'MINT_AUTH' | 'PLAYER' | 'BADGE' | 'ROUND' | 'AWARD' | 'KEEPSAKE' | 'SESSION' | 'ITEM' | 'RECEIPT' | 'KUDOS' | 'BONUS',
  Uint8Array
>

const u16le = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff)
function u64le(n: number | bigint) {
  const out = new Uint8Array(8)
  let v = BigInt(n)
  for (let i = 0; i < 8; i++, v >>= 8n) out[i] = Number(v & 0xffn)
  return out
}

/** UUIDs map to their 16 bytes; any other session id is hashed down to 16 bytes. */
export function sessionIdBytes(sessionId: string): Uint8Array {
  const hex = sessionId.replace(/-/g, '')
  if (/^[0-9a-f]{32}$/i.test(hex)) return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))
  return sha256(new TextEncoder().encode(sessionId)).subarray(0, 16)
}

export function hashBytes(hash: string | Uint8Array): Uint8Array {
  const b =
    typeof hash === 'string'
      ? Uint8Array.from(hash.replace(/^0x/, '').match(/../g)?.map((x) => parseInt(x, 16)) ?? [])
      : Uint8Array.from(hash)
  if (b.length !== 32) throw new Error(`events hash must be 32 bytes, got ${b.length}`)
  return b
}

export function pdas(programId: PublicKey = PROGRAM_ID) {
  const find = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, programId)[0]
  return {
    config: find(SEEDS.CONFIG),
    coinMint: find(SEEDS.COIN),
    mintAuth: find(SEEDS.MINT_AUTH),
    player: (wallet: Key) => find(SEEDS.PLAYER, pk(wallet).toBytes()),
    badge: (wallet: Key) => find(SEEDS.BADGE, pk(wallet).toBytes()),
    round: (sessionId: string, roundNo: number) => find(SEEDS.ROUND, sessionIdBytes(sessionId), u16le(roundNo)),
    award: (round: Key, wallet: Key) => find(SEEDS.AWARD, pk(round).toBytes(), pk(wallet).toBytes()),
    keepsake: (index: number | bigint) => find(SEEDS.KEEPSAKE, u64le(index)),
    session: (sessionId: string) => find(SEEDS.SESSION, sessionIdBytes(sessionId)),
    item: (id: number) => find(SEEDS.ITEM, u16le(id)),
    receipt: (wallet: Key, number: number) => find(SEEDS.RECEIPT, pk(wallet).toBytes(), u16le(number)),
    kudosLink: (from: Key, to: Key) => find(SEEDS.KUDOS, pk(from).toBytes(), pk(to).toBytes()),
    bonus: (session: Key, wallet: Key) => find(SEEDS.BONUS, pk(session).toBytes(), pk(wallet).toBytes()),
  }
}

export const coinAccount = (mint: PublicKey, wallet: Key) =>
  getAssociatedTokenAddressSync(mint, pk(wallet), true, TOKEN_2022_PROGRAM_ID)

// ---------- achievements ----------

export interface Achievement {
  bit: number
  key: string
  title: string
  description: string
  emoji: string
  /** "auto": earned from on-chain stats. "granted": awarded by the game server. */
  source: 'auto' | 'granted'
}

export const ACHIEVEMENTS: Achievement[] = [
  { bit: 0, key: 'first_round', title: 'First Round', description: 'Played a round', emoji: '🎲', source: 'auto' },
  { bit: 1, key: 'first_connection', title: 'Icebreaker', description: 'Made your first connection', emoji: '🧊', source: 'auto' },
  { bit: 2, key: 'social_butterfly', title: 'Social Butterfly', description: '10 connections', emoji: '🦋', source: 'auto' },
  { bit: 3, key: 'level_3', title: 'Regular', description: 'Reached level 3', emoji: '⭐', source: 'auto' },
  { bit: 4, key: 'level_5', title: 'Table Legend', description: 'Reached level 5', emoji: '🌟', source: 'auto' },
  { bit: 5, key: 'generous', title: 'Generous', description: 'Gave kudos 5 times', emoji: '🎁', source: 'auto' },
  { bit: 6, key: 'appreciated', title: 'Appreciated', description: 'Received kudos 5 times', emoji: '💛', source: 'auto' },
  { bit: 7, key: 'collector', title: 'Collector', description: 'Owns 3 keepsakes', emoji: '🏺', source: 'auto' },
  { bit: 8, key: 'shopper', title: 'Treat Yourself', description: 'Redeemed a perk', emoji: '🛍️', source: 'auto' },
  { bit: 9, key: 'team_player', title: 'Team Player', description: 'Helped the table hit its goal', emoji: '🤝', source: 'auto' },
  { bit: 16, key: 'quiet_hero', title: 'Quiet Hero', description: 'Went from quiet to center stage', emoji: '🦸', source: 'granted' },
  { bit: 17, key: 'bounty_hunter', title: 'Bounty Hunter', description: 'Completed a secret bounty', emoji: '🎯', source: 'granted' },
  { bit: 18, key: 'duel_champion', title: 'Duel Champion', description: 'Won a duel vote', emoji: '⚔️', source: 'granted' },
  { bit: 19, key: 'golden_grab', title: 'Golden Grab', description: 'Got the golden capsule', emoji: '🏆', source: 'granted' },
]

export const decodeAchievements = (mask: number) => ACHIEVEMENTS.filter((a) => (mask >>> a.bit) & 1)
export const achievementByKey = (key: string) => ACHIEVEMENTS.find((a) => a.key === key)

// ---------- events ----------

export interface ChainEvent {
  name: string
  data: Record<string, unknown>
  signature: string
  slot: number
}

/** Turns BN/PublicKey/byte-array fields into JSON-friendly numbers, base58 and hex. */
export function jsonify(value: unknown): unknown {
  if (value instanceof PublicKey) return value.toBase58()
  if (value && typeof value === 'object' && 'toArrayLike' in (value as any)) return num(value as any)
  if (Array.isArray(value) && value.every((v) => typeof v === 'number') && value.length >= 16)
    return value.map((b) => b.toString(16).padStart(2, '0')).join('')
  if (Array.isArray(value)) return value.map(jsonify)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonify(v)]))
  return value
}

// EventParser keeps the IDL's snake_case field names; the REST API and docs use camelCase.
const camelKeys = (data: unknown) =>
  Object.fromEntries(
    Object.entries(data as Record<string, unknown>).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]),
  )

/** Calls `onEvent` for every program event as transactions land. Returns an unsubscribe function. */
export function subscribeEvents(connection: Connection, onEvent: (e: ChainEvent) => void, programId = PROGRAM_ID) {
  const parser = new EventParser(programId, new BorshCoder(idl as any))
  const id = connection.onLogs(
    programId,
    (logs, ctx) => {
      if (logs.err) return
      for (const ev of parser.parseLogs(logs.logs))
        onEvent({ name: ev.name, data: camelKeys(jsonify(ev.data)), signature: logs.signature, slot: ctx.slot })
    },
    'confirmed',
  )
  return () => connection.removeOnLogsListener(id)
}

// ---------- reads ----------

const readOnlyWallet = (): Wallet =>
  ({
    publicKey: Keypair.generate().publicKey,
    signTransaction: async () => {
      throw new Error('read-only')
    },
    signAllTransactions: async () => {
      throw new Error('read-only')
    },
  }) as unknown as Wallet

/** Badge metadata updates need more than the default 200k compute units. */
export const COMPUTE_UNITS = 800_000
const computeBudget = () => [ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS })]

export type LeaderboardSort = 'xp' | 'coins' | 'kudos' | 'connections'

/** Read-only access to everything the program stores. Works in the browser. */
export class CenterpieceReader {
  readonly program: Program<Centerpiece>
  readonly connection: Connection
  readonly pda: ReturnType<typeof pdas>

  constructor(connectionOrProgram: Connection | Program<Centerpiece>) {
    this.program =
      connectionOrProgram instanceof Connection
        ? new Program<Centerpiece>(
            idl as Centerpiece,
            new AnchorProvider(connectionOrProgram, readOnlyWallet(), { commitment: 'confirmed' }),
          )
        : connectionOrProgram
    this.connection = this.program.provider.connection
    this.pda = pdas(this.program.programId)
  }

  get programId() {
    return this.program.programId
  }

  getConfig() {
    return this.program.account.config.fetchNullable(this.pda.config)
  }

  getPlayer(wallet: Key) {
    return this.program.account.player.fetchNullable(this.pda.player(wallet))
  }

  getRound(sessionId: string, roundNo: number) {
    return this.program.account.round.fetchNullable(this.pda.round(sessionId, roundNo))
  }

  async coinBalance(wallet: Key): Promise<number> {
    try {
      const acct = await getAccount(this.connection, coinAccount(this.pda.coinMint, wallet), 'confirmed', TOKEN_2022_PROGRAM_ID)
      return Number(acct.amount)
    } catch {
      return 0
    }
  }

  /** Name, symbol, uri and custom fields stored on a Token-2022 mint. */
  async tokenMetadata(mint: Key) {
    const meta = await getTokenMetadata(this.connection, pk(mint), 'confirmed', TOKEN_2022_PROGRAM_ID)
    if (!meta) return null
    return { name: meta.name, symbol: meta.symbol, uri: meta.uri, fields: Object.fromEntries(meta.additionalMetadata) }
  }

  private shapePlayer(p: any, coins?: number) {
    return {
      wallet: p.wallet.toBase58(),
      badgeMint: p.badgeMint.toBase58(),
      level: p.level,
      xp: num(p.xp),
      coinsEarned: num(p.coinsEarned),
      coins,
      connections: p.connections,
      roundsPlayed: p.roundsPlayed,
      kudosGiven: p.kudosGiven,
      kudosReceived: p.kudosReceived,
      keepsakes: p.keepsakes,
      redemptions: p.redemptions,
      achievementMask: p.achievements,
      achievements: decodeAchievements(p.achievements).map((a) => a.key),
    }
  }

  /** Everything a profile page needs for one wallet. */
  async profile(wallet: Key) {
    const player = await this.getPlayer(wallet)
    if (!player) return null
    const [coins, badge] = await Promise.all([this.coinBalance(wallet), this.tokenMetadata(player.badgeMint)])
    return { ...this.shapePlayer(player, coins), badgeFields: badge?.fields ?? {} }
  }

  /** All registered players, ranked. Reads every Player account (fine at game-night scale). */
  async leaderboard(by: LeaderboardSort = 'xp', limit = 20) {
    const players = (
      // dataSize skips stale v1 Player accounts (smaller layout) still on devnet.
      await this.program.account.player.all([{ dataSize: this.program.account.player.size }])
    ).map((p) => this.shapePlayer(p.account))
    const key = { xp: 'xp', coins: 'coinsEarned', kudos: 'kudosReceived', connections: 'connections' }[by] as
      | 'xp'
      | 'coinsEarned'
      | 'kudosReceived'
      | 'connections'
    return players.sort((a, b) => b[key] - a[key] || b.xp - a.xp).slice(0, limit).map((p, i) => ({ rank: i + 1, ...p }))
  }

  /** Shop catalog, cheapest first. */
  async items() {
    return (await this.program.account.item.all())
      .map(({ publicKey, account: i }) => ({
        address: publicKey.toBase58(),
        id: i.id,
        name: i.name,
        price: num(i.price),
        supply: i.supply,
        sold: i.sold,
        remaining: i.supply === 0 ? null : i.supply - i.sold,
        minLevel: i.minLevel,
        kind: i.kind,
        active: i.active,
      }))
      .sort((a, b) => a.price - b.price || a.id - b.id)
  }

  /** A wallet's redemptions, newest first. */
  async receipts(wallet: Key) {
    const all = await this.program.account.receipt.all([{ memcmp: { offset: 8, bytes: pk(wallet).toBase58() } }])
    return all
      .map(({ publicKey, account: r }) => ({
        address: publicKey.toBase58(),
        wallet: r.wallet.toBase58(),
        itemId: r.itemId,
        price: num(r.price),
        number: r.number,
        createdAt: new Date(num(r.createdAt) * 1000).toISOString(),
        fulfilled: r.fulfilled,
      }))
      .sort((a, b) => b.number - a.number)
  }

  /** Every unfulfilled redemption, oldest first: the hub's to-do list. */
  async pendingReceipts() {
    return (await this.program.account.receipt.all())
      .filter((r) => !r.account.fulfilled)
      .map(({ publicKey, account: r }) => ({
        address: publicKey.toBase58(),
        wallet: r.wallet.toBase58(),
        itemId: r.itemId,
        number: r.number,
        createdAt: new Date(num(r.createdAt) * 1000).toISOString(),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** Table goal progress for a session, or null if it has no goal. */
  async session(sessionId: string) {
    const s = await this.program.account.session.fetchNullable(this.pda.session(sessionId))
    if (!s) return null
    const goal = num(s.goal)
    const pot = num(s.pot)
    return {
      address: this.pda.session(sessionId).toBase58(),
      goal,
      pot,
      progress: goal ? Math.min(1, pot / goal) : 1,
      reached: s.reached,
      reachedAt: s.reached ? new Date(num(s.reachedAt) * 1000).toISOString() : null,
      bonusPerPlayer: num(s.bonusPerPlayer),
      bonusesClaimed: s.bonusesClaimed,
    }
  }

  /** Keepsake NFTs a wallet holds (Token-2022 accounts whose mint is a keepsake PDA). */
  async keepsakes(wallet: Key) {
    const config = await this.getConfig()
    if (!config) return []
    const known = new Set<string>()
    for (let i = 0; i < num(config.keepsakeCount); i++) known.add(this.pda.keepsake(i).toBase58())
    const { value } = await this.connection.getParsedTokenAccountsByOwner(pk(wallet), { programId: TOKEN_2022_PROGRAM_ID })
    const mints = value
      .map((a) => a.account.data.parsed.info)
      .filter((info) => known.has(info.mint) && info.tokenAmount.uiAmount === 1)
      .map((info) => info.mint as string)
    const metas = await Promise.all(mints.map((m) => this.tokenMetadata(m)))
    return mints.map((mint, i) => ({
      mint,
      name: metas[i]?.name ?? '',
      image: metas[i]?.fields.image ?? null,
      challenge: metas[i]?.fields.challenge ?? null,
      round: metas[i]?.fields.round ? Number(metas[i]!.fields.round) : null,
      number: metas[i]?.fields.number ? Number(metas[i]!.fields.number) : null,
      metadataUri: metas[i]?.uri ?? null,
    }))
  }

  // ---------- self-custody transactions (sign with a wallet adapter) ----------

  /** Kudos signed by the sender's own wallet. The sender pays the fee. */
  async buildGiveKudosTx(from: Key, to: Key, amount: number): Promise<Transaction> {
    const [f, t] = [pk(from), pk(to)]
    const tx = await this.program.methods
      .giveKudos(new BN(amount))
      .accountsPartial({
        authority: f,
        config: this.pda.config,
        from: f,
        to: t,
        fromPlayer: this.pda.player(f),
        toPlayer: this.pda.player(t),
        link: this.pda.kudosLink(f, t),
        coinMint: this.pda.coinMint,
        fromCoinAccount: coinAccount(this.pda.coinMint, f),
        toCoinAccount: coinAccount(this.pda.coinMint, t),
        fromBadge: this.pda.badge(f),
        toBadge: this.pda.badge(t),
        mintAuth: this.pda.mintAuth,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudget())
      .transaction()
    tx.feePayer = f
    return tx
  }

  /** Shop redemption signed by the buyer's own wallet. */
  async buildRedeemTx(wallet: Key, itemId: number): Promise<Transaction> {
    const w = pk(wallet)
    const player = await this.getPlayer(w)
    if (!player) throw new Error('wallet is not a registered player')
    const tx = await this.program.methods
      .redeemItem()
      .accountsPartial({
        authority: w,
        config: this.pda.config,
        wallet: w,
        player: this.pda.player(w),
        item: this.pda.item(itemId),
        receipt: this.pda.receipt(w, player.redemptions),
        coinMint: this.pda.coinMint,
        walletCoinAccount: coinAccount(this.pda.coinMint, w),
        badgeMint: player.badgeMint,
        mintAuth: this.pda.mintAuth,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(computeBudget())
      .transaction()
    tx.feePayer = w
    return tx
  }
}
