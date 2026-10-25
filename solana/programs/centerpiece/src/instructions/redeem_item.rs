// Spends TABLE on a shop perk: the price is burned (a real coin sink), the
// item's stock goes down, and a numbered Receipt is written for the game
// server to fulfil.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, Burn, Mint, Token2022, TokenAccount};

use crate::{
    constants::*,
    error::CenterpieceError,
    progress::{self, Badge},
    state::{Config, Item, Player, Receipt},
    token_meta::MetaAccounts,
};

#[event]
pub struct ItemRedeemed {
    pub wallet: Pubkey,
    pub item: Pubkey,
    pub item_id: u16,
    pub kind: u8,
    pub price: u64,
    pub receipt: Pubkey,
    pub number: u16,
}

#[derive(Accounts)]
pub struct RedeemItem<'info> {
    /// The game admin acting for a custodial player, or the wallet itself. Pays rent.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = coin_mint)]
    pub config: Box<Account<'info, Config>>,

    /// CHECK: buyer wallet; must match `player`.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, wallet.key().as_ref()],
        bump = player.bump,
        has_one = wallet,
        has_one = badge_mint
    )]
    pub player: Box<Account<'info, Player>>,

    #[account(mut, seeds = [ITEM_SEED, &item.id.to_le_bytes()], bump = item.bump)]
    pub item: Box<Account<'info, Item>>,

    #[account(
        init,
        payer = authority,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, wallet.key().as_ref(), &player.redemptions.to_le_bytes()],
        bump
    )]
    pub receipt: Box<Account<'info, Receipt>>,

    #[account(mut)]
    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = coin_mint,
        associated_token::authority = wallet,
        associated_token::token_program = token_program,
    )]
    pub wallet_coin_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: the player's badge, checked by `has_one = badge_mint`.
    #[account(mut)]
    pub badge_mint: UncheckedAccount<'info>,

    /// CHECK: PDA signer; the coin's permanent delegate.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_redeem_item(ctx: Context<RedeemItem>) -> Result<()> {
    let a = &ctx.accounts;
    let signer = a.authority.key();
    require!(signer == a.config.admin || signer == a.wallet.key(), CenterpieceError::Unauthorized);
    require!(a.item.active, CenterpieceError::ItemInactive);
    require!(a.item.supply == 0 || a.item.sold < a.item.supply, CenterpieceError::SoldOut);
    require!(a.player.level >= a.item.min_level, CenterpieceError::LevelTooLow);

    let auth_seeds: &[&[&[u8]]] = &[&[MINT_AUTH_SEED, &[a.config.mint_auth_bump]]];
    let token_program = a.token_program.to_account_info();
    let mint_auth = a.mint_auth.to_account_info();
    let price = a.item.price;
    if price > 0 {
        burn(
            CpiContext::new(
                a.token_program.key(),
                Burn {
                    mint: a.coin_mint.to_account_info(),
                    from: a.wallet_coin_account.to_account_info(),
                    authority: mint_auth.clone(),
                },
            )
            .with_signer(auth_seeds),
            price,
        )?;
    }

    let payer = a.authority.to_account_info();
    let badge_mint = a.badge_mint.to_account_info();
    let wallet = a.wallet.key();

    let item = &mut ctx.accounts.item;
    item.sold = item.sold.checked_add(1).ok_or(CenterpieceError::Overflow)?;
    let (item_key, item_id, kind) = (item.key(), item.id, item.kind);

    let number = ctx.accounts.player.redemptions;
    let receipt = &mut ctx.accounts.receipt;
    receipt.wallet = wallet;
    receipt.item = item_key;
    receipt.item_id = item_id;
    receipt.price = price;
    receipt.number = number;
    receipt.created_at = Clock::get()?.unix_timestamp;
    receipt.fulfilled = false;
    receipt.bump = ctx.bumps.receipt;
    let receipt_key = receipt.key();

    let badge = Badge {
        meta: MetaAccounts { token_program: &token_program, mint: &badge_mint, authority: &mint_auth, signer_seeds: auth_seeds },
        payer: &payer,
    };
    let player = &mut ctx.accounts.player;
    player.redemptions = number.checked_add(1).ok_or(CenterpieceError::Overflow)?;
    progress::refresh(player, &badge)?;

    emit!(ItemRedeemed { wallet, item: item_key, item_id, kind, price, receipt: receipt_key, number });
    Ok(())
}
