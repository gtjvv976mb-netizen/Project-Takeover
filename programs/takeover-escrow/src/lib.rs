//! Project: Takeover — on-chain escrow.
//!
//! Replaces the custodial escrow wallet. Funds live in program-owned accounts that
//! nobody holds a key for, so neither the site operator nor an attacker who takes the
//! server can move a user's money.
//!
//! Three shapes of deal:
//!
//! * `TokenAuthority` never escrows money at all. The seller places the authorities in
//!   the program's custody, and `buy_token` pays the seller and hands the authorities to
//!   the buyer in one instruction. Either both happen or neither does.
//! * `PumpCreator` and `Offchain` escrow the buyer's SOL, because the asset cannot be
//!   held by a Solana program. The buyer releases on delivery, and if the seller never
//!   delivers, `refund` is callable by anyone once the deadline passes.
//!
//! The arbitrator can only pick a winner on a disputed deal. It cannot redirect funds,
//! touch an undisputed deal, or change a price.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction,
};
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{self, Mint, SetAuthority, Token, TokenAccount, Transfer};

pub mod errors;
pub mod state;

pub use errors::EscrowError;
pub use state::*;

declare_id!("B6sQ8s6rikSPqwPhm6XPpy16mVuJ87raCcVFXMA6sSVG");

/// Metaplex Token Metadata.
pub const METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
/// Hard ceiling on the platform fee, enforced by the program itself. The config
/// authority cannot exceed this, ever, and neither can anyone who takes that key.
/// It sits exactly at the operating rate so the promise is checkable on chain: this
/// marketplace cannot charge more than 5%.
pub const MAX_FEE_BPS: u16 = 500;
pub const MIN_DELIVERY_DAYS: u16 = 1;
pub const MAX_DELIVERY_DAYS: u16 = 90;
const SECONDS_PER_DAY: i64 = 86_400;

#[program]
pub mod takeover_escrow {
    use super::*;

