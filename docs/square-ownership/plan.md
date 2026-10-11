# Land model: plan from 9 October 2026

This plan is for the next agent. It starts from branch `boo/gaia-countries`, commit `a9b7f26`. That commit is pushed. On that commit, `./node_modules/.bin/hardhat test` gives **132 passing**. Hardhat shows a warning about the Node.js version. You can ignore it.

## Read first

1. [how-it-works.md](how-it-works.md): plain-language model, with map examples.
2. Linear tickets (team Boo_tang, project "Gaia: Post-auction & production readiness"): BOO-16, BOO-33, BOO-35, BOO-36. They were updated on 9 October 2026 with the decisions below.
3. Contracts: `GaiaCountries.sol`, `GaiaSquares.sol`, `GaiaCountryAccount.sol`, `GaiaAuction.sol` (`settleShape`, `_orderForSettlement`).

## Rules for the work

- Commit on `boo/gaia-countries`. Make one commit for each step. Do not open a pull request unless the user asks for one.
- Do not put Linear issue IDs or URLs in commit messages or pull request text.
- If you must make a new branch, use the prefix `boo/`.
- Write docs, comments and tickets in ASD-STE100 style.
- In TypeScript, use `undefined`, not `null`. Do not use `switch`. Use `if` / `else`.
- Make small changes. Change only what the step needs.
- Run the full test suite after each step. Add tests for each new rule.

## Decisions

These are fixed. Do not change them without the user.

| Topic | Decision |
| --- | --- |
| Token model | Countries and squares are ERC-721s. Each country has one ERC-6551 account (`accountOf(id)`). The account owns the country's squares. One level only: no country inside a country (`OwnershipLoop`). |
| Square moves between two different owners | Two hops. No new code. The seller splits the square to a wallet, then sends or sells it. The buyer merges it from a wallet. A direct move from one owner's account to another owner's account stays blocked (`NoConsent`). |
| Squares in wallets | Allowed. A square outside a country is a normal NFT (`countryOf == 0`). |
| Country sale | A sale includes **everything** in the country's account: squares, ETH, tokens, NFTs. |
| Empty country | When the last square leaves, the country NFT is **burned** in the same transaction. |
| Leftover-square sale | The price drops continuously. It starts at a start price, drops at a set rate, then stays at an end price. Start price, end price, rate and curve are TBD. They are constructor parameters. See BOO-5. |
| Country data | Data about a country is stored in `GaiaCountries` only, with no copy in `GaiaSquares`: `squareCount`, `compositionVersion`, the `CountryCompositionChanged` event and the account-to-country registry (`countryOfAccount`). `GaiaSquares` tells `GaiaCountries` about each change and asks it which country an address belongs to. Decided on 11 October 2026. The extra call costs about 1,000 gas for each square (less than $0.01 for 100 squares at normal Base gas prices). |
| Leftover squares | After the auction, a second issuer sells unwon squares at a price that **drops continuously** from a start price to an end price, then stays at the end price. Every square has the same price at a given time. Start price, end price, rate and curve are TBD (constructor parameters). |

Consequence of the last two rows: after the burn, nobody can control the account. Anything still in it is locked forever. The owner must empty the account before the last split. The frontend must warn about this.

## Open decision: account policy (ERC-1271 and approvals)

Step 3 waits for this decision. Steps 0, 1 and 2 do not.

**What ERC-1271 is.** A normal wallet signs messages with its private key. A contract account has no key. ERC-1271 adds `isValidSignature(hash, signature)` to the contract. An app calls it to ask the contract: "Is this signature yours?" Apps use this for off-chain marketplace listings (for example, OpenSea), gasless token approvals (ERC-20 `permit`, Uniswap Permit2), and "Sign in with Ethereum".

**Why it matters here.** ERC-6551 says an account MUST have `isValidSignature`. `GaiaCountryAccount` does not have it. So the account is not fully compliant, and some tools can fail on it.

**Why it is linked to the sale decision.** A country sale must include everything in the account. The sale checks `account.state()`. `state` changes on every `execute`. But two things can take assets out of the account **without** `execute`:

1. An approval that the account gave earlier (`approve`, `setApprovalForAll`). The approved address can take the asset later, also after the sale.
2. A signed permit. If `isValidSignature` accepts the owner's signature, the owner can sign a permit. Someone then uses it to take tokens. `state` does not change.

**Recommended default:**

