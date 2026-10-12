# How land works now

This is a plain-language guide to the live token model after the ERC-6551 country-account work. It uses one small map and follows those squares through auction, split, sale, and later growth.

Coordinates here are examples only. The contracts use integer latitude and longitude.

## The three objects

Every piece of land is three things, not one.

```
  wallet (Alice)
       │
       │  owns
       ▼
  Country NFT  #1          ← the title deed
       │
       │  controls
       ▼
  Country account          ← a box that holds land
  (accountOf(1))
       │
       │  owns
       ▼
  Square NFTs              ← the actual land
  (11,22) (12,22)
  (11,21) (12,21)
```

1. **Square NFT.** One map cell. It never burns. Its id is derived from `(lat, lng)`.
2. **Country NFT.** The title for a group of squares. Alice holds this in her wallet. If she sends this NFT, she sells the whole country.
3. **Country account.** A smart-contract wallet that belongs to that country NFT (ERC-6551). Square NFTs live here, not in Alice's wallet.

After settlement, Alice does not hold a square in her wallet. She holds the country. The country holds the squares. A square gets to her wallet only if she splits it out of the country.

## The names that confuse people

These four calls answer different questions. They look similar. They are not.

Use this after Alice wins the 2×2 block below, as Country 1.

| Call | Ask this | Example answer |
| --- | --- | --- |
| `ownerOf(country 1)` on **GaiaCountries** | Who holds the title? | Alice's wallet |
| `accountOf(1)` on **GaiaCountries** | Where do Country 1's squares live? | A fixed contract address |
| `ownerOf(square 11,22)` on **GaiaSquares** | Which address holds this square NFT? | `accountOf(1)` |
| `countryOf(11, 22)` on **GaiaSquares** | Which country is this square in? | `1` |
| `controllerOf(11, 22)` on **GaiaSquares** | Who may move this square (the title holder)? | Alice's wallet |

`accountOf` is an address. `countryOf` is a number.

- `accountOf(1)` is known **before** Country 1 exists. The address is computed from the country id. Creating the country later puts a contract at that same address.
- `countryOf(lat, lng)` is **0** until a country account that is already registered receives that square.

`controllerOf` is a shortcut: “owner of the country that owns this square.” That is who signs split, merge, and (later) sales of the land group.

## The map

Five columns of longitude, three rows of latitude. Empty cells are unclaimed.

```
        lng →
        10      11      12      13      14
lat 22  .       A       A       .       .
  ↓ 21  B       A       A       C       C
    20  B       B       .       C       .
```

Each pair is `(lng, lat)`.

- **Alice (A)** wants the 2×2 block: `(11,22) (12,22) (11,21) (12,21)`.
- **Bob (B)** wants the L: `(10,21) (10,20) (11,20)`.
- **Carol (C)** wants the bar: `(13,21) (14,21) (13,20)`.

Each shape is connected edge-to-edge. No holes. That is the on-chain rule (`connected_noholes`).

## Auction: how a country is born

The auction does not give squares to the winner's wallet.

For Alice's block:

1. Alice bids on the four cells.
2. Settlement calls `createCountry(Alice)`. That mints **Country NFT 1** to Alice and creates the account at `accountOf(1)`.
3. Settlement mints the four **square NFTs** into `accountOf(1)`, not to Alice.
4. The auction keeps Country 1 until the last mint chunk finishes, then sends Country 1 to Alice.

### Bid rules

All of these values are constructor parameters. Nobody can change them after deployment.

- **Next bid on a square.** The first bid is `minBidPerSquareWei`. After that, the next bid is the current bid plus the larger of `minBidPerSquareWei` and `minBidIncrementBps` of the current bid. Example with 0.001 ETH and 5%: at 0.01 ETH, the next bid is 0.011 ETH (the absolute step is larger). At 1 ETH, the next bid is 1.05 ETH (the percentage is larger).
- **Jump bid.** `bidOnShape(locs, floorPerSquare)`. Each square gets the larger of its next bid and `floorPerSquare`. With `floorPerSquare = 0`, each square gets the next bid. Value above the required total goes to `pendingReturns`.
- **Soft close, for the whole auction.** A bid with less than `extensionWindow` seconds left moves `endTime` to the bid time plus `extensionWindow`. This applies to all squares, not only the squares in the bid. A bid with exactly `extensionWindow` seconds left does not move it. A bid at `endTime` is accepted. A bid after `endTime` reverts.
- **Cap.** `endTime` never goes past `maxEndTime`. After `maxEndTime`, no bid is accepted.