    /// One-time setup of the fee, treasury and arbitrator.
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16, rewards_bps: u16, arbitrator: Pubkey, treasury: Pubkey) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        require!(rewards_bps <= fee_bps, EscrowError::RewardsExceedFee);
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.arbitrator = arbitrator;
        c.treasury = treasury;
        c.fee_bps = fee_bps;
        c.rewards_bps = rewards_bps;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Rotate the arbitrator, treasury or default fee. Never touches listing funds, and
    /// listings already created keep the fee they were created with.
    pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: u16, rewards_bps: u16, arbitrator: Pubkey, treasury: Pubkey) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        require!(rewards_bps <= fee_bps, EscrowError::RewardsExceedFee);
        let c = &mut ctx.accounts.config;
        c.fee_bps = fee_bps;
        c.arbitrator = arbitrator;
        c.treasury = treasury;
        Ok(())
    }


    /// Open the reward pool. One per program, fixed to a single mint.
    ///
    /// Deliberately separate from `initialize`: the marketplace works with no pool at
    /// all, which is what lets it run before the coin exists.
    pub fn init_reward_pool(ctx: Context<InitRewardPool>) -> Result<()> {
        let p = &mut ctx.accounts.reward_pool;
        p.mint = ctx.accounts.mint.key();
        p.total_staked = 0;
        p.acc_per_token = 0;
        p.owed = 0;
        p.bump = ctx.bumps.reward_pool;
        p.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Put tokens in and start earning from the next sale onward.
    pub fn stake(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::NothingStaked);

        let st = &mut ctx.accounts.stake;
        if st.owner == Pubkey::default() {
            st.owner = ctx.accounts.owner.key();
            st.bump = ctx.bumps.stake;
        }
        // Settle before the balance moves, or the new size would be credited for a
        // period it was not staked.
        st.settle(&ctx.accounts.reward_pool)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let pool = &mut ctx.accounts.reward_pool;
        pool.total_staked = pool.total_staked.checked_add(amount).ok_or(EscrowError::MathOverflow)?;
        st.amount = st.amount.checked_add(amount).ok_or(EscrowError::MathOverflow)?;
        st.reward_debt = (st.amount as u128)
            .checked_mul(pool.acc_per_token)
            .ok_or(EscrowError::MathOverflow)?
            / ACC_SCALE;
        Ok(())
    }

    /// Take tokens back out. Anything already earned stays owed and is still claimable,
    /// so leaving never costs a staker rewards they had accrued.
    pub fn unstake(ctx: Context<StakeTokens>, amount: u64) -> Result<()> {
        let st = &mut ctx.accounts.stake;
        require!(amount > 0 && st.amount >= amount, EscrowError::NothingStaked);
        st.settle(&ctx.accounts.reward_pool)?;

        let pool_bump = ctx.accounts.reward_pool.bump;
        let seeds: &[&[u8]] = &[b"reward_pool", &[pool_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.from.to_account_info(),
                    authority: ctx.accounts.reward_pool.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        let pool = &mut ctx.accounts.reward_pool;
        pool.total_staked = pool.total_staked.checked_sub(amount).ok_or(EscrowError::MathOverflow)?;
        st.amount = st.amount.checked_sub(amount).ok_or(EscrowError::MathOverflow)?;
        st.reward_debt = (st.amount as u128)
            .checked_mul(pool.acc_per_token)
            .ok_or(EscrowError::MathOverflow)?
            / ACC_SCALE;
        Ok(())
    }

    /// Withdraw earned SOL. Pays out of `owed` only, so the pool's own rent is never
    /// touched and the account cannot be drained closed.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let st = &mut ctx.accounts.stake;
        st.settle(&ctx.accounts.reward_pool)?;
        let amount = st.pending;
        require!(amount > 0, EscrowError::NothingToClaim);

        let pool = &mut ctx.accounts.reward_pool;
        require!(pool.owed >= amount, EscrowError::EscrowBalanceMismatch);
        pool.owed = pool.owed.checked_sub(amount).ok_or(EscrowError::MathOverflow)?;
        st.pending = 0;

        pay_from_listing(&pool.to_account_info(), &ctx.accounts.owner.to_account_info(), amount)
    }

    /// Open a listing. Token listings start as `Draft` and only become purchasable once
    /// every promised authority is in the program's custody.
    pub fn create_listing(
        ctx: Context<CreateListing>,
        listing_id: [u8; 16],
        kind: Kind,
        price: u64,
        authorities: u8,
        delivery_days: u16,
    ) -> Result<()> {
        require!(price > 0, EscrowError::ZeroPrice);
        require!(
            (MIN_DELIVERY_DAYS..=MAX_DELIVERY_DAYS).contains(&delivery_days),
            EscrowError::BadDeliveryWindow
        );

        let l = &mut ctx.accounts.listing;
        l.seller = ctx.accounts.seller.key();
        l.buyer = Pubkey::default();
        l.listing_id = listing_id;
        l.price = price;
        l.fee_bps = ctx.accounts.config.fee_bps;
        l.rewards_bps = ctx.accounts.config.rewards_bps;
        l.escrowed_lamports = 0;
        l.deadline = 0;
        l.delivery_days = delivery_days;
        l.kind = kind;
        l.escrowed = 0;
        l.bump = ctx.bumps.listing;

        match kind {
            Kind::TokenAuthority => {
                require!(authorities & AUTH_ALL != 0, EscrowError::NoAuthorities);
                let mint = ctx.accounts.mint.as_ref().ok_or(EscrowError::MintMismatch)?;
                // Token-2022 has a different authority model; reject it rather than half-support it.
                require_keys_eq!(*mint.to_account_info().owner, token::ID, EscrowError::UnsupportedTokenProgram);
                l.mint = mint.key();
                l.authorities = authorities & AUTH_ALL;
                l.status = Status::Draft;
            }
            Kind::PumpCreator => {
                let mint = ctx.accounts.mint.as_ref().ok_or(EscrowError::MintMismatch)?;
                l.mint = mint.key();
                l.authorities = 0;
                l.status = Status::Active;
            }
            Kind::Offchain => {
                l.mint = Pubkey::default();
                l.authorities = 0;
                l.status = Status::Active;
            }
        }
        Ok(())
    }

    /// Seller hands one authority to the program. Once all promised authorities are in,
    /// the listing goes live. This is what makes a token sale safe for the buyer: the
    /// seller gives up control before anyone can pay.
    pub fn escrow_authority(ctx: Context<EscrowAuthority>, which: u8) -> Result<()> {
        let listing_key = ctx.accounts.listing.key();
        {
            let l = &ctx.accounts.listing;
            require!(l.kind == Kind::TokenAuthority, EscrowError::NotTokenListing);
            require!(l.status == Status::Draft, EscrowError::BadStatus);
            require!(l.authorities & which != 0, EscrowError::AuthorityNotListed);
            require!(l.escrowed & which == 0, EscrowError::AuthorityAlreadyEscrowed);
            require_keys_eq!(l.mint, ctx.accounts.mint.key(), EscrowError::MintMismatch);
        }

        match which {
            AUTH_MINT | AUTH_FREEZE => {
                let ty = if which == AUTH_MINT { AuthorityType::MintTokens } else { AuthorityType::FreezeAccount };
                token::set_authority(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        SetAuthority {
                            current_authority: ctx.accounts.seller.to_account_info(),
                            account_or_mint: ctx.accounts.mint.to_account_info(),
                        },
                    ),
                    ty,
                    Some(listing_key),
                )?;
            }
            AUTH_METADATA => {
                let metadata = ctx.accounts.metadata.as_ref().ok_or(EscrowError::BadMetadataAccount)?;
                let md_program = ctx.accounts.token_metadata_program.as_ref().ok_or(EscrowError::MissingMetadataProgram)?;
                verify_metadata_pda(metadata.key, &ctx.accounts.mint.key())?;
                invoke(
                    &update_metadata_authority_ix(metadata.key, ctx.accounts.seller.key, &listing_key),
                    &[metadata.to_account_info(), ctx.accounts.seller.to_account_info(), md_program.to_account_info()],
                )?;
            }
            _ => return err!(EscrowError::AuthorityNotListed),
        }

        let l = &mut ctx.accounts.listing;
        l.escrowed |= which;
        if l.escrowed == l.authorities {
            l.status = Status::Active;
        }
        Ok(())
    }

    /// Buy a token listing. Pays the seller and the treasury, and transfers every
    /// escrowed authority to the buyer, in a single instruction. There is no window in
    /// which one side has both the money and the asset.
    pub fn buy_token(ctx: Context<BuyToken>) -> Result<()> {
        let (seller_take, fee, escrowed, bump, listing_id, seller_key) = {
            let l = &ctx.accounts.listing;
            require!(l.kind == Kind::TokenAuthority, EscrowError::NotTokenListing);
            require!(l.status == Status::Active, EscrowError::BadStatus);
            require!(l.escrowed == l.authorities, EscrowError::AuthoritiesIncomplete);
            require_keys_neq!(l.seller, ctx.accounts.buyer.key(), EscrowError::SelfPurchase);
            require_keys_eq!(l.mint, ctx.accounts.mint.key(), EscrowError::MintMismatch);
            require_keys_eq!(l.seller, ctx.accounts.seller.key(), EscrowError::NotSeller);
            require_keys_eq!(ctx.accounts.config.treasury, ctx.accounts.treasury.key(), EscrowError::BadTreasury);
            (l.seller_take()?, (l.holder_cut()?, l.treasury_cut()?), l.escrowed, l.bump, l.listing_id, l.seller)
        };
        let (holder_cut, treasury_cut) = fee;
        require!(
            holder_cut == 0 || ctx.accounts.reward_pool.is_some(),
            EscrowError::RewardPoolRequired
        );

        // pay first, so a failure to move the authorities reverts the payment too
        pay_from_signer(
            &ctx.accounts.buyer,
            &ctx.accounts.seller,
            &ctx.accounts.system_program,
            seller_take,
        )?;
        let buyer = ctx.accounts.buyer.clone();
        let sys = ctx.accounts.system_program.clone();
        let treasury_ai = ctx.accounts.treasury.clone();
        split_fee(
            holder_cut,
            treasury_cut,
            ctx.accounts.reward_pool.as_mut(),
            &treasury_ai,
            |to, amount| pay_from_signer(&buyer, to, &sys, amount),
        )?;

        let seeds: &[&[u8]] = &[b"listing", seller_key.as_ref(), listing_id.as_ref(), &[bump]];
        transfer_authorities(
            escrowed,
            &ctx.accounts.listing.to_account_info(),
            &ctx.accounts.mint,
            ctx.accounts.metadata.as_ref(),
            ctx.accounts.token_metadata_program.as_ref(),
            &ctx.accounts.buyer.key(),
            &ctx.accounts.token_program,
            seeds,
        )?;

        let l = &mut ctx.accounts.listing;
        l.buyer = ctx.accounts.buyer.key();
        l.status = Status::Completed;
        Ok(())
    }

    /// Escrow the buyer's money for a deal whose asset cannot live on this program.
    /// Starts the delivery clock.
    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        let price = {
            let l = &ctx.accounts.listing;
            require!(l.kind != Kind::TokenAuthority, EscrowError::NotEscrowListing);
            require!(l.status == Status::Active, EscrowError::BadStatus);
            require_keys_neq!(l.seller, ctx.accounts.buyer.key(), EscrowError::SelfPurchase);
            l.price
        };

        pay_from_signer(
            &ctx.accounts.buyer,
            &ctx.accounts.listing.to_account_info(),
            &ctx.accounts.system_program,
            price,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let l = &mut ctx.accounts.listing;
        l.buyer = ctx.accounts.buyer.key();
        l.escrowed_lamports = price;
        l.deadline = now
            .checked_add((l.delivery_days as i64).checked_mul(SECONDS_PER_DAY).ok_or(EscrowError::MathOverflow)?)
            .ok_or(EscrowError::MathOverflow)?;
        l.status = Status::Funded;
        Ok(())
    }

    /// Buyer confirms delivery. Pays the seller and the treasury out of escrow.
    pub fn release(mut ctx: Context<Settle>) -> Result<()> {
        {
            let l = &ctx.accounts.listing;
            require!(l.status == Status::Funded, EscrowError::BadStatus);
            require_keys_eq!(l.buyer, ctx.accounts.signer.key(), EscrowError::NotBuyer);
        }
        settle_to_seller(&mut ctx)
    }

    /// Return the escrowed money to the buyer. Callable by ANYONE once the deadline has
    /// passed, so a buyer whose seller vanished never needs the operator's cooperation.
    pub fn refund(mut ctx: Context<Settle>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        {
            let l = &ctx.accounts.listing;
            require!(l.status == Status::Funded, EscrowError::BadStatus);
            require!(now >= l.deadline, EscrowError::DeadlineNotReached);
            require_keys_eq!(l.buyer, ctx.accounts.buyer.key(), EscrowError::NotBuyer);
        }
        settle_to_buyer(&mut ctx)
    }

    /// Freeze a funded deal pending arbitration. Either party may call it.
    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        let l = &mut ctx.accounts.listing;
        require!(l.status == Status::Funded, EscrowError::BadStatus);
        let who = ctx.accounts.signer.key();
        require!(who == l.buyer || who == l.seller, EscrowError::NotBuyer);
        l.status = Status::Disputed;
        Ok(())
    }

    /// The arbitrator's only power: on a disputed deal, choose who wins. It cannot send
    /// the money anywhere other than the seller or the buyer.
    pub fn resolve(mut ctx: Context<Settle>, pay_seller: bool) -> Result<()> {
        {
            let l = &ctx.accounts.listing;
            require!(l.status == Status::Disputed, EscrowError::BadStatus);
            require_keys_eq!(ctx.accounts.config.arbitrator, ctx.accounts.signer.key(), EscrowError::NotArbitrator);
        }
        if pay_seller { settle_to_seller(&mut ctx) } else { settle_to_buyer(&mut ctx) }
    }

    /// Seller withdraws an unsold listing. Any escrowed authorities go back to them.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let (escrowed, bump, listing_id, seller_key) = {
            let l = &ctx.accounts.listing;
            require!(matches!(l.status, Status::Draft | Status::Active), EscrowError::BadStatus);
            require_keys_eq!(l.seller, ctx.accounts.seller.key(), EscrowError::NotSeller);
            (l.escrowed, l.bump, l.listing_id, l.seller)
        };

        if escrowed != 0 {
            let seeds: &[&[u8]] = &[b"listing", seller_key.as_ref(), listing_id.as_ref(), &[bump]];
            let mint = ctx.accounts.mint.as_ref().ok_or(EscrowError::MintMismatch)?;
            transfer_authorities(
                escrowed,
                &ctx.accounts.listing.to_account_info(),
                mint,
                ctx.accounts.metadata.as_ref(),
                ctx.accounts.token_metadata_program.as_ref(),
                &seller_key,
                ctx.accounts.token_program.as_ref().ok_or(EscrowError::NotTokenListing)?,
                seeds,
            )?;
        }

        let l = &mut ctx.accounts.listing;
        l.escrowed = 0;
        l.status = Status::Cancelled;
        Ok(())
    }

    /// Bid on a token nobody has listed.
    ///
    /// The buyer's SOL locks in this account. It is a real, checkable commitment rather
    /// than a message: anyone reading the chain can see the money is there.
    pub fn make_offer(
        ctx: Context<MakeOffer>,
        offer_id: [u8; 16],
        price: u64,
        authorities: u8,
        expiry_days: u16,
    ) -> Result<()> {
        require!(price > 0, EscrowError::ZeroPrice);
        require!(authorities & AUTH_ALL != 0, EscrowError::NoAuthorities);
        require!(
            (MIN_DELIVERY_DAYS..=MAX_DELIVERY_DAYS).contains(&expiry_days),
            EscrowError::BadOfferWindow
        );

        let now = Clock::get()?.unix_timestamp;
        let o = &mut ctx.accounts.offer;
        o.buyer = ctx.accounts.buyer.key();
        o.mint = ctx.accounts.mint.key();
        o.offer_id = offer_id;
        o.price = price;
        o.fee_bps = ctx.accounts.config.fee_bps;
        o.rewards_bps = ctx.accounts.config.rewards_bps;
        o.escrowed_lamports = price;
        o.expiry = now
            .checked_add((expiry_days as i64).checked_mul(SECONDS_PER_DAY).ok_or(EscrowError::MathOverflow)?)
            .ok_or(EscrowError::MathOverflow)?;
        o.authorities = authorities & AUTH_ALL;
        o.status = OfferStatus::Open;
        o.bump = ctx.bumps.offer;

        pay_from_signer(
            &ctx.accounts.buyer,
            &ctx.accounts.offer.to_account_info(),
            &ctx.accounts.system_program,
            price,
        )
    }

    /// Take a funded offer. Signed by whoever currently holds the authorities.
    ///
    /// One instruction: every authority moves to the buyer and the money moves to the
    /// seller. Because the seller signs this themselves, the program never needs custody
    /// of the token — and the token program rejects the whole thing if the signer is not
    /// really the authority, so no separate ownership check is needed or trusted.
    pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let (seller_take, fee, wanted) = {
            let o = &ctx.accounts.offer;
            require!(o.status == OfferStatus::Open, EscrowError::OfferNotOpen);
            require!(now < o.expiry, EscrowError::OfferExpired);
            require_keys_eq!(o.mint, ctx.accounts.mint.key(), EscrowError::MintMismatch);
            require_keys_eq!(o.buyer, ctx.accounts.buyer.key(), EscrowError::NotBuyer);
            require_keys_neq!(o.buyer, ctx.accounts.seller.key(), EscrowError::SelfAccept);
            require_keys_eq!(ctx.accounts.config.treasury, ctx.accounts.treasury.key(), EscrowError::BadTreasury);
            (o.seller_take()?, (o.holder_cut()?, o.treasury_cut()?), o.authorities)
        };
        let (holder_cut, treasury_cut) = fee;
        require!(
            holder_cut == 0 || ctx.accounts.reward_pool.is_some(),
            EscrowError::RewardPoolRequired
        );

        // hand the controls over first; if any of this fails nothing is paid
        transfer_authorities_from_signer(
            wanted,
            &ctx.accounts.seller,
            &ctx.accounts.mint,
            ctx.accounts.metadata.as_ref(),
            &ctx.accounts.buyer.key(),
            &ctx.accounts.token_program,
        )?;

        let offer_ai = ctx.accounts.offer.to_account_info();
        pay_from_listing(&offer_ai, &ctx.accounts.seller.to_account_info(), seller_take)?;
        let treasury_ai = ctx.accounts.treasury.clone();
        let from = offer_ai.clone();
        split_fee(
            holder_cut,
            treasury_cut,
            ctx.accounts.reward_pool.as_mut(),
            &treasury_ai,
            |to, amount| pay_from_listing(&from, to, amount),
        )?;

        let o = &mut ctx.accounts.offer;
        o.escrowed_lamports = 0;
        o.status = OfferStatus::Accepted;
        Ok(())
    }

    /// Withdraw an offer and take the money back. The buyer may do this at any time;
    /// anyone may do it once the offer has expired, so stale bids cannot linger.
    pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let held = {
            let o = &ctx.accounts.offer;
            require!(o.status == OfferStatus::Open, EscrowError::OfferNotOpen);
            require_keys_eq!(o.buyer, ctx.accounts.buyer.key(), EscrowError::NotOfferBuyer);
            if ctx.accounts.signer.key() != o.buyer {
                require!(now >= o.expiry, EscrowError::OfferNotExpired);
            }
            o.escrowed_lamports
        };

        pay_from_listing(&ctx.accounts.offer.to_account_info(), &ctx.accounts.buyer, held)?;

        let o = &mut ctx.accounts.offer;
        o.escrowed_lamports = 0;
        o.status = OfferStatus::Cancelled;
        Ok(())
    }

    /// Reclaim the rent from a finished listing. Only the seller, only once terminal.
    pub fn close_listing(ctx: Context<CloseListing>) -> Result<()> {
        let l = &ctx.accounts.listing;
        require!(
            matches!(l.status, Status::Completed | Status::Cancelled | Status::Refunded),
            EscrowError::ListingStillLive
        );
        require!(l.escrowed_lamports == 0, EscrowError::EscrowBalanceMismatch);
        Ok(())
    }
}

