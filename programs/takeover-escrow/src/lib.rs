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
use anchor_spl::token::{self, Mint, SetAuthority, Token};

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

/// How long the arbitrator has to rule before the buyer can simply take their money back.
///
/// The point is not to rush arbitration — two weeks is generous — but to put a ceiling on
/// it. Without a ceiling, "raise a dispute" is a button either party can press to freeze
/// the other's money indefinitely, which is precisely the hostage-taking this escrow
/// exists to prevent.
const ARBITRATION_WINDOW: i64 = 14 * SECONDS_PER_DAY;

#[program]
pub mod takeover_escrow {
    use super::*;

    /// One-time setup of the fee, treasury and arbitrator.
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16, arbitrator: Pubkey, treasury: Pubkey) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.arbitrator = arbitrator;
        c.treasury = treasury;
        c.fee_bps = fee_bps;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Rotate the arbitrator, treasury or default fee. Never touches listing funds, and
    /// listings already created keep the fee they were created with.
    pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: u16, arbitrator: Pubkey, treasury: Pubkey) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        let c = &mut ctx.accounts.config;
        c.fee_bps = fee_bps;
        c.arbitrator = arbitrator;
        c.treasury = treasury;
        Ok(())
    }


    /// Nominate a successor to the config authority. Nothing changes until they accept.
    ///
    /// Fails if a nomination is already pending — withdraw it first. That is deliberate:
    /// silently overwriting a nomination is how the wrong key ends up in charge.
    pub fn nominate_authority(ctx: Context<NominateAuthority>, new_authority: Pubkey) -> Result<()> {
        require_keys_neq!(new_authority, Pubkey::default(), EscrowError::NotNominated);
        require_keys_neq!(new_authority, ctx.accounts.config.authority, EscrowError::AlreadyAuthority);
        let p = &mut ctx.accounts.pending;
        p.new_authority = new_authority;
        p.bump = ctx.bumps.pending;
        Ok(())
    }

    /// Withdraw a nomination that has not been accepted. Rent goes back to the authority.
    pub fn cancel_nomination(_ctx: Context<CancelNomination>) -> Result<()> {
        Ok(())
    }

    /// Take up a nomination. Only the nominated key can call this, which is what proves
    /// the successor is reachable before the old authority loses its powers.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        ctx.accounts.config.authority = ctx.accounts.pending.new_authority;
        Ok(())
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
        l.escrowed_lamports = 0;
        l.deadline = 0;
        l.delivery_days = delivery_days;
        l.kind = kind;
        l.escrowed = 0;
        l.disputed_at = 0;
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
            (l.seller_take()?, l.fee()?, l.escrowed, l.bump, l.listing_id, l.seller)
        };

        // pay first, so a failure to move the authorities reverts the payment too
        pay_from_signer(
            &ctx.accounts.buyer,
            &ctx.accounts.seller,
            &ctx.accounts.system_program,
            seller_take,
        )?;
        if fee > 0 {
            pay_from_signer(
                &ctx.accounts.buyer,
                &ctx.accounts.treasury,
                &ctx.accounts.system_program,
                fee,
            )?;
        }

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
            require_keys_eq!(l.buyer, ctx.accounts.buyer.key(), EscrowError::NotBuyer);

            let allowed = match l.status {
                // The ordinary path: the seller never delivered.
                Status::Funded => now >= l.deadline,
                // Arbitration was raised and then abandoned. Listings created before
                // `disputed_at` existed read it back as 0, so fall back to the delivery
                // deadline for those rather than leaving them stuck forever.
                Status::Disputed => {
                    let raised = if l.disputed_at != 0 { l.disputed_at } else { l.deadline };
                    now >= raised
                        .checked_add(ARBITRATION_WINDOW)
                        .ok_or(EscrowError::MathOverflow)?
                }
                _ => return err!(EscrowError::BadStatus),
            };
            require!(allowed, EscrowError::DeadlineNotReached);
        }
        settle_to_buyer(&mut ctx)
    }

    /// Freeze a funded deal pending arbitration. Either party may call it.
    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        let l = &mut ctx.accounts.listing;
        require!(l.status == Status::Funded, EscrowError::BadStatus);
        let who = ctx.accounts.signer.key();
        require!(who == l.buyer || who == l.seller, EscrowError::NotBuyer);
        l.disputed_at = Clock::get()?.unix_timestamp;
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
            // Every other instruction pins the mint to the listing; this one did not.
            require_keys_eq!(ctx.accounts.listing.mint, mint.key(), EscrowError::MintMismatch);
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
            (o.seller_take()?, o.fee()?, o.authorities)
        };

        // hand the controls over first; if any of this fails nothing is paid
        transfer_authorities_from_signer(
            wanted,
            &ctx.accounts.seller,
            &ctx.accounts.mint,
            ctx.accounts.metadata.as_ref(),
            ctx.accounts.token_metadata_program.as_ref(),
            &ctx.accounts.buyer.key(),
            &ctx.accounts.token_program,
        )?;

        let offer_ai = ctx.accounts.offer.to_account_info();
        pay_from_listing(&offer_ai, &ctx.accounts.seller.to_account_info(), seller_take)?;
        pay_from_listing(&offer_ai, &ctx.accounts.treasury, fee)?;

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

