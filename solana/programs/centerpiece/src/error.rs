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
    #[msg("Signer must be the game admin or the wallet itself")]
    Unauthorized,
    #[msg("You can't send kudos to yourself")]
    SelfKudos,
    #[msg("Kudos must be between 1 and the configured maximum")]
    KudosTooLarge,
    #[msg("Wait a minute before sending this person kudos again")]
    KudosCooldown,
    #[msg("This item isn't for sale right now")]
    ItemInactive,
    #[msg("This item is sold out")]
    SoldOut,
    #[msg("Your level is too low for this item")]
    LevelTooLow,
    #[msg("The table hasn't reached its goal yet")]
    GoalNotReached,
    #[msg("This wallet wasn't paid in this session")]
    NotInSession,
    #[msg("Achievements below bit 16 are earned automatically, not granted")]
    ReservedAchievement,
}