/* ----------------------------------------------------------------- helpers */

/// Move lamports from a signer using the system program.
fn pay_from_signer<'info>(
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    invoke(
        &system_instruction::transfer(from.key, to.key, lamports),
        &[from.to_account_info(), to.clone(), system_program.to_account_info()],
    )
    .map_err(Into::into)
}

/// Move lamports out of the program-owned listing account. Direct arithmetic, because a
/// program-owned account cannot be the source of a system transfer.
fn pay_from_listing<'info>(listing: &AccountInfo<'info>, to: &AccountInfo<'info>, lamports: u64) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let mut from_lamports = listing.try_borrow_mut_lamports()?;
    let mut to_lamports = to.try_borrow_mut_lamports()?;
    **from_lamports = from_lamports.checked_sub(lamports).ok_or(EscrowError::MathOverflow)?;
    **to_lamports = to_lamports.checked_add(lamports).ok_or(EscrowError::MathOverflow)?;
    Ok(())
}


/// Credit the stakers' share and hand the rest to the treasury.
///
/// `holder_cut` is carved out of the fee, never added to it: the seller pays the same 5%
/// whichever way this falls. If nothing is staked there is nobody to pay, so the whole
/// fee goes to the treasury rather than piling up in a pool no one can claim.
///
/// `pay` moves lamports from wherever the money currently is — the buyer's wallet for an
/// atomic token sale, the escrow account for everything else.
fn split_fee<'info>(
    holder_cut: u64,
    treasury_cut: u64,
    pool: Option<&mut Account<'info, RewardPool>>,
    treasury: &AccountInfo<'info>,
    mut pay: impl FnMut(&AccountInfo<'info>, u64) -> Result<()>,
) -> Result<()> {
    let fee = holder_cut
        .checked_add(treasury_cut)
        .ok_or(EscrowError::MathOverflow)?;

    let Some(pool) = pool else {
        // No pool supplied. Only allowed when this deal owes stakers nothing; the
        // caller has already refused the instruction otherwise.
        require!(holder_cut == 0, EscrowError::RewardPoolRequired);
        if fee > 0 {
            pay(treasury, fee)?;
        }
        return Ok(());
    };

    if holder_cut == 0 || pool.total_staked == 0 {
        if fee > 0 {
            pay(treasury, fee)?;
        }
        return Ok(());
    }

    pay(&pool.to_account_info(), holder_cut)?;
    // Raise the running per-token total. Everyone staked right now is owed their share
    // of this deposit; nobody who stakes later can reach back for it.
    let per_token = (holder_cut as u128)
        .checked_mul(ACC_SCALE)
        .ok_or(EscrowError::MathOverflow)?
        / pool.total_staked as u128;
    pool.acc_per_token = pool
        .acc_per_token
        .checked_add(per_token)
        .ok_or(EscrowError::MathOverflow)?;
    pool.owed = pool.owed.checked_add(holder_cut).ok_or(EscrowError::MathOverflow)?;

    if treasury_cut > 0 {
        pay(treasury, treasury_cut)?;
    }
    Ok(())
}

