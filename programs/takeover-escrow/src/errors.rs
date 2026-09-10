use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Listing is not in the required state for this action")]
    BadStatus,
    #[msg("Only the seller may do this")]
    NotSeller,
    #[msg("Only the buyer may do this")]
    NotBuyer,
    #[msg("Only the arbitrator may do this")]
    NotArbitrator,
    #[msg("A seller cannot buy their own listing")]
    SelfPurchase,
    #[msg("Price must be greater than zero")]
    ZeroPrice,
    #[msg("Fee is above the hard cap")]
    FeeTooHigh,
    #[msg("Delivery window must be between 1 and 90 days")]
    BadDeliveryWindow,
    #[msg("Pick at least one authority to sell")]
    NoAuthorities,
    #[msg("That authority is not part of this listing")]
    AuthorityNotListed,
    #[msg("That authority is already in escrow")]
    AuthorityAlreadyEscrowed,
    #[msg("Not every promised authority is in escrow yet")]
    AuthoritiesIncomplete,
    #[msg("This action is only valid for a token authority listing")]
    NotTokenListing,
    #[msg("This action is only valid for an escrowed-funds listing")]
    NotEscrowListing,
    #[msg("Mint does not match the one this listing was created for")]
    MintMismatch,
    #[msg("Token-2022 mints are not supported yet")]
    UnsupportedTokenProgram,
    #[msg("Metadata account is not the canonical PDA for this mint")]
    BadMetadataAccount,
    #[msg("The Metaplex Token Metadata program account must be supplied")]
    MissingMetadataProgram,
    #[msg("Treasury account does not match the configured treasury")]
    BadTreasury,
    #[msg("The delivery deadline has not passed yet")]
    DeadlineNotReached,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Listing account does not hold the expected escrow balance")]
    EscrowBalanceMismatch,
    #[msg("Cannot close a listing that is still live")]
    ListingStillLive,
    #[msg("This offer is no longer open")]
    OfferNotOpen,
    #[msg("This offer has expired")]
    OfferExpired,
    #[msg("This offer has not expired yet")]
    OfferNotExpired,
    #[msg("Only the buyer may withdraw their own offer")]
    NotOfferBuyer,
    #[msg("A buyer cannot accept their own offer")]
    SelfAccept,
    #[msg("Offer must last between 1 and 90 days")]
    BadOfferWindow,
    #[msg("That key is already the authority")]
    AlreadyAuthority,
    #[msg("No successor has been nominated")]
    NoNomination,
    #[msg("Only the nominated successor may accept")]
    NotNominated,
}
