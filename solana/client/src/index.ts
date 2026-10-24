// Typed wrapper around the centerpiece Anchor program. The game server uses
// this (or the HTTP service in service.ts) and never builds transactions itself.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnchorProvider, BN, Program, Wallet } from '@anchor-lang/core'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getTokenMetadata,
} from '@solana/spl-token'
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl } from '@solana/web3.js'
import idl from './idl/centerpiece.json' with { type: 'json' }
import type { Centerpiece } from './idl/centerpiece.ts'
import { hashBytes, pdas, sessionIdBytes } from './pdas.ts'

export { pdas, sessionIdBytes, hashBytes }
export type { Centerpiece }

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

type Key = PublicKey | string
const pk = (k: Key) => (typeof k === 'string' ? new PublicKey(k) : k)

export interface Award {
  wallet: Key
  points: number
  connections?: number
}

export interface ChainOptions {
  connection: Connection
  admin: Keypair
  /** Public base URL of the metadata service (service.ts), used in on-chain URIs. */
  metadataBaseUrl: string
  cluster?: string
}

/** Reads a keypair from AUTHORITY_SECRET (JSON array) or AUTHORITY_KEYPAIR (file path). */
export function loadAuthority(): Keypair {
  const inline = process.env.AUTHORITY_SECRET
  if (inline) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(inline)))
  const path = (process.env.AUTHORITY_KEYPAIR ?? '~/.config/solana/id.json').replace(/^~/, homedir())
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
}

export class ChainClient {
  readonly program: Program<Centerpiece>
  readonly pda: ReturnType<typeof pdas>
  readonly admin: Keypair
  readonly connection: Connection
  readonly metadataBaseUrl: string
  readonly cluster: string

  constructor(opts: ChainOptions) {
    this.connection = opts.connection
    this.admin = opts.admin
    this.metadataBaseUrl = opts.metadataBaseUrl.replace(/\/$/, '')
    this.cluster = opts.cluster ?? 'devnet'
    const provider = new AnchorProvider(opts.connection, new Wallet(opts.admin), { commitment: 'confirmed' })
    this.program = new Program<Centerpiece>(idl as Centerpiece, provider)
    this.pda = pdas(this.program.programId)
  }

  static fromEnv() {
    const cluster = process.env.SOLANA_CLUSTER ?? 'devnet'
    const rpc =
      process.env.SOLANA_RPC ?? (cluster === 'localnet' ? 'http://127.0.0.1:8899' : clusterApiUrl('devnet'))
    return new ChainClient({
      connection: new Connection(rpc, 'confirmed'),
      admin: loadAuthority(),
      // Render sets RENDER_EXTERNAL_URL to the service's public https URL.
      metadataBaseUrl: process.env.CHAIN_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:8787',
      cluster,
    })
  }

  get programId() {
    return this.program.programId
  }

  explorer(value: string, kind: 'tx' | 'address' = 'tx') {
    const cluster =
      this.cluster === 'localnet'
        ? `custom&customUrl=${encodeURIComponent(this.connection.rpcEndpoint)}`
        : this.cluster
    return `https://explorer.solana.com/${kind}/${value}?cluster=${cluster}`
  }