fn settle_to_seller(ctx: &mut Context<Settle>) -> Result<()> {
    let (seller_take, fee, holder_cut, treasury_cut, held) = {
        let l = &ctx.accounts.listing;
        require_keys_eq!(l.seller, ctx.accounts.seller.key(), EscrowError::NotSeller);
        require_keys_eq!(ctx.accounts.config.treasury, ctx.accounts.treasury.key(), EscrowError::BadTreasury);
        (l.seller_take()?, l.fee()?, l.holder_cut()?, l.treasury_cut()?, l.escrowed_lamports)
    };
    require!(held >= seller_take.checked_add(fee).ok_or(EscrowError::MathOverflow)?, EscrowError::EscrowBalanceMismatch);
    require!(holder_cut == 0 || ctx.accounts.reward_pool.is_some(), EscrowError::RewardPoolRequired);

    let listing_ai = ctx.accounts.listing.to_account_info();
    pay_from_listing(&listing_ai, &ctx.accounts.seller, seller_take)?;
    let treasury_ai = ctx.accounts.treasury.clone();
    let from = listing_ai.clone();
    split_fee(
        holder_cut,
        treasury_cut,
        ctx.accounts.reward_pool.as_mut(),
        &treasury_ai,
        |to, amount| pay_from_listing(&from, to, amount),
    )?;

    let l = &mut ctx.accounts.listing;
    l.escrowed_lamports = 0;
    l.status = Status::Completed;
    Ok(())
}