- Add `isValidSignature`. It always returns "not valid" (`0xffffffff`). The account is then compliant, but it can never sign.
- In `execute`, revert calls to the standard approval functions: `approve(address,uint256)`, `setApprovalForAll(address,bool)`, `increaseAllowance(address,uint256)`, and Permit2 `approve(address,address,uint160,uint48)`.

**Cost of the default.** The account can hold and send assets. It cannot use apps that need an approval or a signature (for example, a token swap from the account). The owner must first send the assets to a wallet. Non-standard delegation functions in other contracts are not covered. Document that limit.

**Alternative.** Accept the owner's signature and allow approvals. Then the account works with more apps. But a sale cannot guarantee "everything in the account", because assets can leave without a `state` change.

The account implementation is immutable, and `accountOf` depends on its address. Decide before the first deployment to Base mainnet.

## Steps

### Step 0. Move the country counters to `GaiaCountries`

**Change:**

1. `GaiaCountries`: add `_squareCount`, `_compositionVersion`, the views `squareCount` and `compositionVersion`, and the event `CountryCompositionChanged`. Add them to `IGaiaCountries`.
2. `GaiaCountries`: add `recordSquareChange(uint256 countryId, bool added) returns (uint256 countBefore)`. Only the `squares` contract can call it (`NotSquares`). It changes the count, increments the version and emits the event.
3. `GaiaSquares._update`: call `recordSquareChange` once for the source country and once for the destination country. Use the returned `countBefore` for the first-square and last-square cases of the shape check. If the shape check fails, the transaction reverts, so the order of the call and the check does not change the result.
4. Remove the counters, their views and the event from `GaiaSquares` and `IGaiaSquares`.
5. Move the account registry. `GaiaCountries` stores `_countryOfAccount` and sets it in `createCountry`, before the mint. Add the view `countryOfAccount`. `GaiaSquares` reads it from `GaiaCountries`. Remove `registerCountry`, `countryOfAccount`, `accountOfCountry` and their storage from `GaiaSquares`. `mintToCountry` gets the account from `GaiaCountries.accountOf`.

**Tests:** move the existing count, version and registry reads to `GaiaCountries`. Add: only `GaiaSquares` can call `recordSquareChange`, and `GaiaCountries` emits the event. Make one commit for items 1 to 4, and one commit for item 5.

### Step 1. Do not admit preloaded land (BOO-36)

**Problem.** `accountOf(nextId)` is known before the country exists. A user can send a square there. When the country is created, the square joins the country without shape, consent or count checks.

**Change, in `GaiaSquares`:**

1. Add a per-square record: `mapping(uint256 => uint256) private _countryOfSquare` (square id to country id).
2. In `_update`:
   - Get `fromCountry` from `_countryOfSquare[tokenId]`, not from `_countryOfAccount[from]`.
   - Get `toCountry` from `_countryOfAccount[to]`, as now. This is correct, because registration always happens before a mint.
   - Set `_countryOfSquare[tokenId] = toCountry` (this can be 0).
3. `countryOf` and `controllerOf` read `_countryOfSquare`.
4. `_isIn` (used by the shape check) compares `_countryOfSquare[id]` with the country id. Do not compare the owner address.
5. Keep the rule "only the account can move a square out of its country". Apply it only when the square's own `fromCountry != 0`.

**Do not:**

- Revert when the account already holds squares. One square parked at `accountOf(nextId)` would then block all new countries.
- Try to find "future account addresses" on each transfer.

**Result.** A parked square stays at the account with `countryOf == 0`. The country owner can move it out with `execute`, then merge it from a wallet with the normal checks.

**Gas.** This adds one new storage slot for each minted square (about 20,000 gas). Measure settlement of 100 squares again (it was 4,699,425 gas) and change the bound in `test/Gaia_Auction.ts`. Tell the user the new number. If the user says the cost is too high, the other option is: `createCountry` skips a country id when its account already holds a square. That is cheaper, but the parked square is lost, and many parked squares can make `createCountry` run out of gas. Do not build that option without the user.

**Tests:**

- The Alice and Bob sequence from BOO-36. After it, `countryOf` of the parked square is 0. `squareCount` counts only minted squares. Country 2 exists.
- Bob moves the parked square out with `execute`, then merges it from his wallet. Shape and consent rules apply.
- All existing tests still pass.

### Step 2. Burn empty countries (BOO-33)

**Change:**

