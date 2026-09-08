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
}

impl Config {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 2 + 1 + 16;
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