fn settle_to_buyer(ctx: &mut Context<Settle>) -> Result<()> {
    let held = {
        let l = &ctx.accounts.listing;
        require_keys_eq!(l.buyer, ctx.accounts.buyer.key(), EscrowError::NotBuyer);
        l.escrowed_lamports
    };
    let listing_ai = ctx.accounts.listing.to_account_info();
    pay_from_listing(&listing_ai, &ctx.accounts.buyer, held)?;

    let l = &mut ctx.accounts.listing;
    l.escrowed_lamports = 0;
    l.status = Status::Refunded;
    Ok(())
}

/// Hand every escrowed authority to `new_authority`, signed by the listing PDA.
#[allow(clippy::too_many_arguments)]
fn transfer_authorities<'info>(
    escrowed: u8,
    listing: &AccountInfo<'info>,
    mint: &Account<'info, Mint>,
    metadata: Option<&AccountInfo<'info>>,
    metadata_program: Option<&AccountInfo<'info>>,
    new_authority: &Pubkey,
    token_program: &Program<'info, Token>,
    seeds: &[&[u8]],
) -> Result<()> {
    let signer_seeds = &[seeds];

    for (flag, ty) in [(AUTH_MINT, AuthorityType::MintTokens), (AUTH_FREEZE, AuthorityType::FreezeAccount)] {
        if escrowed & flag != 0 {
            token::set_authority(
                CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    SetAuthority { current_authority: listing.clone(), account_or_mint: mint.to_account_info() },
                    signer_seeds,
                ),
                ty,
                Some(*new_authority),
            )?;
        }
    }

    if escrowed & AUTH_METADATA != 0 {
        let md = metadata.ok_or(EscrowError::BadMetadataAccount)?;
        // The Metaplex program account must ride along in the transaction, or the CPI
        // has nothing to call into.
        let md_program = metadata_program.ok_or(EscrowError::MissingMetadataProgram)?;
        verify_metadata_pda(md.key, &mint.key())?;
        invoke_signed(
            &update_metadata_authority_ix(md.key, listing.key, new_authority),
            &[md.clone(), listing.clone(), md_program.clone()],
            signer_seeds,
        )?;
    }
    Ok(())
}

