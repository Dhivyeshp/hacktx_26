use anchor_lang::prelude::*;

use crate::constants::MAX_NAME_LEN;

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// The game server's authority key; the only signer allowed to settle rounds.
    pub admin: Pubkey,
    pub coin_mint: Pubkey,
    pub max_award_per_round: u64,
    pub max_kudos: u64,
    pub keepsake_count: u64,
    pub player_count: u64,
    pub item_count: u16,
    pub bump: u8,
    pub mint_auth_bump: u8,
}

/// One per wallet. Mirrors the numbers shown on the player's soulbound badge.
#[account]
#[derive(InitSpace)]
pub struct Player {
    pub wallet: Pubkey,
    pub badge_mint: Pubkey,
    pub xp: u64,
    pub coins_earned: u64,
    pub connections: u32,
    pub rounds_played: u32,
    pub kudos_given: u32,
    pub kudos_received: u32,
    /// Bitmask of ACH_* constants.
    pub achievements: u32,
    pub keepsakes: u16,
    pub redemptions: u16,
    pub level: u8,
    pub bump: u8,
}

/// Written once per round. `events_hash` is the sha256 of the round's off-chain
/// event log, so payouts can be checked against the data that justified them.
#[account]
#[derive(InitSpace)]
pub struct Round {
    pub session_id: [u8; 16],
    pub round_no: u16,
    pub events_hash: [u8; 32],
    pub player_count: u8,
    pub awarded_count: u8,
    pub total_awarded: u64,
    pub attested_at: i64,
    pub bump: u8,
}

/// Receipt that a wallet was paid for a round. Its PDA can only be created once,
/// which is what stops a round from paying the same player twice.
#[account]
#[derive(InitSpace)]
pub struct Award {
    pub round: Pubkey,
    pub wallet: Pubkey,
    pub points: u64,
    pub connections: u32,
    pub bump: u8,
}

/// A game night's shared table goal: every coin awarded in the session fills
/// the pot, and once it reaches `goal` every player can claim the bonus.
#[account]
#[derive(InitSpace)]
pub struct Session {
    pub session_id: [u8; 16],
    pub goal: u64,
    pub pot: u64,
    pub bonus_per_player: u64,
    pub reached: bool,
    pub reached_at: i64,
    pub bonuses_claimed: u16,
    pub bump: u8,
}

/// A perk players can buy with TABLE. The game server fulfils it off chain.
#[account]
#[derive(InitSpace)]
pub struct Item {
    pub id: u16,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    pub price: u64,
    /// 0 = unlimited.
    pub supply: u32,
    pub sold: u32,
    pub min_level: u8,
    /// Free-form category for the frontend/hub (e.g. 0 = table perk, 1 = robot action).
    pub kind: u8,
    pub active: bool,
    pub bump: u8,
}

/// Proof of a redemption, numbered per player; `fulfilled` flips when the perk is delivered.
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub wallet: Pubkey,
    pub item: Pubkey,
    pub item_id: u16,
    pub price: u64,
    pub number: u16,
    pub created_at: i64,
    pub fulfilled: bool,
    pub bump: u8,
}

/// Kudos history for one (from, to) pair; also enforces the cooldown.
#[account]
#[derive(InitSpace)]
pub struct KudosLink {
    pub from: Pubkey,
    pub to: Pubkey,
    pub count: u32,
    pub total: u64,
    pub last_at: i64,
    pub bump: u8,
}

/// Marks that a wallet has claimed a session's table-goal bonus.
#[account]
#[derive(InitSpace)]
pub struct SessionBonus {
    pub session: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub bump: u8,
}
