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
    /// How much of `fee_bps` belongs to stakers rather than to the treasury.
    /// 300 of 500 means three of the five points go to holders.
    ///
    /// Deliberately the last field: accounts written before this existed read it back as
    /// zero, which means "no holder share" — the safe reading, and it lets the upgrade
    /// land without migrating anything.
    pub rewards_bps: u16,
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
    /// Frozen at creation alongside `fee_bps`, so changing the split can never be
    /// applied to a deal that is already live. Zero on listings that predate it.
    pub rewards_bps: u16,
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

    /// The stakers' slice of the fee, taken out of the fee rather than added to it. The
    /// seller pays 5% either way; this only decides where it lands.
    pub fn holder_cut(&self) -> Result<u64> {
        Ok(self
            .price
            .checked_mul(self.rewards_bps as u64)
            .ok_or(crate::EscrowError::MathOverflow)?
            / 10_000)
    }

    /// What is left of the fee for the treasury. `rewards_bps <= fee_bps` is enforced at
    /// config time, so this cannot underflow.
    pub fn treasury_cut(&self) -> Result<u64> {
        self.fee()?
            .checked_sub(self.holder_cut()?)
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
    /// Frozen when the offer is made, for the same reason `fee_bps` is.
    pub rewards_bps: u16,
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

    /// The stakers' slice of the fee, taken out of the fee rather than added to it. The
    /// seller pays 5% either way; this only decides where it lands.
    pub fn holder_cut(&self) -> Result<u64> {
        Ok(self
            .price
            .checked_mul(self.rewards_bps as u64)
            .ok_or(crate::EscrowError::MathOverflow)?
            / 10_000)
    }

    /// What is left of the fee for the treasury. `rewards_bps <= fee_bps` is enforced at
    /// config time, so this cannot underflow.
    pub fn treasury_cut(&self) -> Result<u64> {
        self.fee()?
            .checked_sub(self.holder_cut()?)
            .ok_or(crate::EscrowError::MathOverflow.into())
    }
}

/// Fixed-point scale for `acc_per_token`.
///
/// Fees arrive in lamports and are divided by the whole staked supply, so the per-token
/// figure is almost always a fraction. Carrying it at 1e12 in a u128 means a single
/// lamport spread across a billion staked tokens still moves the number, instead of
/// truncating to zero and quietly vanishing.
pub const ACC_SCALE: u128 = 1_000_000_000_000;

/// Where the holders' share of every fee accumulates.
///
/// Solana has no way to iterate holders inside an instruction, so nothing is ever pushed
/// out. Instead each deposit raises `acc_per_token`, a running total of lamports earned
/// per staked token since the pool opened, and every staker subtracts whatever the
/// counter read when they last settled. That difference is what they are owed — the
/// standard accumulator, and it costs the same whether ten people stake or ten thousand.
///
/// It also fixes the obvious attack on a snapshot: you cannot buy in just before a
/// payout and sell straight after, because you only accrue while the counter is moving
/// and only for tokens you had staked at the time.
#[account]
pub struct RewardPool {
    /// The mint whose stakers are paid. Fixed at creation.
    pub mint: Pubkey,
    /// Tokens currently staked, the denominator for every deposit.
    pub total_staked: u64,
    /// Lamports earned per staked token since inception, scaled by `ACC_SCALE`.
    pub acc_per_token: u128,
    /// Lamports this account holds on stakers' behalf, excluding its own rent. Claims
    /// are checked against this so a claim can never eat the rent and close the pool.
    pub owed: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl RewardPool {
    pub const SPACE: usize = 8 + 32 + 8 + 16 + 8 + 1 + 1 + 32;
}

/// One staker's position.
#[account]
pub struct Stake {
    pub owner: Pubkey,
    /// Tokens this account has in the vault.
    pub amount: u64,
    /// `amount * acc_per_token / ACC_SCALE` as of the last settlement. Everything the
    /// counter has climbed since is what this staker has not been credited yet.
    pub reward_debt: u128,
    /// Settled and waiting to be withdrawn.
    pub pending: u64,
    pub bump: u8,
}

impl Stake {
    pub const SPACE: usize = 8 + 32 + 8 + 16 + 8 + 1 + 16;

    /// Move everything the counter has earned since last time into `pending`.
    ///
    /// Called before any change to `amount`, and before any claim. Skipping it anywhere
    /// would pay the new balance for a period it did not hold.
    pub fn settle(&mut self, pool: &RewardPool) -> Result<()> {
        let accrued = (self.amount as u128)
            .checked_mul(pool.acc_per_token)
            .ok_or(crate::EscrowError::MathOverflow)?
            / ACC_SCALE;
        let earned = accrued
            .checked_sub(self.reward_debt)
            .ok_or(crate::EscrowError::MathOverflow)?;
        self.pending = self
            .pending
            .checked_add(u64::try_from(earned).map_err(|_| crate::EscrowError::MathOverflow)?)
            .ok_or(crate::EscrowError::MathOverflow)?;
        self.reward_debt = accrued;
        Ok(())
    }
}
