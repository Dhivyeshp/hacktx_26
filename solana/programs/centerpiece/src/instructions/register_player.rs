// Creates a player's on-chain profile and mints their soulbound badge: a
// Token-2022 NFT with NonTransferable + MetadataPointer and live "level", "xp"
// and "connections" fields that award_player keeps up to date.
use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::associated_token::{create, AssociatedToken, Create};
use anchor_spl::token_2022::spl_token_2022::{
    extension::ExtensionType, instruction::AuthorityType, pod::PodMint,
};
use anchor_spl::token_interface::{
    initialize_mint2, metadata_pointer_initialize, mint_to, non_transferable_mint_initialize,
    set_authority, InitializeMint2, MetadataPointerInitialize, MintTo, NonTransferableMintInitialize,
    SetAuthority, Token2022,
};

use crate::{
    constants::*,
    error::CenterpieceError,
    state::{Config, Player},
    token_meta::*,
};

#[event]
pub struct PlayerRegistered {
    pub wallet: Pubkey,
    pub badge_mint: Pubkey,
}

#[derive(Accounts)]
pub struct RegisterPlayer<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,

    /// CHECK: any wallet address; the badge and coins are minted to it, it never signs.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Player::INIT_SPACE,
        seeds = [PLAYER_SEED, wallet.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,

    /// CHECK: created and initialized in the handler (Anchor has no NonTransferable constraint).
    #[account(mut, seeds = [BADGE_SEED, wallet.key().as_ref()], bump)]
    pub badge_mint: UncheckedAccount<'info>,

    /// CHECK: the wallet's associated token account for the badge; the ATA program verifies the address.
    #[account(mut)]
    pub badge_ata: UncheckedAccount<'info>,

    /// CHECK: PDA signer.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_player(ctx: Context<RegisterPlayer>, uri: String) -> Result<()> {
    require!(uri.len() <= MAX_URI_LEN, CenterpieceError::StringTooLong);

    let a = &ctx.accounts;
    let token_program = a.token_program.to_account_info();
    let mint = a.badge_mint.to_account_info();
    let mint_auth = a.mint_auth.to_account_info();
    let wallet_key = a.wallet.key();
    let auth_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[a.config.mint_auth_bump]]];
    let badge_seeds: &[&[&[u8]]] = &[&[BADGE_SEED, wallet_key.as_ref(), &[ctx.bumps.badge_mint]]];

    let fields = [
        ("level", "1".to_string()),
        ("xp", "0".to_string()),
        ("connections", "0".to_string()),
    ];
    let mint_len = ExtensionType::try_calculate_account_len::<PodMint>(&[
        ExtensionType::NonTransferable,
        ExtensionType::MetadataPointer,
    ])?;
    let full_len = mint_len + metadata_tlv_len(BADGE_NAME, BADGE_SYMBOL, &uri, &fields)?;

    create_account(
        CpiContext::new(
            a.system_program.key(),
            CreateAccount { from: a.admin.to_account_info(), to: mint.clone() },
        )
        .with_signer(badge_seeds),
        Rent::get()?.minimum_balance(full_len),
        mint_len as u64,
        &a.token_program.key(),
    )?;
    // Extensions must be initialized before the mint itself.
    non_transferable_mint_initialize(CpiContext::new(
        a.token_program.key(),
        NonTransferableMintInitialize { token_program_id: token_program.clone(), mint: mint.clone() },
    ))?;
    metadata_pointer_initialize(
        CpiContext::new(
            a.token_program.key(),
            MetadataPointerInitialize { token_program_id: token_program.clone(), mint: mint.clone() },
        ),
        Some(mint_auth.key()),
        Some(mint.key()),
    )?;
    initialize_mint2(
        CpiContext::new(a.token_program.key(), InitializeMint2 { mint: mint.clone() }),
        0,
        &mint_auth.key(),
        None,
    )?;

    let meta = MetaAccounts {
        token_program: &token_program,
        mint: &mint,
        authority: &mint_auth,
        signer_seeds: auth_seeds,
    };
    init_metadata(&meta, BADGE_NAME, BADGE_SYMBOL, &uri, &fields)?;

    create(CpiContext::new(
        a.associated_token_program.key(),
        Create {
            payer: a.admin.to_account_info(),
            associated_token: a.badge_ata.to_account_info(),
            authority: a.wallet.to_account_info(),
            mint: mint.clone(),
            system_program: a.system_program.to_account_info(),
            token_program: token_program.clone(),
        },
    ))?;
    mint_to(
        CpiContext::new(
            a.token_program.key(),
            MintTo { mint: mint.clone(), to: a.badge_ata.to_account_info(), authority: mint_auth.clone() },
        )
        .with_signer(auth_seeds),
        1,
    )?;
    // Supply is fixed at 1. Metadata stays updatable through the separate update authority.
    set_authority(
        CpiContext::new(
            a.token_program.key(),
            SetAuthority { current_authority: mint_auth.clone(), account_or_mint: mint.clone() },
        )
        .with_signer(auth_seeds),
        AuthorityType::MintTokens,
        None,
    )?;

    let player = &mut ctx.accounts.player;
    player.wallet = wallet_key;
    player.badge_mint = mint.key();
    player.xp = 0;
    player.coins_earned = 0;
    player.connections = 0;
    player.rounds_played = 0;
    player.level = 1;
    player.bump = ctx.bumps.player;

    let config = &mut ctx.accounts.config;
    config.player_count = config.player_count.checked_add(1).ok_or(CenterpieceError::Overflow)?;

    emit!(PlayerRegistered { wallet: wallet_key, badge_mint: mint.key() });
    Ok(())
}
