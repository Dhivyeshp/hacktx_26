use anchor_lang::prelude::*;
use anchor_spl::token_interface::Token2022;

use crate::{
    constants::*,
    error::CenterpieceError,
    progress::{self, Badge},
    state::{Config, Player},
    token_meta::MetaAccounts,
};

#[derive(Accounts)]
pub struct GrantAchievement<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: the player's wallet; must match `player`.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, wallet.key().as_ref()],
        bump = player.bump,
        has_one = wallet,
        has_one = badge_mint
    )]
    pub player: Box<Account<'info, Player>>,

    /// CHECK: the player's badge, checked by `has_one = badge_mint`.
    #[account(mut)]
    pub badge_mint: UncheckedAccount<'info>,

    /// CHECK: PDA signer.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

/// Awards a server-judged achievement (quiet hero, bounty hunter, duel champion,
/// golden grab, ...). Bits below 16 are reserved for stats-based achievements.
pub fn handle_grant_achievement(ctx: Context<GrantAchievement>, bit: u8) -> Result<()> {
    require!(
        (FIRST_GRANTABLE_ACHIEVEMENT_BIT..32).contains(&bit),
        CenterpieceError::ReservedAchievement
    );
    let auth_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[ctx.accounts.config.mint_auth_bump]]];
    let token_program = ctx.accounts.token_program.to_account_info();
    let mint_auth = ctx.accounts.mint_auth.to_account_info();
    let badge_mint = ctx.accounts.badge_mint.to_account_info();
    let admin = ctx.accounts.admin.to_account_info();
    let badge = Badge {
        meta: MetaAccounts { token_program: &token_program, mint: &badge_mint, authority: &mint_auth, signer_seeds: auth_seeds },
        payer: &admin,
    };
    progress::unlock(&mut ctx.accounts.player, &badge, 1u32 << bit)?;
    Ok(())
}