Why one end for the whole auction: when Bob takes some of Alice's squares near the end, Alice can still bid on other squares that suit her. If each square closed at its own time, she could lose a square after the squares she wants as a replacement have closed.

Settlement and `withdrawProceeds` wait for the current `endTime`. Read `endTime()` from the auction every time. Do not keep a copy. The leftover-square sale must also read it when it runs.

### Pause and cancel

The auction has no owner of its own and is not upgradeable. The admin of `GaiaCountries` (the holder of `DEFAULT_ADMIN_ROLE`, a multisig) can stop it if we find a bug. The auction reads the role on each call: when the role moves to a new multisig, these powers move with it. When the admin renounces the role, nobody can pause any more. The admin cannot take funds, change bids, change winners or change the bid rules.

- **Pause.** `pause()` stops bids, settlement and `withdrawProceeds`. The admin can pause only before `endTime`, so a pause always comes before the first settlement. `withdraw` always works: outbid bidders can take their refunds during a pause.
- **Unpause.** Only before `endTime`. The clock does not stop during a pause, so `unpause()` applies the soft close: bidders get at least `extensionWindow` seconds (up to `maxEndTime`).
- **Cancel.** `cancel()` ends a paused auction for good. Every current highest bid becomes a refund. Each bidder calls `withdraw` and gets back everything they paid. Nothing settles, and the treasury gets nothing.
- **No hold on the funds.** While paused, the admin can cancel at any time. After `endTime`, anybody can cancel a paused auction. So a paused auction either starts again before `endTime` or ends in a cancel.

The frontend must read `paused()` and `cancelled()` and show them.

A country account cannot bid. If Alice already owns a country and bids through its box (`execute` on the account), `bidOnShape` reverts with `CountryAccountCannotBid`. The final transfer would send the new country into a box, which `OwnershipLoop` blocks (see below), so the land would stay in the auction. Alice bids from her wallet instead.

After Alice and Bob settle, and before Carol:

```
        10      11      12      13      14
lat 22  .       A       A       .       .
    21  B       A       A       .       .
    20  B       B       .       .       .
```

| Fact | Value |
| --- | --- |
| `ownerOf(country 1)` | Alice |
| `accountOf(1)` | Country 1's box |
| `countryOf(11, 22)` | 1 |
| `ownerOf(square 11,22)` | `accountOf(1)` |
| `controllerOf(11, 22)` | Alice |
| `ownerOf(country 2)` | Bob |
| `countryOf(10, 20)` | 2 |
| `countryOf(13, 21)` | 0 (still empty) |

Carol later settles the same way as Country 3. Her squares go to `accountOf(3)`.

A country can also be created by an issuer (`ISSUER_ROLE`) with `createCountry` and `addSquares`. The ownership picture is the same. Only the caller is different.

## Where a square can move

A square is always in one of two states:

- **In a country.** The NFT is at a registered country account. `countryOf` is the country id.
- **Standalone.** The NFT is at a normal wallet. `countryOf` is `0`. `controllerOf` is that wallet.

These moves are allowed:

| Move | Who must send it | Checks |
| --- | --- | --- |
| Mint into a country | An issuer (auction or sale contract) | New square, shape |
| Country → wallet (**split**) | The country account, on instruction from the title holder | Country keeps a valid shape |
| Wallet → country (**merge**) | The title holder of the destination country | Square touches the country, valid shape |
| Country → country, same title holder | The source account | Both shapes stay valid |
| Wallet → wallet | The holder, as for any NFT | None |

These moves revert:

- Anyone except the country account sends a square out of a country. Operator approvals do not work (`TransferNotByAccount`).
- A square goes into a country whose title holder did not send it. Land is not a gift (`NoConsent`).
- A square goes directly from Alice's country into Bob's country. Alice's account sends it, so Bob did not consent (`NoConsent`).
- A square is burned (`BurnNotAllowed`).

To send a square out of a country, Alice calls `execute` on `accountOf(1)`. The account then calls `transferFrom` on the square. Only the current holder of Country 1 can call `execute`.

## Split: take land out of a country

Alice wants to sell only the top row of her block. She keeps the bottom row.

Before:

```
        11      12
lat 22  A       A      ← she will split these
    21  A       A      ← she keeps these
```

