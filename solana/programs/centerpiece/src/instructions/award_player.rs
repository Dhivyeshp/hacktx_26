// Pays a player for one round: mints TABLE coin to their wallet, adds xp and
// connections to their profile, rewrites the live fields on their badge, and
// (when the session has a table goal) fills the shared pot.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, Token2022, TokenAccount};

use crate::{
    constants::*,
    error::CenterpieceError,
    progress::{self, Badge},
    state::{Award, Config, Player, Round, Session},
    token_meta::MetaAccounts,
};

#[event]
pub struct Awarded {
    pub wallet: Pubkey,
    pub round: Pubkey,
    pub points: u64,
    pub xp: u64,
    pub level: u8,
    pub leveled_up: bool,
}

#[event]
pub struct TableGoalReached {
    pub session: Pubkey,
    pub session_id: [u8; 16],
    pub goal: u64,
    pub pot: u64,
}

#[derive(Accounts)]
pub struct AwardPlayer<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin, has_one = coin_mint)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [ROUND_SEED, round.session_id.as_ref(), &round.round_no.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Box<Account<'info, Round>>,

    /// The round's session, when it has a table goal. Omit for sessions without one.
    #[account(mut, seeds = [SESSION_SEED, round.session_id.as_ref()], bump = session.bump)]
    pub session: Option<Box<Account<'info, Session>>>,

    /// CHECK: the player's wallet; must match the Player PDA seeds.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, wallet.key().as_ref()],
        bump = player.bump,
        has_one = wallet,
        has_one = badge_mint
    )]
    pub player: Box<Account<'info, Player>>,

    /// One receipt per (round, wallet): a second award for the same round fails here.
    #[account(
        init,
        payer = admin,
        space = 8 + Award::INIT_SPACE,
        seeds = [AWARD_SEED, round.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub award: Box<Account<'info, Award>>,

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

    /// CHECK: the player's badge mint, checked by `has_one = badge_mint` on `player`.
    #[account(mut)]
    pub badge_mint: UncheckedAccount<'info>,

    /// CHECK: PDA signer.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_award_player(ctx: Context<AwardPlayer>, points: u64, connections: u32) -> Result<()> {
    require!(points <= ctx.accounts.config.max_award_per_round, CenterpieceError::AwardTooLarge);
    let round = &mut ctx.accounts.round;
    require!(round.awarded_count < round.player_count, CenterpieceError::RoundFullyAwarded);
    round.awarded_count += 1;
    round.total_awarded = round.total_awarded.checked_add(points).ok_or(CenterpieceError::Overflow)?;

    let auth_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[ctx.accounts.config.mint_auth_bump]]];
    let mint_auth = ctx.accounts.mint_auth.to_account_info();

    if points > 0 {
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
            points,
        )?;
    }

    if let Some(session) = ctx.accounts.session.as_mut() {
        session.pot = session.pot.checked_add(points).ok_or(CenterpieceError::Overflow)?;
        if !session.reached && session.pot >= session.goal {
            session.reached = true;
            session.reached_at = Clock::get()?.unix_timestamp;
            emit!(TableGoalReached {
                session: session.key(),
                session_id: session.session_id,
                goal: session.goal,
                pot: session.pot,
            });
        }
    }

    let award = &mut ctx.accounts.award;
    award.round = ctx.accounts.round.key();
    award.wallet = ctx.accounts.wallet.key();
    award.points = points;
    award.connections = connections;
    award.bump = ctx.bumps.award;

    let token_program = ctx.accounts.token_program.to_account_info();
    let badge_mint = ctx.accounts.badge_mint.to_account_info();
    let admin = ctx.accounts.admin.to_account_info();
    let badge = Badge {
        meta: MetaAccounts { token_program: &token_program, mint: &badge_mint, authority: &mint_auth, signer_seeds: auth_seeds },
        payer: &admin,
    };

    let player = &mut ctx.accounts.player;
    player.rounds_played = player.rounds_played.checked_add(1).ok_or(CenterpieceError::Overflow)?;
    let leveled_up = progress::add_xp(player, &badge, points)?;
    progress::add_connections(player, &badge, connections)?;
    progress::refresh(player, &badge)?;

    emit!(Awarded {
        wallet: player.wallet,
        round: ctx.accounts.round.key(),
        points,
        xp: player.xp,
        level: player.level,
        leveled_up,
    });
    Ok(())
}
