use anchor_lang::prelude::*;

use crate::{
    constants::*,
    state::{Config, Session},
};

#[event]
pub struct SessionOpened {
    pub session: Pubkey,
    pub session_id: [u8; 16],
    pub goal: u64,
    pub bonus_per_player: u64,
}

#[derive(Accounts)]
#[instruction(session_id: [u8; 16])]
pub struct OpenSession<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = admin,
        space = 8 + Session::INIT_SPACE,
        seeds = [SESSION_SEED, session_id.as_ref()],
        bump
    )]
    pub session: Box<Account<'info, Session>>,

    pub system_program: Program<'info, System>,
}

/// Starts a game night with a shared table goal: when the coins awarded across
/// all its rounds reach `goal`, every player can claim `bonus_per_player`.
pub fn handle_open_session(ctx: Context<OpenSession>, session_id: [u8; 16], goal: u64, bonus_per_player: u64) -> Result<()> {
    let session = &mut ctx.accounts.session;
    session.session_id = session_id;
    session.goal = goal;
    session.pot = 0;
    session.bonus_per_player = bonus_per_player;
    session.reached = false;
    session.reached_at = 0;
    session.bonuses_claimed = 0;
    session.bump = ctx.bumps.session;
    emit!(SessionOpened { session: session.key(), session_id, goal, bonus_per_player });
    Ok(())
}
