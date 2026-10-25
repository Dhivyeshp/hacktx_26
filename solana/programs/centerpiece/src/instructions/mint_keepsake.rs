// Mints a 1-of-1, transferable keepsake NFT for a moment in a round (a Forge
// creation, a Golden capsule, a completed Bounty). The art lives at `uri`; the
// challenge, session and round are stored as on-chain metadata fields.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;
use anchor_spl::token_interface::{mint_to, set_authority, Mint, MintTo, SetAuthority, Token2022, TokenAccount};

use crate::{
    constants::*,
    error::CenterpieceError,
    state::{Config, Player, Round},
    token_meta::*,
};

#[event]
pub struct KeepsakeMinted {
    pub wallet: Pubkey,
    pub mint: Pubkey,
    pub round: Pubkey,
    pub number: u64,
}

#[derive(Accounts)]
pub struct MintKeepsake<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,

    #[account(seeds = [ROUND_SEED, round.session_id.as_ref(), &round.round_no.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,

    /// CHECK: recipient wallet; must be a registered player.
    pub wallet: UncheckedAccount<'info>,

    #[account(seeds = [PLAYER_SEED, wallet.key().as_ref()], bump = player.bump, has_one = wallet)]
    pub player: Account<'info, Player>,

    #[account(
        init,
        payer = admin,
        seeds = [KEEPSAKE_SEED, &config.keepsake_count.to_le_bytes()],
        bump,
        mint::decimals = 0,
        mint::authority = mint_auth,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = mint_auth,
        extensions::metadata_pointer::metadata_address = keepsake_mint,
    )]
    pub keepsake_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = keepsake_mint,
        associated_token::authority = wallet,
        associated_token::token_program = token_program,
    )]
    pub keepsake_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: PDA signer.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn handle_mint_keepsake(
    ctx: Context<MintKeepsake>,
    name: String,
    uri: String,
    image: String,
    challenge: String,
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, CenterpieceError::StringTooLong);
    require!(uri.len() <= MAX_URI_LEN, CenterpieceError::StringTooLong);
    require!(image.len() <= MAX_URI_LEN, CenterpieceError::StringTooLong);
    require!(challenge.len() <= MAX_CHALLENGE_LEN, CenterpieceError::StringTooLong);

    let number = ctx.accounts.config.keepsake_count;
    let round = &ctx.accounts.round;
    let fields = [
        ("image", image),
        ("challenge", challenge),
        ("session", hex(&round.session_id)),
        ("round", round.round_no.to_string()),
        ("number", (number + 1).to_string()),
    ];

    let token_program = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.keepsake_mint.to_account_info();
    let mint_auth = ctx.accounts.mint_auth.to_account_info();
    let auth_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[ctx.accounts.config.mint_auth_bump]]];

    let len = mint.data_len() + metadata_tlv_len(&name, KEEPSAKE_SYMBOL, &uri, &fields)?;
    fund_to_len(&ctx.accounts.admin.to_account_info(), &mint, len)?;
    init_metadata(
        &MetaAccounts { token_program: &token_program, mint: &mint, authority: &mint_auth, signer_seeds: auth_seeds },
        &name,
        KEEPSAKE_SYMBOL,
        &uri,
        &fields,
    )?;

    mint_to(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            MintTo { mint: mint.clone(), to: ctx.accounts.keepsake_account.to_account_info(), authority: mint_auth.clone() },
        )
        .with_signer(auth_seeds),
        1,
    )?;
    set_authority(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            SetAuthority { current_authority: mint_auth.clone(), account_or_mint: mint.clone() },
        )
        .with_signer(auth_seeds),
        AuthorityType::MintTokens,
        None,
    )?;

    ctx.accounts.config.keepsake_count = number + 1;
    emit!(KeepsakeMinted {
        wallet: ctx.accounts.wallet.key(),
        mint: mint.key(),
        round: ctx.accounts.round.key(),
        number: number + 1,
    });
    Ok(())
}