/// Move authorities from the signing holder straight to `new_authority`.
///
/// No PDA custody: the seller signs, so the token program and Metaplex each verify the
/// signer really is the current authority. If they are not, the CPI fails and the whole
/// instruction reverts — including the payment.
fn transfer_authorities_from_signer<'info>(
    wanted: u8,
    seller: &Signer<'info>,
    mint: &Account<'info, Mint>,
    metadata: Option<&AccountInfo<'info>>,
    new_authority: &Pubkey,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    for (flag, ty) in [(AUTH_MINT, AuthorityType::MintTokens), (AUTH_FREEZE, AuthorityType::FreezeAccount)] {
        if wanted & flag != 0 {
            token::set_authority(
                CpiContext::new(
                    token_program.to_account_info(),
                    SetAuthority {
                        current_authority: seller.to_account_info(),
                        account_or_mint: mint.to_account_info(),
                    },
                ),
                ty,
                Some(*new_authority),
            )?;
        }
    }

    if wanted & AUTH_METADATA != 0 {
        let md = metadata.ok_or(EscrowError::BadMetadataAccount)?;
        verify_metadata_pda(md.key, &mint.key())?;
        invoke(
            &update_metadata_authority_ix(md.key, seller.key, new_authority),
            &[md.clone(), seller.to_account_info()],
        )?;
    }
    Ok(())
}

