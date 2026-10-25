use anchor_lang::prelude::*;

// v2 seeds: account layouts and the coin mint changed in v2, so every PDA moved
// to a fresh namespace. v1 accounts from the first devnet deploy are ignored.
#[constant]
pub const CONFIG_SEED: &[u8] = b"config_v2";
#[constant]
pub const COIN_SEED: &[u8] = b"coin_v2";
#[constant]
pub const MINT_AUTH_SEED: &[u8] = b"mint_auth";
#[constant]
pub const PLAYER_SEED: &[u8] = b"player_v2";
#[constant]
pub const BADGE_SEED: &[u8] = b"badge_v2";
#[constant]
pub const ROUND_SEED: &[u8] = b"round_v2";
#[constant]
pub const AWARD_SEED: &[u8] = b"award_v2";
#[constant]
pub const KEEPSAKE_SEED: &[u8] = b"keepsake_v2";
#[constant]
pub const SESSION_SEED: &[u8] = b"session_v2";
#[constant]
pub const ITEM_SEED: &[u8] = b"item_v2";
#[constant]
pub const RECEIPT_SEED: &[u8] = b"receipt_v2";
#[constant]
pub const KUDOS_SEED: &[u8] = b"kudos_v2";
#[constant]
pub const BONUS_SEED: &[u8] = b"bonus_v2";

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_CHALLENGE_LEN: usize = 24;

pub const BADGE_NAME: &str = "Centerpiece Player";
pub const BADGE_SYMBOL: &str = "CPPLAYER";
pub const KEEPSAKE_SYMBOL: &str = "CPKEEP";

/// Minimum seconds between two kudos from the same sender to the same receiver.
#[constant]
pub const KUDOS_COOLDOWN_SECONDS: i64 = 60;

// Achievements are bits in Player.achievements. Bits 0-15 are earned
// automatically from on-chain stats; 16-31 are granted by the game server for
// moments only it can see (and only through grant_achievement).
#[constant]
pub const ACH_FIRST_ROUND: u32 = 1 << 0;
#[constant]
pub const ACH_FIRST_CONNECTION: u32 = 1 << 1;
#[constant]
pub const ACH_SOCIAL_BUTTERFLY: u32 = 1 << 2;
#[constant]
pub const ACH_LEVEL_3: u32 = 1 << 3;
#[constant]
pub const ACH_LEVEL_5: u32 = 1 << 4;
#[constant]
pub const ACH_GENEROUS: u32 = 1 << 5;
#[constant]
pub const ACH_APPRECIATED: u32 = 1 << 6;
#[constant]
pub const ACH_COLLECTOR: u32 = 1 << 7;
#[constant]
pub const ACH_SHOPPER: u32 = 1 << 8;
#[constant]
pub const ACH_TEAM_PLAYER: u32 = 1 << 9;
#[constant]
pub const FIRST_GRANTABLE_ACHIEVEMENT_BIT: u8 = 16;

pub const SOCIAL_BUTTERFLY_CONNECTIONS: u32 = 10;
pub const GENEROUS_KUDOS: u32 = 5;
pub const APPRECIATED_KUDOS: u32 = 5;
pub const COLLECTOR_KEEPSAKES: u16 = 3;

/// Level 1 at 0 xp, 2 at 10, 3 at 40, 4 at 90, 5 at 160: level = 1 + sqrt(xp / 10).
pub fn level_for_xp(xp: u64) -> u8 {
    let level = 1 + (xp / 10).isqrt();
    level.min(u8::MAX as u64) as u8
}