fn settle_to_seller(ctx: &mut Context<Settle>) -> Result<()> {
    let (seller_take, fee, held) = {
        let l = &ctx.accounts.listing;
        require_keys_eq!(l.seller, ctx.accounts.seller.key(), EscrowError::NotSeller);
        require_keys_eq!(ctx.accounts.config.treasury, ctx.accounts.treasury.key(), EscrowError::BadTreasury);
        (l.seller_take()?, l.fee()?, l.escrowed_lamports)
    };
    require!(held >= seller_take.checked_add(fee).ok_or(EscrowError::MathOverflow)?, EscrowError::EscrowBalanceMismatch);

    let listing_ai = ctx.accounts.listing.to_account_info();
    pay_from_listing(&listing_ai, &ctx.accounts.seller, seller_take)?;
    pay_from_listing(&listing_ai, &ctx.accounts.treasury, fee)?;

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
#[allow(clippy::too_many_arguments)]
fn transfer_authorities_from_signer<'info>(
    wanted: u8,
    seller: &Signer<'info>,
    mint: &Account<'info, Mint>,
    metadata: Option<&AccountInfo<'info>>,
    metadata_program: Option<&AccountInfo<'info>>,
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
        // The Metaplex program account has to be in the invocation or there is nothing to
        // call into. Its sibling `transfer_authorities` always passed it; this one did
        // not, which quietly broke every offer that included the metadata authority.
        let md_program = metadata_program.ok_or(EscrowError::MissingMetadataProgram)?;
        verify_metadata_pda(md.key, &mint.key())?;
        invoke(
            &update_metadata_authority_ix(md.key, seller.key, new_authority),
            &[md.clone(), seller.to_account_info(), md_program.clone()],
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
    /// CHECK: pinned to the Metaplex Token Metadata program id.
    #[account(address = METADATA_PROGRAM_ID @ EscrowError::BadMetadataAccount)]
    pub token_metadata_program: Option<AccountInfo<'info>>,
    pub token_program: Program<'info, Token>,
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
pub struct NominateAuthority<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = PendingAuthority::SPACE,
        seeds = [b"pending_authority"],
        bump
    )]
    pub pending: Account<'info, PendingAuthority>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelNomination<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"pending_authority"], bump = pending.bump, close = authority)]
    pub pending: Account<'info, PendingAuthority>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// Closed on acceptance: the nomination has served its purpose, and its rent goes to
    /// the key that just took over.
    #[account(
        mut,
        seeds = [b"pending_authority"],
        bump = pending.bump,
        has_one = new_authority @ EscrowError::NotNominated,
        close = new_authority
    )]
    pub pending: Account<'info, PendingAuthority>,
    #[account(mut)]
    pub new_authority: Signer<'info>,
}
