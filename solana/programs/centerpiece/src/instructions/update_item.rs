use anchor_lang::prelude::*;

use crate::{
    constants::*,
    state::{Config, Item},
};

#[derive(Accounts)]
pub struct UpdateItem<'info> {
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [ITEM_SEED, &item.id.to_le_bytes()], bump = item.bump)]
    pub item: Box<Account<'info, Item>>,
}

/// Reprices, restocks, or pulls an item from sale. `supply` 0 means unlimited.
pub fn handle_update_item(ctx: Context<UpdateItem>, price: u64, supply: u32, min_level: u8, active: bool) -> Result<()> {
    let item = &mut ctx.accounts.item;
    item.price = price;
    item.supply = supply;
    item.min_level = min_level;
    item.active = active;
    Ok(())
}
