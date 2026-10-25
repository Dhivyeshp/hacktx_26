//! Centerpiece on-chain game layer.
//!
//! - TABLE coin: a Token-2022 mint whose authority and permanent delegate are a
//!   program PDA, so coin only appears, moves, or burns through program rules.
//! - Player badge: a soulbound (NonTransferable) NFT per wallet whose metadata
//!   fields (level, xp, connections, kudos, achievements) update as the player plays.
//! - Rounds: the game server attests a hash of each round's off-chain event log,
//!   then awards each player once for that round, capped per award.
//! - Table goal: a session's awards fill a shared pot; reaching the goal unlocks
//!   a bonus for everyone who played.
//! - Kudos: players thank each other with TABLE, which also forms connections.
//! - Shop: players burn TABLE for perks; receipts track fulfilment.
//! - Achievements: stats-based milestones plus server-granted ones, on the badge.
//! - Keepsakes: transferable 1-of-1 NFTs for memorable moments.
pub mod constants;
pub mod error;
pub mod instructions;
pub mod progress;
pub mod state;
pub mod token_meta;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use progress::AchievementUnlocked;
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
        max_kudos: u64,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, name, symbol, uri, max_award_per_round, max_kudos)
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

    pub fn give_kudos(ctx: Context<GiveKudos>, amount: u64) -> Result<()> {
        instructions::give_kudos::handle_give_kudos(ctx, amount)
    }

    pub fn create_item(
        ctx: Context<CreateItem>,
        id: u16,
        name: String,
        price: u64,
        supply: u32,
        min_level: u8,
        kind: u8,
    ) -> Result<()> {
        instructions::create_item::handle_create_item(ctx, id, name, price, supply, min_level, kind)
    }

    pub fn update_item(ctx: Context<UpdateItem>, price: u64, supply: u32, min_level: u8, active: bool) -> Result<()> {
        instructions::update_item::handle_update_item(ctx, price, supply, min_level, active)
    }

    pub fn redeem_item(ctx: Context<RedeemItem>) -> Result<()> {
        instructions::redeem_item::handle_redeem_item(ctx)
    }

    pub fn fulfill_receipt(ctx: Context<FulfillReceipt>) -> Result<()> {
        instructions::fulfill_receipt::handle_fulfill_receipt(ctx)
    }

    pub fn open_session(ctx: Context<OpenSession>, session_id: [u8; 16], goal: u64, bonus_per_player: u64) -> Result<()> {
        instructions::open_session::handle_open_session(ctx, session_id, goal, bonus_per_player)
    }

    pub fn claim_table_bonus(ctx: Context<ClaimTableBonus>) -> Result<()> {
        instructions::claim_table_bonus::handle_claim_table_bonus(ctx)
    }

    pub fn grant_achievement(ctx: Context<GrantAchievement>, bit: u8) -> Result<()> {
        instructions::grant_achievement::handle_grant_achievement(ctx, bit)
    }
}