  // Badge and keepsake mints do a lot of CPIs; the default 200k CU is too tight.
  private computeBudget() {
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })]
  }

  private common() {
    return {
      admin: this.admin.publicKey,
      config: this.pda.config,
      mintAuth: this.pda.mintAuth,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }
  }

  // ---------- writes ----------

  async initialize(opts: { name?: string; symbol?: string; maxAwardPerRound?: number } = {}) {
    return this.program.methods
      .initialize(
        opts.name ?? 'Centerpiece Coin',
        opts.symbol ?? 'TABLE',
        `${this.metadataBaseUrl}/meta/coin.json`,
        new BN(opts.maxAwardPerRound ?? 100),
      )
      .accountsPartial({
        admin: this.admin.publicKey,
        config: this.pda.config,
        mintAuth: this.pda.mintAuth,
        coinMint: this.pda.coinMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  }

  /** New devnet wallet for a player who doesn't bring their own. The caller stores the secret. */
  createCustodialWallet() {
    return Keypair.generate()
  }

  async registerPlayer(wallet: Key) {
    const w = pk(wallet)
    const badgeMint = this.pda.badge(w)
    const signature = await this.program.methods
      .registerPlayer(`${this.metadataBaseUrl}/meta/badge/${w.toBase58()}.json`)
      .accountsPartial({
        ...this.common(),
        wallet: w,
        player: this.pda.player(w),
        badgeMint,
        badgeAta: getAssociatedTokenAddressSync(badgeMint, w, true, TOKEN_2022_PROGRAM_ID),
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature, player: this.pda.player(w), badgeMint }
  }

  async attestRound(r: { sessionId: string; roundNo: number; eventsHash: string | Uint8Array; playerCount: number }) {
    const signature = await this.program.methods
      .attestRound(
        [...sessionIdBytes(r.sessionId)],
        r.roundNo,
        [...hashBytes(r.eventsHash)],
        r.playerCount,
      )
      .accountsPartial({
        admin: this.admin.publicKey,
        config: this.pda.config,
        round: this.pda.round(r.sessionId, r.roundNo),
        systemProgram: SystemProgram.programId,
      })
      .rpc()
    return { signature, round: this.pda.round(r.sessionId, r.roundNo) }
  }

  async awardPlayer(a: { sessionId: string; roundNo: number } & Award) {
    const w = pk(a.wallet)
    const round = this.pda.round(a.sessionId, a.roundNo)
    const signature = await this.program.methods
      .awardPlayer(new BN(a.points), a.connections ?? 0)
      .accountsPartial({
        ...this.common(),
        round,
        wallet: w,
        player: this.pda.player(w),
        award: this.pda.award(round, w),
        coinMint: this.pda.coinMint,
        walletCoinAccount: getAssociatedTokenAddressSync(this.pda.coinMint, w, true, TOKEN_2022_PROGRAM_ID),
        badgeMint: this.pda.badge(w),
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature }
  }

  /**
   * Attests the round (if not yet attested) and pays every award that hasn't been
   * paid. Safe to retry: on-chain receipts make repeated calls no-ops.
   */
  async settleRound(s: { sessionId: string; roundNo: number; eventsHash: string | Uint8Array; awards: Award[] }) {
    const round = this.pda.round(s.sessionId, s.roundNo)
    let attestSignature: string | null = null
    if (!(await this.program.account.round.fetchNullable(round))) {
      attestSignature = (
        await this.attestRound({ ...s, playerCount: Math.max(1, Math.min(255, s.awards.length)) })
      ).signature
    }
    const results = []
    for (const a of s.awards) {
      const wallet = pk(a.wallet).toBase58()
      if (await this.program.account.award.fetchNullable(this.pda.award(round, pk(a.wallet)))) {
        results.push({ wallet, points: a.points, signature: null, skipped: 'already paid' })
        continue
      }
      try {
        const { signature } = await this.awardPlayer({ ...s, ...a })
        results.push({ wallet, points: a.points, signature })
      } catch (err) {
        results.push({ wallet, points: a.points, signature: null, error: (err as Error).message })
      }
    }
    return { round: round.toBase58(), attestSignature, awards: results }
  }

  async mintKeepsake(k: {
    sessionId: string
    roundNo: number
    wallet: Key
    name: string
    image: string
    challenge: string
  }) {
    const w = pk(k.wallet)
    const config = await this.program.account.config.fetch(this.pda.config)
    const mint = this.pda.keepsake(BigInt(config.keepsakeCount.toString()))
    const signature = await this.program.methods
      .mintKeepsake(k.name, `${this.metadataBaseUrl}/meta/keepsake/${mint.toBase58()}.json`, k.image, k.challenge)
      .accountsPartial({
        ...this.common(),
        round: this.pda.round(k.sessionId, k.roundNo),
        wallet: w,
        player: this.pda.player(w),
        keepsakeMint: mint,
        keepsakeAccount: getAssociatedTokenAddressSync(mint, w, true, TOKEN_2022_PROGRAM_ID),
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature, mint }
  }

  // ---------- reads ----------

  getConfig() {
    return this.program.account.config.fetchNullable(this.pda.config)
  }

  getPlayer(wallet: Key) {
    return this.program.account.player.fetchNullable(this.pda.player(pk(wallet)))
  }

  getRound(sessionId: string, roundNo: number) {
    return this.program.account.round.fetchNullable(this.pda.round(sessionId, roundNo))
  }

  async coinBalance(wallet: Key): Promise<number> {
    const ata = getAssociatedTokenAddressSync(this.pda.coinMint, pk(wallet), true, TOKEN_2022_PROGRAM_ID)
    try {
      return Number((await getAccount(this.connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID)).amount)
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

  /** Everything a profile page needs for one wallet. */
  async profile(wallet: Key) {
    const w = pk(wallet)
    const player = await this.getPlayer(w)
    if (!player) return null
    const [coins, badge] = await Promise.all([this.coinBalance(w), this.tokenMetadata(player.badgeMint)])
    return {
      wallet: w.toBase58(),
      badgeMint: player.badgeMint.toBase58(),
      level: player.level,
      xp: Number(player.xp.toString()),
      coinsEarned: Number(player.coinsEarned.toString()),
      coins,
      connections: player.connections,
      roundsPlayed: player.roundsPlayed,
      badgeFields: badge?.fields ?? {},
    }
  }
}
