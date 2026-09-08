# takeover-escrow

The on-chain escrow for Project: Takeover. Replaces the custodial escrow wallet, so
neither the site operator nor anyone who compromises the server can move user funds.

## What it guarantees

- **Token sales are atomic.** `buy_token` pays the seller and transfers every escrowed
  authority to the buyer in a single instruction. There is no holding window.
- **Nothing gets stuck.** `refund` is permissionless once the delivery deadline passes,
  so a buyer whose seller vanished does not need anyone's cooperation to get paid back.
- **The arbitrator is bounded.** On a disputed deal it may only choose "pay the seller"
  or "refund the buyer". It cannot redirect funds, touch an undisputed deal, or change
  a price.
- **The fee is frozen at listing time**, so it can never be raised on a deal in flight.

## Status

Devnet only, unaudited. Do not put mainnet funds through this until it has been
independently reviewed.
