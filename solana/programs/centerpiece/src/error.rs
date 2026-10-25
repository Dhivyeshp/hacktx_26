use anchor_lang::prelude::*;

#[error_code]
pub enum CenterpieceError {
    #[msg("Award exceeds the per-round cap")]
    AwardTooLarge,
    #[msg("Every player attested for this round has already been paid")]
    RoundFullyAwarded,
    #[msg("A round must have at least one player")]
    EmptyRound,
    #[msg("String is too long")]
    StringTooLong,
    #[msg("Arithmetic overflow")]
    Overflow,
}
