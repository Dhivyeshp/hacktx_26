// Node side of @centerpiece/chain: the game server's admin client. It adds every
// write to the browser-safe CenterpieceReader in core.ts. The game server uses
// this (or the HTTP service in service.ts) and never builds transactions itself.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnchorProvider, BN, Program, Wallet } from '@anchor-lang/core'
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl } from '@solana/web3.js'
import { CenterpieceReader, coinAccount, hashBytes, idl, pk, sessionIdBytes, type Centerpiece } from './core.ts'

export * from './core.ts'

const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

type Key = PublicKey | string

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

export class ChainClient extends CenterpieceReader {
  readonly admin: Keypair
  readonly metadataBaseUrl: string
  readonly cluster: string

  constructor(opts: ChainOptions) {
    const provider = new AnchorProvider(opts.connection, new Wallet(opts.admin), { commitment: 'confirmed' })
    super(new Program<Centerpiece>(idl as Centerpiece, provider))
    this.admin = opts.admin
    this.metadataBaseUrl = opts.metadataBaseUrl.replace(/\/$/, '')
    this.cluster = opts.cluster ?? 'devnet'
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

  explorer(value: string, kind: 'tx' | 'address' = 'tx') {
    const cluster =
      this.cluster === 'localnet'
        ? `custom&customUrl=${encodeURIComponent(this.connection.rpcEndpoint)}`
        : this.cluster
    return `https://explorer.solana.com/${kind}/${value}?cluster=${cluster}`
  }

  // Badge updates do several metadata CPIs per instruction; the default 200k CU is too tight.
  private computeBudget() {
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 })]
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

  // ---------- setup ----------

  async initialize(opts: { name?: string; symbol?: string; maxAwardPerRound?: number; maxKudos?: number } = {}) {
    return this.program.methods
      .initialize(
        opts.name ?? 'Centerpiece Coin',
        opts.symbol ?? 'TABLE',
        `${this.metadataBaseUrl}/meta/coin.json`,
        new BN(opts.maxAwardPerRound ?? 100),
        new BN(opts.maxKudos ?? 10),
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
        badgeAta: coinAccount(badgeMint, w),
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature, player: this.pda.player(w), badgeMint }
  }

  // ---------- rounds and the table goal ----------

  async openSession(s: { sessionId: string; goal: number; bonusPerPlayer: number }) {
    const signature = await this.program.methods
      .openSession([...sessionIdBytes(s.sessionId)], new BN(s.goal), new BN(s.bonusPerPlayer))
      .accountsPartial({
        admin: this.admin.publicKey,
        config: this.pda.config,
        session: this.pda.session(s.sessionId),
        systemProgram: SystemProgram.programId,
      })
      .rpc()
    return { signature, session: this.pda.session(s.sessionId) }
  }

  async attestRound(r: { sessionId: string; roundNo: number; eventsHash: string | Uint8Array; playerCount: number }) {
    const signature = await this.program.methods
      .attestRound([...sessionIdBytes(r.sessionId)], r.roundNo, [...hashBytes(r.eventsHash)], r.playerCount)
      .accountsPartial({
        admin: this.admin.publicKey,
        config: this.pda.config,
        round: this.pda.round(r.sessionId, r.roundNo),
        systemProgram: SystemProgram.programId,
      })
      .rpc()
    return { signature, round: this.pda.round(r.sessionId, r.roundNo) }
  }

  async awardPlayer(a: { sessionId: string; roundNo: number; withSession?: boolean } & Award) {
    const w = pk(a.wallet)
    const round = this.pda.round(a.sessionId, a.roundNo)
    const withSession = a.withSession ?? !!(await this.connection.getAccountInfo(this.pda.session(a.sessionId)))
    const signature = await this.program.methods
      .awardPlayer(new BN(a.points), a.connections ?? 0)
      .accountsPartial({
        ...this.common(),
        round,
        session: withSession ? this.pda.session(a.sessionId) : null,
        wallet: w,
        player: this.pda.player(w),
        award: this.pda.award(round, w),
        coinMint: this.pda.coinMint,
        walletCoinAccount: coinAccount(this.pda.coinMint, w),
        badgeMint: this.pda.badge(w),
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature }
  }

  /**
   * Attests the round (if not yet attested) and pays every award that hasn't been
   * paid, filling the session's table goal when it has one. Safe to retry.
   */
  async settleRound(s: { sessionId: string; roundNo: number; eventsHash: string | Uint8Array; awards: Award[] }) {
    const round = this.pda.round(s.sessionId, s.roundNo)
    let attestSignature: string | null = null
    if (!(await this.program.account.round.fetchNullable(round))) {
      attestSignature = (
        await this.attestRound({ ...s, playerCount: Math.max(1, Math.min(255, s.awards.length)) })
      ).signature
    }
    const withSession = !!(await this.connection.getAccountInfo(this.pda.session(s.sessionId)))
    const results = []
    for (const a of s.awards) {
      const wallet = pk(a.wallet).toBase58()
      if (await this.program.account.award.fetchNullable(this.pda.award(round, pk(a.wallet)))) {
        results.push({ wallet, points: a.points, signature: null, skipped: 'already paid' })
        continue
      }
      try {
        const { signature } = await this.awardPlayer({ ...s, ...a, withSession })
        results.push({ wallet, points: a.points, signature })
      } catch (err) {
        results.push({ wallet, points: a.points, signature: null, error: (err as Error).message })
      }
    }
    return { round: round.toBase58(), attestSignature, awards: results, tableGoal: await this.session(s.sessionId) }
  }

  /**
   * Pays the table-goal bonus to `wallet`. Finds one of its Award receipts from
   * this session (any round 1..maxRounds) as proof it played.
   */
  async claimTableBonus(sessionId: string, wallet: Key, maxRounds = 20) {
    const w = pk(wallet)
    let proof: { round: PublicKey; award: PublicKey } | null = null
    for (let r = 1; r <= maxRounds && !proof; r++) {
      const round = this.pda.round(sessionId, r)
      const award = this.pda.award(round, w)
      if (await this.connection.getAccountInfo(award)) proof = { round, award }
    }
    if (!proof) throw new Error('NotInSession: wallet has no award in this session')
    const session = this.pda.session(sessionId)
    const signature = await this.program.methods
      .claimTableBonus()
      .accountsPartial({
        ...this.common(),
        session,
        round: proof.round,
        award: proof.award,
        wallet: w,
        player: this.pda.player(w),
        bonus: this.pda.bonus(session, w),
        coinMint: this.pda.coinMint,
        walletCoinAccount: coinAccount(this.pda.coinMint, w),
        badgeMint: this.pda.badge(w),
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature }
  }

  // ---------- kudos ----------

  /** Kudos on behalf of a custodial sender (admin-authorized). */
  async giveKudos(from: Key, to: Key, amount: number) {
    const [f, t] = [pk(from), pk(to)]
    const signature = await this.program.methods
      .giveKudos(new BN(amount))
      .accountsPartial({
        authority: this.admin.publicKey,
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
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature }
  }

  // ---------- shop ----------

  async createItem(i: { id: number; name: string; price: number; supply?: number; minLevel?: number; kind?: number }) {
    const signature = await this.program.methods
      .createItem(i.id, i.name, new BN(i.price), i.supply ?? 0, i.minLevel ?? 0, i.kind ?? 0)
      .accountsPartial({
        admin: this.admin.publicKey,
        config: this.pda.config,
        item: this.pda.item(i.id),
        systemProgram: SystemProgram.programId,
      })
      .rpc()
    return { signature, item: this.pda.item(i.id) }
  }

  async updateItem(id: number, u: { price: number; supply: number; minLevel: number; active: boolean }) {
    return this.program.methods
      .updateItem(new BN(u.price), u.supply, u.minLevel, u.active)
      .accountsPartial({ admin: this.admin.publicKey, config: this.pda.config, item: this.pda.item(id) })
      .rpc()
  }

  /** Redemption on behalf of a custodial player (admin-authorized). */
  async redeemItem(wallet: Key, itemId: number) {
    const w = pk(wallet)
    const player = await this.getPlayer(w)
    if (!player) throw new Error('wallet is not a registered player')
    const receipt = this.pda.receipt(w, player.redemptions)
    const signature = await this.program.methods
      .redeemItem()
      .accountsPartial({
        authority: this.admin.publicKey,
        config: this.pda.config,
        wallet: w,
        player: this.pda.player(w),
        item: this.pda.item(itemId),
        receipt,
        coinMint: this.pda.coinMint,
        walletCoinAccount: coinAccount(this.pda.coinMint, w),
        badgeMint: player.badgeMint,
        mintAuth: this.pda.mintAuth,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature, receipt, number: player.redemptions }
  }

  async fulfillReceipt(receipt: Key) {
    return this.program.methods
      .fulfillReceipt()
      .accountsPartial({ admin: this.admin.publicKey, config: this.pda.config, receipt: pk(receipt) })
      .rpc()
  }

  // ---------- achievements and keepsakes ----------

  async grantAchievement(wallet: Key, bit: number) {
    const w = pk(wallet)
    return this.program.methods
      .grantAchievement(bit)
      .accountsPartial({
        admin: this.admin.publicKey,
        config: this.pda.config,
        wallet: w,
        player: this.pda.player(w),
        badgeMint: this.pda.badge(w),
        mintAuth: this.pda.mintAuth,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(this.computeBudget())
      .rpc()
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
        badgeMint: this.pda.badge(w),
        keepsakeMint: mint,
        keepsakeAccount: coinAccount(mint, w),
      })
      .preInstructions(this.computeBudget())
      .rpc()
    return { signature, mint }
  }
}
