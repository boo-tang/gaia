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

## What is not a country

Unclaimed cells have no square NFT.

A standalone square has an NFT but `countryOf = 0`. Do not use `countryOf == 0` to find unclaimed land. Use `exists(lat, lng)`.

`accountOf(next country id)` is public before that country exists. Someone who already has a square can send it there. When the next country is created, that square does **not** join it. Each square records its own country, and only a mint or transfer into a registered account sets that record. The parked square stays standalone (`countryOf = 0`). The new country owner can move it out with `execute`, then merge it from a wallet. The normal shape and consent checks then apply.

## Quick picture of a market sale

1. Dana approves `GaiaCountryMarket` for Country 1 and lists it for 10 ETH. The listing records version `7`. If a square enters or leaves Country 1, the listing is not valid any more, and Dana must list again.
2. A buyer reads version `7` and account state `4`, and calls `buy(1, 7, 4)` with 10 ETH. (The state of an account that is not deployed is `0`.)
3. The market checks that Dana still owns Country 1, `compositionVersion(1) == 7` and `accountOf(1).state() == 4`.
4. It transfers Country NFT 1 to the buyer and pays Dana.
5. The four (or N) squares do not move. The buyer is now `controllerOf` each of them.

If Dana merged Carol's bar after listing, version would be `10` (example). The purchase would fail the check. The buyer would not pay for a different shape.