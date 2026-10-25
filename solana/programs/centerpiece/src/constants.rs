pub const CONFIG_SEED: &[u8] = b"config";
pub const COIN_SEED: &[u8] = b"coin";
pub const MINT_AUTH_SEED: &[u8] = b"mint_auth";
pub const PLAYER_SEED: &[u8] = b"player";
pub const BADGE_SEED: &[u8] = b"badge";
pub const ROUND_SEED: &[u8] = b"round";
pub const AWARD_SEED: &[u8] = b"award";
pub const KEEPSAKE_SEED: &[u8] = b"keepsake";

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_CHALLENGE_LEN: usize = 24;

pub const BADGE_NAME: &str = "Centerpiece Player";
pub const BADGE_SYMBOL: &str = "CPPLAYER";
pub const KEEPSAKE_SYMBOL: &str = "CPKEEP";

/// Level 1 at 0 xp, 2 at 10, 3 at 40, 4 at 90, 5 at 160: level = 1 + sqrt(xp / 10).
pub fn level_for_xp(xp: u64) -> u8 {
    let level = 1 + (xp / 10).isqrt();
    level.min(u8::MAX as u64) as u8
}