1. `GaiaCountries.recordSquareChange`: when a square leaves and the new count is 0, call `_burn` on the country. The count is in `GaiaCountries` after step 0, so no new function is necessary.
2. Keep the account registered after the burn. Then `OwnershipLoop` still stops country NFTs from going into a dead account.
3. A merge into a dead account must revert. Now `_requireConsent` calls `ownerOf` on the burned token, and that reverts with `ERC721NonexistentToken`. That is enough. Do not add a custom error unless a test needs it.

**Tests:**

- Splitting the last square burns the country. `ownerOf(country)` reverts.
- After the burn, `execute` on the account reverts. `addSquares` for that country reverts. A merge into the account reverts.
- The burn emits ERC-721 `Transfer` to the zero address and `CountryCompositionChanged` with count 0.
- ETH left in the account cannot be taken out after the burn. This test shows the documented risk.

**Docs:** in `how-it-works.md`, change the text "The country NFT continues to exist. There is no burn." and "Carol still holds the empty Country 3 NFT." Add the warning: empty the account before the last split.

### Step 3. Account policy (waits for the open decision)

If the user accepts the recommended default:

1. `GaiaCountryAccount`: add `isValidSignature(bytes32, bytes)`. It returns `0xffffffff`. Add the ERC-1271 interface id to `supportsInterface`.
2. In `execute`: read the first 4 bytes of `data`. Revert with `ApprovalNotAllowed` for the four approval functions listed above. Get the selectors with a tool (for example, viem `toFunctionSelector`). Do not type them from memory.
3. Update the contract comment. It now says "No ERC-1271 signing".
4. Tests: `isValidSignature` returns `0xffffffff` for a signature from the owner. Each approval call through `execute` reverts. A normal ERC-20 `transfer` through `execute` works. `supportsInterface` returns true for ERC-1271.

Make a ticket for this step when the user decides.

### Step 4. Country sale contract (BOO-35)

Make a new contract, for example `GaiaCountryMarket`. It needs no role on the other contracts.

- `list(countryId, price)`: the seller must own the country and must have approved the market for it.
- `cancel(countryId)`: only the seller.
- `buy(countryId, expectedVersion, expectedState)` (payable):
  - The listing exists, and the seller still owns the country.
  - `msg.value == price`.
  - `compositionVersion(countryId) == expectedVersion`.
  - `accountOf(countryId).state() == expectedState`. If the account is not deployed, a call to it reverts. Check the code size first and use 0.
  - Transfer the country to the buyer, then pay the seller. Use a reentrancy guard.
- No fees, no royalties, no buyer offers, no off-chain orders. Add them only if the user asks.

Tests: the acceptance criteria in BOO-35.

### Step 5. Tests for the land rules (part of BOO-22)

Add property tests. Make random shapes, then make random splits and merges. After each step, compare the contract result with a simple off-chain check of "connected and without holes" (flood fill). Include:

- Longitude wrap and the latitude limits.
- Empty-country burn.
- Preloaded squares (step 1).
- `squareCount` equals the number of squares with that `countryOf`.
- Destination consent, and authority after a country transfer.

Also run Slither. Fix each finding, or write down why it is safe.

### Step 6. Ticket and doc clean-up

- BOO-6 (indexer) and BOO-8 (settlement script): each has old text and two "Update" sections. Replace the text with one current specification. Events to index: `GaiaCountries.CountryCreated`, ERC-721 `Transfer` for countries (including burn) and squares, `GaiaCountries.CountryCompositionChanged`. For BOO-8: `maxSquares` is not a strict limit, because a chunk continues to the end of its row. Measure gas.
- BOO-22: add the items in step 5.
- BOO-16: remove BOO-34 (shape library) as a step before BOO-5. The leftover-square sale does not need it.
- Commit `docs/square-ownership/` (now not tracked) with the first step that changes the docs.

### Step 7. After the contract work

These tickets can start when steps 0 to 4 are merged. They are not part of this plan in detail.

- BOO-5: descending-price sale of leftover squares (second issuer). See the decision table.
- BOO-8: settlement script. BOO-6: indexer.
- BOO-7 and BOO-32: post-auction view and country account view. They must show everything in the account, and the empty-account warning before the last split.
- BOO-23: deploy module for Base.

## Not in this plan

Open auction decisions are in other tickets: BOO-13 (extra bid value), BOO-14 (anti-sniping), BOO-17 (pause), BOO-18 and BOO-19 (bid gas), BOO-20 (bid events), BOO-21 (shape rules). They do not change the land model.
