use anchor_lang::prelude::*;

use crate::{
    constants::*,
    state::{Config, Receipt},
};

#[event]
pub struct ReceiptFulfilled {
    pub receipt: Pubkey,
    pub wallet: Pubkey,
    pub item_id: u16,
}

#[derive(Accounts)]
pub struct FulfillReceipt<'info> {
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [RECEIPT_SEED, receipt.wallet.as_ref(), &receipt.number.to_le_bytes()],
        bump = receipt.bump
    )]
    pub receipt: Box<Account<'info, Receipt>>,
}

/// Marks a perk as delivered (e.g. the robot did its victory spin).
pub fn handle_fulfill_receipt(ctx: Context<FulfillReceipt>) -> Result<()> {
    let receipt = &mut ctx.accounts.receipt;
    receipt.fulfilled = true;
    emit!(ReceiptFulfilled { receipt: receipt.key(), wallet: receipt.wallet, item_id: receipt.item_id });
    Ok(())
}
