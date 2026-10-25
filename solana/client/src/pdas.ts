import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'

const seed = (s: string) => Buffer.from(s)

function u16le(n: number) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}

function u64le(n: number | bigint) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}

/** UUIDs map to their 16 bytes; any other session id is hashed down to 16 bytes. */
export function sessionIdBytes(sessionId: string): Buffer {
  const hex = sessionId.replace(/-/g, '')
  if (/^[0-9a-f]{32}$/i.test(hex)) return Buffer.from(hex, 'hex')
  return createHash('sha256').update(sessionId).digest().subarray(0, 16)
}

export function hashBytes(hash: string | Uint8Array): Buffer {
  const b = typeof hash === 'string' ? Buffer.from(hash.replace(/^0x/, ''), 'hex') : Buffer.from(hash)
  if (b.length !== 32) throw new Error(`events hash must be 32 bytes, got ${b.length}`)
  return b
}

export function pdas(programId: PublicKey) {
  const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, programId)[0]
  return {
    config: find(seed('config')),
    coinMint: find(seed('coin')),
    mintAuth: find(seed('mint_auth')),
    player: (wallet: PublicKey) => find(seed('player'), wallet.toBuffer()),
    badge: (wallet: PublicKey) => find(seed('badge'), wallet.toBuffer()),
    round: (sessionId: string, roundNo: number) => find(seed('round'), sessionIdBytes(sessionId), u16le(roundNo)),
    award: (round: PublicKey, wallet: PublicKey) => find(seed('award'), round.toBuffer(), wallet.toBuffer()),
    keepsake: (index: number | bigint) => find(seed('keepsake'), u64le(index)),
  }
}
