//! Centerpiece on-chain game layer.
//!
//! - TABLE coin: a Token-2022 mint whose authority is a program PDA, so coin only
//!   exists when this program pays it out.
//! - Player badge: a soulbound (NonTransferable) NFT per wallet whose metadata
//!   fields (level, xp, connections) update as the player earns.
//! - Rounds: the game server attests a hash of each round's off-chain event log,
//!   then awards each player once for that round, capped per award.
//! - Keepsakes: transferable 1-of-1 NFTs for memorable moments.
pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod token_meta;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("DqqLyrxUPAiJ2m3Fu4uLL6GirTH2cSXXS9wJHmGngaZX");

#[program]
pub mod centerpiece {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        name: String,
        symbol: String,
        uri: String,
        max_award_per_round: u64,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, name, symbol, uri, max_award_per_round)
    }

    pub fn register_player(ctx: Context<RegisterPlayer>, uri: String) -> Result<()> {
        instructions::register_player::handle_register_player(ctx, uri)
    }

    pub fn attest_round(
        ctx: Context<AttestRound>,
        session_id: [u8; 16],
        round_no: u16,
        events_hash: [u8; 32],
        player_count: u8,
    ) -> Result<()> {
        instructions::attest_round::handle_attest_round(ctx, session_id, round_no, events_hash, player_count)
    }

    pub fn award_player(ctx: Context<AwardPlayer>, points: u64, connections: u32) -> Result<()> {
        instructions::award_player::handle_award_player(ctx, points, connections)
    }

    pub fn mint_keepsake(
        ctx: Context<MintKeepsake>,
        name: String,
        uri: String,
        image: String,
        challenge: String,
    ) -> Result<()> {
        instructions::mint_keepsake::handle_mint_keepsake(ctx, name, uri, image, challenge)
    }
}
