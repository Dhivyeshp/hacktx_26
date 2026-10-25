use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CenterpieceError,
    state::{Config, Item},
};

#[event]
pub struct ItemListed {
    pub item: Pubkey,
    pub id: u16,
    pub name: String,
    pub price: u64,
}

#[derive(Accounts)]
#[instruction(id: u16)]
pub struct CreateItem<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    #[account(init, payer = admin, space = 8 + Item::INIT_SPACE, seeds = [ITEM_SEED, &id.to_le_bytes()], bump)]
    pub item: Box<Account<'info, Item>>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_item(
    ctx: Context<CreateItem>,
    id: u16,
    name: String,
    price: u64,
    supply: u32,
    min_level: u8,
    kind: u8,
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, CenterpieceError::StringTooLong);
    let item = &mut ctx.accounts.item;
    item.id = id;
    item.name = name.clone();
    item.price = price;
    item.supply = supply;
    item.sold = 0;
    item.min_level = min_level;
    item.kind = kind;
    item.active = true;
    item.bump = ctx.bumps.item;

    let config = &mut ctx.accounts.config;
    config.item_count = config.item_count.checked_add(1).ok_or(CenterpieceError::Overflow)?;
    emit!(ItemListed { item: item.key(), id, name, price });
    Ok(())
}