Alice tells `accountOf(1)` to send `(11,22)` and `(12,22)` to her own wallet. The two squares are now standalone NFTs.

After:

```
        10      11      12      13      14
lat 22  .       S       S       .       .
    21  B       A       A       C       C
    20  B       B       .       C       .
```

`S` is a standalone square in Alice's wallet.

| Square | `countryOf` | NFT owner | `controllerOf` |
| --- | --- | --- | --- |
| `(11,22)` | 0 | Alice's wallet | Alice's wallet |
| `(12,21)` | 1 | `accountOf(1)` | Alice |
| `(10,20)` | 2 | `accountOf(2)` | Bob |

Alice can now sell each standalone square as a normal NFT, on any marketplace.

Each removal must leave Country 1 connected and without holes. If Alice removed `(11,22)` and then `(12,21)`, the remaining `(12,22)` and `(11,21)` would touch only at a corner. The second transfer would revert.

Each successful move bumps `compositionVersion(1)`. That number is the “edition” of the land group.

The last square of a country can also be split out. The country then has 0 squares, and the country NFT is burned in the same transaction. After the burn, nobody can control `accountOf(1)`. Its address stays registered as a country account, so no country NFT can go into it.

**Warning:** empty the account before you split the last square. ETH, tokens and NFTs that stay in the account after the burn are locked forever.

Users cannot create a new country to split into. Only an issuer can call `createCountry`.

## Sale: sell the country, not each square

A sale in `GaiaCountryMarket` does not list four square NFTs.

They list **Country 1**.

Buyer Dana pays. The market transfers **Country NFT 1** from Alice to Dana. The sale includes everything in `accountOf(1)`: squares, ETH, tokens and NFTs.

Nothing happens to the squares.

```
  before                          after
  Alice ──owns── Country 1        Dana ──owns── Country 1
                 │                              │
                 └──accountOf(1)                └──accountOf(1)
                        │                              │
                        └── same four squares          └── same four squares
```

- `accountOf(1)` does not change. It never changes.
- `countryOf` for those squares stays `1`.
- `ownerOf(square …)` stays `accountOf(1)`.
- `controllerOf` changes from Alice to Dana.

Dana can now split, merge, or sell again. Alice cannot.

The market binds the price to two values that Dana gives with her purchase: `compositionVersion(1)` and the account's `state()`. If Alice splits off a cell, or takes ETH or a token out of the account, after Dana looked, one value changes and the purchase reverts. Assets that arrive in the account after that are not checked. They are a gain for Dana.

A person can also sell by sending the country NFT in a wallet. Same effect. The market is the safe way, because it checks both values.

## Account policy: no approvals, no signatures

The sale check works only if every asset that leaves the account goes through `execute`. Two other paths can take assets out without a change of `state`: an approval that the account gave before the sale, and a signature of the account (for example, a permit or an off-chain order). The account closes both paths.

- **The account never signs.** `isValidSignature` always returns "not valid" (`0xffffffff`), also for a signature from the country owner. The account is ERC-6551 compliant, but no app can accept a signature from it.
- **The account blocks the standard approval functions.** `execute` reverts with `ApprovalNotAllowed` when the call is one of these:

  | Function | Used by |
  | --- | --- |
  | `approve(address,uint256)` | ERC-20 and ERC-721 |
  | `setApprovalForAll(address,bool)` | ERC-721 and ERC-1155 |
  | `increaseAllowance(address,uint256)` | Some ERC-20 tokens |
  | `approve(address,address,uint160,uint48)` | Permit2 |
  | `approve(address,uint256,uint256)` | ERC-6909 |
  | `setOperator(address,bool)` | ERC-6909 |
  | `approveAndCall(address,uint256)` | ERC-1363 |
  | `approveAndCall(address,uint256,bytes)` | ERC-1363 |
  | `authorizeOperator(address)` | ERC-777 |

What Alice cannot do from `accountOf(1)`:

- Give an approval to an app. For example: a token swap, a loan, a marketplace listing of an NFT in the account, or Permit2.
- Sign as the country. For example: "Sign in with Ethereum", an off-chain vote, or an off-chain order.

What Alice can still do from the account: send ETH, tokens and NFTs, and make calls that need no approval (for example, an airdrop claim, wrapping ETH, or an on-chain vote). The country NFT is in her wallet, so she can list and sell the country itself anywhere.

