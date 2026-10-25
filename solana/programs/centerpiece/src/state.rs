use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// The game server's authority key; the only signer allowed to settle rounds.
    pub admin: Pubkey,
    pub coin_mint: Pubkey,
    pub max_award_per_round: u64,
    pub keepsake_count: u64,
    pub player_count: u64,
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
