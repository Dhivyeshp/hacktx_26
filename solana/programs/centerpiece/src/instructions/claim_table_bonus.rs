// Pays one player the table-goal bonus once the session's pot has reached its
// goal. The player proves they played by presenting one of their Award
// receipts from a round of this session.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, Token2022, TokenAccount};

use crate::{
    constants::*,
    error::CenterpieceError,
    progress::{self, Badge},
    state::{Award, Config, Player, Round, Session, SessionBonus},
    token_meta::MetaAccounts,
};

#[event]
pub struct TableBonusClaimed {
    pub session: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[derive(Accounts)]
pub struct ClaimTableBonus<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin, has_one = coin_mint)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [SESSION_SEED, session.session_id.as_ref()], bump = session.bump)]
    pub session: Box<Account<'info, Session>>,

    #[account(
        seeds = [ROUND_SEED, round.session_id.as_ref(), &round.round_no.to_le_bytes()],
        bump = round.bump,
        constraint = round.session_id == session.session_id @ CenterpieceError::NotInSession
    )]
    pub round: Box<Account<'info, Round>>,

    #[account(
        seeds = [AWARD_SEED, round.key().as_ref(), wallet.key().as_ref()],
        bump = award.bump,
        constraint = award.wallet == wallet.key() @ CenterpieceError::NotInSession
    )]
    pub award: Box<Account<'info, Award>>,

    /// CHECK: the player's wallet; must match `player` and `award`.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, wallet.key().as_ref()],
        bump = player.bump,
        has_one = wallet,
        has_one = badge_mint
    )]
    pub player: Box<Account<'info, Player>>,

    /// `init` makes the bonus claimable once per wallet per session.
    #[account(
        init,
        payer = admin,
        space = 8 + SessionBonus::INIT_SPACE,
        seeds = [BONUS_SEED, session.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub bonus: Box<Account<'info, SessionBonus>>,

    #[account(mut)]
    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = coin_mint,
        associated_token::authority = wallet,
        associated_token::token_program = token_program,
    )]
    pub wallet_coin_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: the player's badge, checked by `has_one = badge_mint`.
    #[account(mut)]
    pub badge_mint: UncheckedAccount<'info>,

    /// CHECK: PDA signer.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim_table_bonus(ctx: Context<ClaimTableBonus>) -> Result<()> {
    require!(ctx.accounts.session.reached, CenterpieceError::GoalNotReached);
    let amount = ctx.accounts.session.bonus_per_player;

    let auth_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[ctx.accounts.config.mint_auth_bump]]];
    let token_program = ctx.accounts.token_program.to_account_info();
    let mint_auth = ctx.accounts.mint_auth.to_account_info();
    if amount > 0 {
        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.coin_mint.to_account_info(),
                    to: ctx.accounts.wallet_coin_account.to_account_info(),
                    authority: mint_auth.clone(),
                },
            )
            .with_signer(auth_seeds),
            amount,
        )?;
    }

    let session_key = ctx.accounts.session.key();
    let wallet = ctx.accounts.wallet.key();
    let session = &mut ctx.accounts.session;
    session.bonuses_claimed = session.bonuses_claimed.checked_add(1).ok_or(CenterpieceError::Overflow)?;

    let bonus = &mut ctx.accounts.bonus;
    bonus.session = session_key;
    bonus.wallet = wallet;
    bonus.amount = amount;
    bonus.bump = ctx.bumps.bonus;

    let badge_mint = ctx.accounts.badge_mint.to_account_info();
    let admin = ctx.accounts.admin.to_account_info();
    let badge = Badge {
        meta: MetaAccounts { token_program: &token_program, mint: &badge_mint, authority: &mint_auth, signer_seeds: auth_seeds },
        payer: &admin,
    };
    let player = &mut ctx.accounts.player;
    progress::add_xp(player, &badge, amount)?;
    let bits = ACH_TEAM_PLAYER | progress::earned(player);
    progress::unlock(player, &badge, bits)?;

    emit!(TableBonusClaimed { session: session_key, wallet, amount });
    Ok(())
}
