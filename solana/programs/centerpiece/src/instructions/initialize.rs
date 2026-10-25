use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022};

use crate::{constants::*, error::CenterpieceError, state::Config, token_meta::*};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,

    /// CHECK: PDA used only as a signer; mint and metadata authority for every mint the program makes.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    /// The game coin. Only `mint_auth` can mint it, and only this program can sign as `mint_auth`.
    #[account(
        init,
        payer = admin,
        seeds = [COIN_SEED],
        bump,
        mint::decimals = 0,
        mint::authority = mint_auth,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = mint_auth,
        extensions::metadata_pointer::metadata_address = coin_mint,
        // Lets the program move or burn TABLE for kudos and shop redemptions,
        // which custodial players can't sign for. Only program rules can use it.
        extensions::permanent_delegate::delegate = mint_auth,
    )]
    pub coin_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    name: String,
    symbol: String,
    uri: String,
    max_award_per_round: u64,
    max_kudos: u64,
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, CenterpieceError::StringTooLong);
    require!(symbol.len() <= MAX_SYMBOL_LEN, CenterpieceError::StringTooLong);
    require!(uri.len() <= MAX_URI_LEN, CenterpieceError::StringTooLong);

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.coin_mint = ctx.accounts.coin_mint.key();
    config.max_award_per_round = max_award_per_round;
    config.max_kudos = max_kudos;
    config.keepsake_count = 0;
    config.player_count = 0;
    config.item_count = 0;
    config.bump = ctx.bumps.config;
    config.mint_auth_bump = ctx.bumps.mint_auth;

    let mint = ctx.accounts.coin_mint.to_account_info();
    let len = mint.data_len() + metadata_tlv_len(&name, &symbol, &uri, &[])?;
    fund_to_len(&ctx.accounts.admin.to_account_info(), &mint, len)?;

    let seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[ctx.bumps.mint_auth]]];
    init_metadata(
        &MetaAccounts {
            token_program: &ctx.accounts.token_program.to_account_info(),
            mint: &mint,
            authority: &ctx.accounts.mint_auth.to_account_info(),
            signer_seeds: seeds,
        },
        &name,
        &symbol,
        &uri,
        &[],
    )
}
