// One player thanks another with TABLE. The sender's own coins move (through the
// coin's permanent delegate, so custodial players work too), both profiles and
// the receiver's badge record it, and the first kudos between two people counts
// as a new connection for both.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, Token2022, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::CenterpieceError,
    progress::{self, Badge},
    state::{Config, KudosLink, Player},
    token_meta::MetaAccounts,
};

#[event]
pub struct KudosGiven {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub first_time: bool,
    pub kudos_received: u32,
}

#[derive(Accounts)]
pub struct GiveKudos<'info> {
    /// The game admin acting for a custodial player, or the sender signing for themselves. Pays rent.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = coin_mint)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: sender wallet; must match `from_player`.
    pub from: UncheckedAccount<'info>,

    /// CHECK: receiver wallet; must match `to_player`.
    pub to: UncheckedAccount<'info>,

    #[account(mut, seeds = [PLAYER_SEED, from.key().as_ref()], bump = from_player.bump)]
    pub from_player: Box<Account<'info, Player>>,

    #[account(mut, seeds = [PLAYER_SEED, to.key().as_ref()], bump = to_player.bump)]
    pub to_player: Box<Account<'info, Player>>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + KudosLink::INIT_SPACE,
        seeds = [KUDOS_SEED, from.key().as_ref(), to.key().as_ref()],
        bump
    )]
    pub link: Box<Account<'info, KudosLink>>,

    #[account(mut)]
    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = from,
        associated_token::token_program = token_program,
    )]
    pub from_coin_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = coin_mint,
        associated_token::authority = to,
        associated_token::token_program = token_program,
    )]
    pub to_coin_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: sender's badge mint.
    #[account(mut, address = from_player.badge_mint)]
    pub from_badge: UncheckedAccount<'info>,

    /// CHECK: receiver's badge mint.
    #[account(mut, address = to_player.badge_mint)]
    pub to_badge: UncheckedAccount<'info>,

    /// CHECK: PDA signer; the coin's permanent delegate.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_give_kudos(ctx: Context<GiveKudos>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    let signer = a.authority.key();
    require!(signer == a.config.admin || signer == a.from.key(), CenterpieceError::Unauthorized);
    require!(a.from.key() != a.to.key(), CenterpieceError::SelfKudos);
    require!(amount >= 1 && amount <= a.config.max_kudos, CenterpieceError::KudosTooLarge);

    let now = Clock::get()?.unix_timestamp;
    let first_time = a.link.count == 0;
    require!(
        first_time || now - a.link.last_at >= KUDOS_COOLDOWN_SECONDS,
        CenterpieceError::KudosCooldown
    );

    let auth_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[a.config.mint_auth_bump]]];
    let token_program = a.token_program.to_account_info();
    let mint_auth = a.mint_auth.to_account_info();
    transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.from_coin_account.to_account_info(),
                mint: a.coin_mint.to_account_info(),
                to: a.to_coin_account.to_account_info(),
                authority: mint_auth.clone(),
            },
        )
        .with_signer(auth_seeds),
        amount,
        a.coin_mint.decimals,
    )?;

    let (from_key, to_key) = (a.from.key(), a.to.key());
    let payer = a.authority.to_account_info();
    let from_badge_mint = a.from_badge.to_account_info();
    let to_badge_mint = a.to_badge.to_account_info();

    let link = &mut ctx.accounts.link;
    link.from = from_key;
    link.to = to_key;
    link.count = link.count.checked_add(1).ok_or(CenterpieceError::Overflow)?;
    link.total = link.total.checked_add(amount).ok_or(CenterpieceError::Overflow)?;
    link.last_at = now;
    link.bump = ctx.bumps.link;

    let from_badge = Badge {
        meta: MetaAccounts { token_program: &token_program, mint: &from_badge_mint, authority: &mint_auth, signer_seeds: auth_seeds },
        payer: &payer,
    };
    let sender = &mut ctx.accounts.from_player;
    sender.kudos_given = sender.kudos_given.checked_add(1).ok_or(CenterpieceError::Overflow)?;
    if first_time {
        progress::add_connections(sender, &from_badge, 1)?;
    }
    progress::refresh(sender, &from_badge)?;

    let to_badge = Badge {
        meta: MetaAccounts { token_program: &token_program, mint: &to_badge_mint, authority: &mint_auth, signer_seeds: auth_seeds },
        payer: &payer,
    };
    let receiver = &mut ctx.accounts.to_player;
    receiver.kudos_received = receiver.kudos_received.checked_add(1).ok_or(CenterpieceError::Overflow)?;
    to_badge.set("kudos", receiver.kudos_received)?;
    if first_time {
        progress::add_connections(receiver, &to_badge, 1)?;
    }
    progress::refresh(receiver, &to_badge)?;

    emit!(KudosGiven { from: from_key, to: to_key, amount, first_time, kudos_received: receiver.kudos_received });
    Ok(())
}
