use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::CenterpieceError,
    state::{Config, Round},
};

#[event]
pub struct RoundAttested {
    pub session_id: [u8; 16],
    pub round_no: u16,
    pub events_hash: [u8; 32],
    pub player_count: u8,
}

#[derive(Accounts)]
#[instruction(session_id: [u8; 16], round_no: u16)]
pub struct AttestRound<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,

    /// `init` fails if this round was already attested, so a round settles exactly once.
    #[account(
        init,
        payer = admin,
        space = 8 + Round::INIT_SPACE,
        seeds = [ROUND_SEED, session_id.as_ref(), &round_no.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, Round>,

    pub system_program: Program<'info, System>,
}

pub fn handle_attest_round(
    ctx: Context<AttestRound>,
    session_id: [u8; 16],
    round_no: u16,
    events_hash: [u8; 32],
    player_count: u8,
) -> Result<()> {
    require!(player_count > 0, CenterpieceError::EmptyRound);

    let round = &mut ctx.accounts.round;
    round.session_id = session_id;
    round.round_no = round_no;
    round.events_hash = events_hash;
    round.player_count = player_count;
    round.awarded_count = 0;
    round.total_awarded = 0;
    round.attested_at = Clock::get()?.unix_timestamp;
    round.bump = ctx.bumps.round;

    emit!(RoundAttested { session_id, round_no, events_hash, player_count });
    Ok(())
}