**Workaround:** to use an asset in an app, Alice first sends it from the account to her wallet with one `execute`. Then she uses any app from her wallet. This changes `state`, so a buyer sees it.

**Known limit:** the account does not block non-standard delegation functions in other contracts (for example, a custom operator or allowance function of one token). An approval that such a function gives can take assets out after a sale. A buyer must not rely on the sale check for assets of such contracts.

## Merge: grow a country

Dana holds Country 1 (the bottom row that Alice kept). Carol holds Country 3 (the bar). They touch at `(12,21)` / `(13,21)`.

```
        11      12      13      14
lat 22  .       .       .       .
    21  A       A       C       C
    20  .       .       C       .
```

Carol cannot push her squares into Dana's country, and Dana cannot pull them. The land goes through a wallet:

1. Carol splits her three squares to her wallet: `(14,21)`, then `(13,20)`, then `(13,21)`. Each removal keeps Country 3 valid. The last one is always allowed.
2. Carol sells or sends the three standalone NFTs to Dana's wallet.
3. Dana merges them from her wallet into `accountOf(1)`: `(13,21)` first (it touches `(12,21)`), then `(14,21)` and `(13,20)`.

Country 3 then has 0 squares. The last split burns the Country 3 NFT. Carol must take any other assets out of `accountOf(3)` before that split.

After:

```
        11      12      13      14
lat 21  A       A       A       A
    20  .       .       A       .
```

All those cells now report `countryOf = 1`. `compositionVersion(1)` goes up once per received square.

If a square did not touch the country, or if the result had a hole, the merge would revert. The order matters: Dana cannot merge `(14,21)` first, because it does not touch Country 1 yet.

## OwnershipLoop

A country NFT must not go **into** a country account.

Bad:

```
  Alice sends Country 1  →  accountOf(1)
```

Country 1 would then sit inside its own box. The only signer for that box is the holder of Country 1. The holder would be the box. Nobody could move the country or the squares. The land would be stuck.

Also bad:

```
  Alice sends Country 1  →  accountOf(2)   (Bob's box)
```

Bob could then move Alice's title (and her land) without a sale.

`OwnershipLoop` blocks a country NFT transfer when the destination is a **registered** country account.

It does **not** block a transfer to a normal wallet, a marketplace, or the auction (the auction holds the country during settlement).

Known gap, accepted: the guard knows only **registered** accounts. `accountOf(next country id)` is public before that country exists. Alice can send her own Country 1 there:

```
  Alice sends Country 1  →  accountOf(3)   (Country 3 does not exist yet)
  Bob wins Country 3                       (its account is that address)
```

Country 1 is now inside Country 3, and Bob controls it. Only Alice can do this to Country 1, so it is the same as a gift to the next country owner. Bob is not blocked: he can use Country 3 as normal, and he can move Country 1 out with `execute`. If Country 3 is burned while Country 1 is still in its account, Country 1 is locked forever, as any other asset in a dead account.

## What is not a country

Unclaimed cells have no square NFT.

A standalone square has an NFT but `countryOf = 0`. Do not use `countryOf == 0` to find unclaimed land. Use `exists(lat, lng)`.

`accountOf(next country id)` is public before that country exists. Someone who already has a square can send it there. When the next country is created, that square does **not** join it. Each square records its own country, and only a mint or transfer into a registered account sets that record. The parked square stays standalone (`countryOf = 0`). The new country owner can move it out with `execute`, then merge it from a wallet. The normal shape and consent checks then apply.

## Quick picture of a market sale

1. Dana approves `GaiaCountryMarket` for Country 1 only (`approve(market, 1)`; an approval for all her countries is not accepted) and lists it for 10 ETH. The listing records version `7`. If a square enters or leaves Country 1, the listing is not valid any more, and Dana must list again. If Country 1 leaves Dana's wallet, ERC-721 clears the approval, so the listing is not valid any more, also when the country comes back to her.
2. A buyer reads version `7` and account state `4`, and calls `buy(1, 7, 4)` with 10 ETH. (The state of an account that is not deployed is `0`.)
3. The market checks that Dana still owns Country 1, `compositionVersion(1) == 7` and `accountOf(1).state() == 4`.
4. It transfers Country NFT 1 to the buyer and pays Dana.
5. The four (or N) squares do not move. The buyer is now `controllerOf` each of them.

If Dana merged Carol's bar after listing, version would be `10` (example). The purchase would fail the check. The buyer would not pay for a different shape.