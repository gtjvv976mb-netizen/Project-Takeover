use anchor_lang::prelude::*;

/// Which authorities a token listing covers. Bit flags so one byte carries the set.
pub const AUTH_MINT: u8 = 1 << 0;
pub const AUTH_FREEZE: u8 = 1 << 1;
pub const AUTH_METADATA: u8 = 1 << 2;
pub const AUTH_ALL: u8 = AUTH_MINT | AUTH_FREEZE | AUTH_METADATA;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// SPL mint / freeze / metadata authority. Settles atomically, never escrows money.
    TokenAuthority,
    /// pump.fun creator role. Money is escrowed; handover happens off-program.
    PumpCreator,
    /// A whole project, site or community. Money is escrowed; delivery is confirmed.
    Offchain,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    /// Created, but the authorities it promises are not in the program's custody yet.
    Draft,
    /// Purchasable.
    Active,
    /// A buyer's money is held by this account.
    Funded,
    /// Settled. The seller has been paid.
    Completed,
    /// Withdrawn by the seller before any sale.
    Cancelled,
    /// Frozen pending arbitration.
    Disputed,
    /// The buyer got their money back.
    Refunded,
}

#[account]
pub struct Config {
    /// May rotate the arbitrator, treasury and default fee. Cannot touch listing funds.
    pub authority: Pubkey,
    /// May only choose a winner on a disputed listing. Cannot redirect funds.
    pub arbitrator: Pubkey,
    /// Receives the platform fee.
    pub treasury: Pubkey,
    /// Default fee for new listings, in basis points.
    pub fee_bps: u16,
    pub bump: u8,
    /// Nominated successor, or default if there is none pending.
    ///
    /// Handover is two steps on purpose. `authority` is the only key that can ever
    /// change the fee, the treasury or the arbitrator, and a one-step transfer typed
    /// slightly wrong would hand it to an address nobody controls, freezing all three
    /// for good. Making the successor sign proves the key exists before it takes over.
    pub pending_authority: Pubkey,
}

impl Config {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 2 + 1 + 32 + 16;
}

#[account]
pub struct Listing {
    pub seller: Pubkey,
    /// Set when funded or bought. Default until then.
    pub buyer: Pubkey,
    /// The SPL mint for token and pump listings. Default for off-chain listings.
    pub mint: Pubkey,
    /// Client-chosen id, part of this account's address.
    pub listing_id: [u8; 16],
    pub price: u64,
    /// Frozen at creation, so a fee change can never be applied to a live deal.
    pub fee_bps: u16,
    /// Lamports of buyer money this account is currently holding, excluding rent.
    pub escrowed_lamports: u64,
    /// Unix timestamp after which `refund` becomes callable by anyone.
    pub deadline: i64,
    pub delivery_days: u16,
    pub kind: Kind,
    pub status: Status,
    /// Authorities this listing promises.
    pub authorities: u8,
    /// Authorities actually in the program's custody.
    pub escrowed: u8,
    pub bump: u8,
    /// When a dispute was raised, or 0 if none ever was.
    ///
    /// Without this a dispute is a permanent freeze: `dispute` moves the listing out of
    /// `Funded`, and the deadline refund only fires on `Funded`, so either party could
    /// take the money hostage for as long as the arbitrator stayed silent. Recording the
    /// moment lets the refund come back once arbitration has clearly been abandoned.
    ///
    /// Last field on purpose: listings written before this read it back as 0, and the
    /// refund path falls back to the delivery deadline for those.
    pub disputed_at: i64,
}

impl Listing {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 16 + 8 + 2 + 8 + 8 + 2 + 1 + 1 + 1 + 1 + 1 + 16;

    pub fn fee(&self) -> Result<u64> {
        Ok(self
            .price
            .checked_mul(self.fee_bps as u64)
            .ok_or(crate::EscrowError::MathOverflow)?
            / 10_000)
    }

    pub fn seller_take(&self) -> Result<u64> {
        self.price
            .checked_sub(self.fee()?)
            .ok_or(crate::EscrowError::MathOverflow.into())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OfferStatus {
    /// Funded and waiting. The buyer's SOL is held by this account.
    Open,
    /// Someone who held the authorities took it.
    Accepted,
    /// Withdrawn, or cleaned up after expiry. The money went back to the buyer.
    Cancelled,
}

/// An unsolicited, funded bid on a token nobody has listed.
///
/// The mirror image of a `Listing`: instead of the seller escrowing the asset and
/// waiting for money, the buyer escrows the money and waits for the asset. Whoever
/// actually holds the authorities can accept, and because they sign that transaction
/// themselves the authorities move straight to the buyer — this account never needs
/// custody of them.
///
/// The owner does not need an account here, or to have heard of this marketplace.
#[account]
pub struct Offer {
    pub buyer: Pubkey,
    pub mint: Pubkey,
    /// Client-chosen id, part of this account's address.
    pub offer_id: [u8; 16],
    pub price: u64,
    /// Frozen when the offer is made, so a fee change cannot be applied to a live bid.
    pub fee_bps: u16,
    /// Lamports of the buyer's money this account holds, excluding rent.
    pub escrowed_lamports: u64,
    /// Unix timestamp after which anyone may clean this up and return the money.
    pub expiry: i64,
    /// Which authorities the buyer is bidding for.
    pub authorities: u8,
    pub status: OfferStatus,
    pub bump: u8,
}

impl Offer {
    pub const SPACE: usize = 8 + 32 + 32 + 16 + 8 + 2 + 8 + 8 + 1 + 1 + 1 + 16;

    pub fn fee(&self) -> Result<u64> {
        Ok(self
            .price
            .checked_mul(self.fee_bps as u64)
            .ok_or(crate::EscrowError::MathOverflow)?
            / 10_000)
    }

    pub fn seller_take(&self) -> Result<u64> {
        self.price
            .checked_sub(self.fee()?)
            .ok_or(crate::EscrowError::MathOverflow.into())
    }
}