fn verify_metadata_pda(metadata: &Pubkey, mint: &Pubkey) -> Result<()> {
    let (expected, _) = Pubkey::find_program_address(
        &[b"metadata", METADATA_PROGRAM_ID.as_ref(), mint.as_ref()],
        &METADATA_PROGRAM_ID,
    );
    require_keys_eq!(*metadata, expected, EscrowError::BadMetadataAccount);
    Ok(())
}

/// Metaplex `UpdateMetadataAccountV2` carrying only a new update authority.
/// Layout: discriminator 15 | Option<DataV2>=None | Option<Pubkey>=Some | None | None
fn update_metadata_authority_ix(metadata: &Pubkey, current: &Pubkey, new_authority: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(37);
    data.push(15);
    data.push(0);
    data.push(1);
    data.extend_from_slice(new_authority.as_ref());
    data.push(0);
    data.push(0);
    Instruction {
        program_id: METADATA_PROGRAM_ID,
        accounts: vec![AccountMeta::new(*metadata, false), AccountMeta::new_readonly(*current, true)],
        data,
    }
}

/* ---------------------------------------------------------------- contexts */

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = Config::SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(listing_id: [u8; 16])]
pub struct CreateListing<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = seller,
        space = Listing::SPACE,
        seeds = [b"listing", seller.key().as_ref(), listing_id.as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub seller: Signer<'info>,
    /// Required for token and pump listings, absent for off-chain ones.
    pub mint: Option<Account<'info, Mint>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EscrowAuthority<'info> {
    #[account(mut, seeds = [b"listing", listing.seller.as_ref(), listing.listing_id.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut, address = listing.seller @ EscrowError::NotSeller)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    /// CHECK: verified against the canonical Metaplex PDA for this mint.
    #[account(mut)]
    pub metadata: Option<AccountInfo<'info>>,
    /// CHECK: pinned to the Metaplex Token Metadata program id.
    #[account(address = METADATA_PROGRAM_ID @ EscrowError::BadMetadataAccount)]
    pub token_metadata_program: Option<AccountInfo<'info>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BuyToken<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"listing", listing.seller.as_ref(), listing.listing_id.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: matched against listing.seller.
    #[account(mut)]
    pub seller: AccountInfo<'info>,
    /// CHECK: matched against config.treasury.
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    /// CHECK: verified against the canonical Metaplex PDA for this mint.
    #[account(mut)]
    pub metadata: Option<AccountInfo<'info>>,
    /// CHECK: pinned to the Metaplex Token Metadata program id.
    #[account(address = METADATA_PROGRAM_ID @ EscrowError::BadMetadataAccount)]
    pub token_metadata_program: Option<AccountInfo<'info>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// Supplied whenever the deal owes stakers a share. Its address is the program's
    /// own PDA, so a caller cannot substitute a pool they control.
    #[account(mut, seeds = [b"reward_pool"], bump = reward_pool.bump)]
    pub reward_pool: Option<Account<'info, RewardPool>>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut, seeds = [b"listing", listing.seller.as_ref(), listing.listing_id.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"listing", listing.seller.as_ref(), listing.listing_id.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    /// Whoever is invoking. `refund` accepts anyone, the others check this key.
    pub signer: Signer<'info>,
    /// CHECK: matched against listing.seller.
    #[account(mut)]
    pub seller: AccountInfo<'info>,
    /// CHECK: matched against listing.buyer.
    #[account(mut)]
    pub buyer: AccountInfo<'info>,
    /// CHECK: matched against config.treasury.
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    /// Supplied whenever the deal owes stakers a share. Its address is the program's
    /// own PDA, so a caller cannot substitute a pool they control.
    #[account(mut, seeds = [b"reward_pool"], bump = reward_pool.bump)]
    pub reward_pool: Option<Account<'info, RewardPool>>,
}

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(mut, seeds = [b"listing", listing.seller.as_ref(), listing.listing_id.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut, seeds = [b"listing", listing.seller.as_ref(), listing.listing_id.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub mint: Option<Account<'info, Mint>>,
    /// CHECK: verified against the canonical Metaplex PDA for this mint.
    #[account(mut)]
    pub metadata: Option<AccountInfo<'info>>,
    /// CHECK: pinned to the Metaplex Token Metadata program id.
    #[account(address = METADATA_PROGRAM_ID @ EscrowError::BadMetadataAccount)]
    pub token_metadata_program: Option<AccountInfo<'info>>,
    pub token_program: Option<Program<'info, Token>>,
}

#[derive(Accounts)]
#[instruction(offer_id: [u8; 16])]
pub struct MakeOffer<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = buyer,
        space = Offer::SPACE,
        seeds = [b"offer", buyer.key().as_ref(), offer_id.as_ref()],
        bump
    )]
    pub offer: Account<'info, Offer>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"offer", offer.buyer.as_ref(), offer.offer_id.as_ref()], bump = offer.bump)]
    pub offer: Account<'info, Offer>,
    /// Whoever currently holds the authorities. Verified by the token program itself.
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: matched against offer.buyer; receives the authorities.
    #[account(mut)]
    pub buyer: AccountInfo<'info>,
    /// CHECK: matched against config.treasury.
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    /// CHECK: verified against the canonical Metaplex PDA for this mint.
    #[account(mut)]
    pub metadata: Option<AccountInfo<'info>>,
    /// CHECK: only used when a metadata authority is part of the offer.
    pub token_metadata_program: Option<AccountInfo<'info>>,
    pub token_program: Program<'info, Token>,
    /// Supplied whenever the deal owes stakers a share. Its address is the program's
    /// own PDA, so a caller cannot substitute a pool they control.
    #[account(mut, seeds = [b"reward_pool"], bump = reward_pool.bump)]
    pub reward_pool: Option<Account<'info, RewardPool>>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(mut, seeds = [b"offer", offer.buyer.as_ref(), offer.offer_id.as_ref()], bump = offer.bump)]
    pub offer: Account<'info, Offer>,
    /// The buyer, or after expiry anybody at all.
    pub signer: Signer<'info>,
    /// CHECK: matched against offer.buyer; the money goes back here.
    #[account(mut)]
    pub buyer: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CloseListing<'info> {
    #[account(
        mut,
        seeds = [b"listing", listing.seller.as_ref(), listing.listing_id.as_ref()],
        bump = listing.bump,
        has_one = seller @ EscrowError::NotSeller,
        close = seller
    )]
    pub listing: Account<'info, Listing>,
    #[account(mut)]
    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitRewardPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(init, payer = authority, space = RewardPool::SPACE, seeds = [b"reward_pool"], bump)]
    pub reward_pool: Account<'info, RewardPool>,
    pub mint: Account<'info, Mint>,
    /// Holds the staked tokens. Owned by the pool PDA, so only the program can move them.
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = reward_pool,
        seeds = [b"reward_vault"],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct StakeTokens<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"reward_pool"], bump = reward_pool.bump)]
    pub reward_pool: Account<'info, RewardPool>,
    #[account(mut, seeds = [b"reward_vault"], bump = reward_pool.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    /// The staker's own token account. Must be for the pool's mint.
    #[account(mut, constraint = from.mint == reward_pool.mint @ EscrowError::RewardMintMismatch)]
    pub from: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = Stake::SPACE,
        seeds = [b"stake", owner.key().as_ref()],
        bump
    )]
    pub stake: Account<'info, Stake>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"reward_pool"], bump = reward_pool.bump)]
    pub reward_pool: Account<'info, RewardPool>,
    #[account(
        mut,
        seeds = [b"stake", owner.key().as_ref()],
        bump = stake.bump,
        has_one = owner
    )]
    pub stake: Account<'info, Stake>,
}
