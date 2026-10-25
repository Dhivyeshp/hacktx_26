// Player progression shared by every instruction that changes a profile: xp and
// level, and achievements. Each change is mirrored onto the player's badge
// metadata so wallets and explorers show the live numbers.
use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CenterpieceError,
    state::Player,
    token_meta::{update_field, MetaAccounts},
};

#[event]
pub struct AchievementUnlocked {
    pub wallet: Pubkey,
    /// Bits unlocked by this transaction.
    pub unlocked: u32,
    /// The player's full mask afterwards.
    pub achievements: u32,
}

/// A player's badge mint plus who pays for metadata growth.
pub struct Badge<'a, 'info> {
    pub meta: MetaAccounts<'a, 'info>,
    pub payer: &'a AccountInfo<'info>,
}

impl Badge<'_, '_> {
    pub fn set(&self, key: &str, value: impl ToString) -> Result<()> {
        update_field(&self.meta, self.payer, key, value.to_string())
    }
}

/// Achievements a player qualifies for from their on-chain stats alone.
pub fn earned(p: &Player) -> u32 {
    let mut bits = 0;
    if p.rounds_played >= 1 {
        bits |= ACH_FIRST_ROUND;
    }
    if p.connections >= 1 {
        bits |= ACH_FIRST_CONNECTION;
    }
    if p.connections >= SOCIAL_BUTTERFLY_CONNECTIONS {
        bits |= ACH_SOCIAL_BUTTERFLY;
    }
    if p.level >= 3 {
        bits |= ACH_LEVEL_3;
    }
    if p.level >= 5 {
        bits |= ACH_LEVEL_5;
    }
    if p.kudos_given >= GENEROUS_KUDOS {
        bits |= ACH_GENEROUS;
    }
    if p.kudos_received >= APPRECIATED_KUDOS {
        bits |= ACH_APPRECIATED;
    }
    if p.keepsakes >= COLLECTOR_KEEPSAKES {
        bits |= ACH_COLLECTOR;
    }
    if p.redemptions >= 1 {
        bits |= ACH_SHOPPER;
    }
    bits
}

/// Adds xp (and lifetime coins), rewriting the badge's xp and, on level-up, level.
pub fn add_xp(p: &mut Player, badge: &Badge, points: u64) -> Result<bool> {
    if points == 0 {
        return Ok(false);
    }
    p.xp = p.xp.checked_add(points).ok_or(CenterpieceError::Overflow)?;
    p.coins_earned = p.coins_earned.checked_add(points).ok_or(CenterpieceError::Overflow)?;
    let level = level_for_xp(p.xp);
    let leveled_up = level != p.level;
    p.level = level;
    badge.set("xp", p.xp)?;
    if leveled_up {
        badge.set("level", level)?;
    }
    Ok(leveled_up)
}

pub fn add_connections(p: &mut Player, badge: &Badge, n: u32) -> Result<()> {
    if n == 0 {
        return Ok(());
    }
    p.connections = p.connections.checked_add(n).ok_or(CenterpieceError::Overflow)?;
    badge.set("connections", p.connections)
}

/// Sets `bits`, emitting and updating the badge only for bits that are new.
pub fn unlock(p: &mut Player, badge: &Badge, bits: u32) -> Result<u32> {
    let new = bits & !p.achievements;
    if new != 0 {
        p.achievements |= new;
        badge.set("achievements", p.achievements.count_ones())?;
        emit!(AchievementUnlocked { wallet: p.wallet, unlocked: new, achievements: p.achievements });
    }
    Ok(new)
}

/// Unlocks every automatic achievement the player now qualifies for.
pub fn refresh(p: &mut Player, badge: &Badge) -> Result<u32> {
    let bits = earned(p);
    unlock(p, badge, bits)
}
