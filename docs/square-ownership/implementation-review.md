# Country account implementation review

Review date: 5 October 2026. Reviewed revision: `d353673` (`feat: mint squares into country ERC-6551 accounts`).

This follows the [original ownership analysis](README.md). That document describes the earlier registry-only implementation; this review assesses the subsequent country-account implementation and Gaia's updated Linear ticket descriptions, read on 5 October 2026. Findings below distinguish confirmed defects from planned work and recommendations. This is a focused review, not a security audit.

## Assessment

**Keep this architecture, but fix the confirmed future-account registration bug before building further on it.** The code now closely follows the recommended model: permanent square ERC-721s owned by minimal, immutable accounts controlled through country ERC-721s.

The adopted model in [BOO-16](https://linear.app/boo-tang/issue/BOO-16) and split/merge scope in [BOO-33](https://linear.app/boo-tang/issue/BOO-33) match this direction. Protected country sales are explicitly planned in [BOO-35](https://linear.app/boo-tang/issue/BOO-35), so their absence from the current contracts is staged work rather than a missing roadmap item. The most important remaining specification gaps are future-account registration, ERC-1271 compliance, and broader country/account invariant tests.

The implementation addresses several concerns from the original analysis:

- Squares retain their coordinate-derived token IDs through splitting and merging.
- Each country has a deterministic account address, recognized before account deployment.
- Account execution follows the current country owner, without upgrades, plugins, or stored delegates.
- Bundled squares reject external operator transfers, including after a country sale.
- Transfers into an existing country require destination-owner consent.
- Square membership changes increment the country's composition version.
- Auction settlement orders squares to satisfy incremental shape checks and holds the country until settlement completes.

Relevant contracts: [GaiaCountries](../../contracts/GaiaCountries.sol), [GaiaSquares](../../contracts/GaiaSquares.sol), [GaiaCountryAccount](../../contracts/GaiaCountryAccount.sol), and [GaiaAuction](../../contracts/GaiaAuction.sol).

## Confirmed defect: preloading a future country account

**Priority: high.** `GaiaSquares.registerCountry` registers an address without handling square NFTs already owned by that address. Because `GaiaCountries.accountOf` can calculate future country account addresses, land can arrive before registration.

A targeted test reproduced this sequence:

1. Create Country #1 for Alice with square `(10, 10)`.
2. Calculate `accountOf(2)` before Country #2 exists.
3. Alice uses Country #1's account to transfer its square to that future address. The source becomes empty; the destination is treated as an ordinary address because it is not registered yet.
4. Create Country #2 for Bob with the distant square `(100, 100)`.

The resulting state is inconsistent:

| Read | Result |
| --- | --- |
| `countryOf(10, 10)` | Country #2 |
| `countryOf(100, 100)` | Country #2 |
| Square ERC-721 `balanceOf(accountOf(2))` | 2 |
| `squareCount(2)` | 1 |
| `compositionVersion(2)` | 1 |

Registering the account retroactively changes the first square's country membership without a transfer. The square bypasses destination consent, geometry validation, composition accounting, and the corresponding composition-change event. The two distant squares form a disconnected country. Subsequent split logic also relies on an incorrect count, including its special handling of the last square.

The relevant paths are `registerCountry`, `countryOf`, and `_update` in `GaiaSquares`, plus account registration during `GaiaCountries.createCountry`.

**Required outcome:** account registration must not silently admit pre-existing land into a country. Define and implement an explicit policy for assets received before registration, with a regression test covering the sequence above.

Simply rejecting a nonempty account is not a complete fix: an attacker could preload the next sequential country's address and repeatedly block creation at that ID. The design must preserve both correct membership accounting and progress of country creation. No specific repair was implemented or validated during this review.

This case is not explicitly covered by the reviewed acceptance criteria in BOO-16 or BOO-33. Add it to the ownership implementation scope rather than deferring it to frontend work or a general audit.

## Standards gap: ERC-1271 is omitted

**Priority: medium; resolve before treating the account as fully ERC-6551 compliant.** `GaiaCountryAccount` explicitly excludes ERC-1271 signature validation. ERC-6551 requires account implementations to implement it. See the [ERC-6551 account interface requirements](https://eips.ethereum.org/EIPS/eip-6551#account-interface).

Disabling off-chain account orders is a reasonable initial product constraint. Omitting the signature-validation interface is a separate decision and creates a standards-compliance gap.

Add the interface with a documented validation policy. An initially rejecting implementation can preserve the no-off-chain-orders constraint; supporting valid signatures later requires deliberate ownership-change and replay semantics. Add interface and signature-policy tests. Avoid adding broad signing functionality merely to satisfy the interface requirement.

The reviewed account-design tickets do not specify this interface or its validation policy. Resolve it as part of BOO-16's minimal account implementation.

## Planned feature: protected country sales

The square contract now increments `compositionVersion` on membership changes. This is the necessary tracking mechanism, but the reviewed contracts do not bind a buyer's offer to that version.

Before country trading launches, the sale path must check the buyer's expected composition version atomically with payment and country transfer. A frontend check leaves a race between inspection and transaction execution. Checking only square count also fails when one square is replaced with another of different value.

A dedicated sale mechanism, compatible marketplace validation, or an explicit locking design is still needed. Ordinary ERC-721 country transfers do not enforce a buyer's expected contents. The buyer must also have an accurate view of the country when committing to a version. Related asset-removal fraud is discussed in the [ERC-6551 security considerations](https://eips.ethereum.org/EIPS/eip-6551#fraud-prevention).

[BOO-35](https://linear.app/boo-tang/issue/BOO-35) already specifies atomic expected-version validation, rejection after a split or merge, and the limitation of external marketplaces. This is the right scope. Make it a prerequisite for launching Gaia's country-sale flow; it is currently related to the ownership and account-frontend tickets, without explicit blocking relations.

## Geometry: clearer policy, stronger validation needed

The implementation now chooses connected, hole-free countries, using a local connectivity calculation for each square change. Free space uses eight-neighbor connectivity, longitude wraps, and polar map edges are treated as open. Operations are order-dependent: a batch with a valid final shape can still fail if its intermediate states are invalid.

These are meaningful product rules, now explicitly documented in BOO-16 and BOO-33. Auction settlement reorders each row to satisfy incremental growth, addressing a practical consequence of those rules.

Before deployment, add independent property tests that compare accepted changes against global connectivity and hole checks on generated shapes. Include additions, removals, transfers between countries, empty-country transitions, longitude wrapping, and polar boundaries. Validate settlement ordering across chunk boundaries as well.

The existing example tests are useful, but they do not establish the full geometric guarantee. The future-account bug also demonstrates why valid initial state and complete control over every membership transition are prerequisites for an incremental invariant.

[BOO-22](https://linear.app/boo-tang/issue/BOO-22) already covers fuzzing, invariants, differential tests, gas limits, static analysis, and an external audit. Its concrete examples focus on auction validation and funds. Expand it to cover country topology, pre-existing assets at account registration, square-count consistency, composition accounting, destination consent, and authority after country transfers. Frontend-versus-Solidity validator agreement alone does not independently establish the country invariant.

## Scope of account asset protection

The account can hold unrelated ERC-20s and NFTs. Gaia's restrictions on square transfers do not invalidate approvals those other assets grant to external operators. Such approvals can persist after a country sale because the account address remains unchanged.

Initially describe the country-sale guarantees as covering Gaia land. If arbitrary account assets are intended to be part of a sale, define separate commitments, approval handling, and buyer-facing behavior. The land composition version does not describe the account's entire portfolio.

This distinction needs tightening between [BOO-32](https://linear.app/boo-tang/issue/BOO-32), which displays squares and other account assets, and BOO-35, whose problem statement mentions removing other assets but whose version counter only tracks land. Either narrow the sale guarantee to Gaia squares or separately specify protection for the additional assets. Showing all assets beside a composition version must not imply that all of them are covered by it.

## Issuer administration remains a trust assumption

[BOO-12](https://linear.app/boo-tang/issue/BOO-12) correctly removes issuer access from the admin's initial roles and moves administration to a multisig. However, retaining `DEFAULT_ADMIN_ROLE` allows that multisig to grant `ISSUER_ROLE`, including to itself, and manage the registered auction list.

The accurate guarantee is that the admin cannot mint through the issuer entry points without first obtaining issuer access. It is not a permanent prohibition on admin-authorized minting. Keeping the ability to add future sale contracts is a reasonable design choice, but the documentation and tests should distinguish initial role separation from immutable restrictions on administration.

## Roadmap and ticket refinements

The implementation order is broadly sensible. A few adjustments would make the tickets more actionable:

- **Keep the flat-fee sale independent of the optional library refactor.** [BOO-5](https://linear.app/boo-tang/issue/BOO-5) explicitly requires only the central connected, hole-free country rules. [BOO-34](https://linear.app/boo-tang/issue/BOO-34) extracts stricter auction size, convexity, and aspect-ratio checks that this sale will not use. BOO-16 currently puts that refactor before the sale; there is no functional need for it to block the sale unless another concrete dependency appears.
- **Rewrite the indexer specification around the final events.** [BOO-6](https://linear.app/boo-tang/issue/BOO-6) has a correct latest update identifying `CountryCreated`, country and square `Transfer` events, and `CountryCompositionChanged`, but still contains older instructions about removed events. Replace the superseded text with one specification. Include the distinction between standalone claimed squares and unminted land, and update controlling ownership after country transfers even though the squares emit no transfer events then.
- **Rewrite settlement instructions and document chunk limits.** [BOO-8](https://linear.app/boo-tang/issue/BOO-8) retains a statement that settlement will not mint square tokens, contradicted by its latest update. The final specification should describe square minting into country accounts, auction custody until completion, and row-aligned chunks. `maxSquares` is not a strict upper bound because processing extends to the row boundary; the operator must estimate gas accordingly.
- **Retain the benchmark acceptance criteria.** BOO-16 requests settlement measurements for 100 and 400 squares plus split, merge, and country transfer; BOO-33 requests split and merge measurements. The tests run during this review do not establish that the full benchmark deliverable is complete.

These are recommendations based on the ticket descriptions and relations read during this review. No Linear tickets were edited.

## Validation performed

The existing contract suites were run with:

```sh
./node_modules/.bin/hardhat test test/GaiaCountries.ts test/GaiaSquares.ts test/Gaia_Auction.ts
```

**Result: 96 tests passed.** Hardhat emitted a warning that the installed Node.js version, `v22.15.1`, was unsupported by that Hardhat version.

An additional temporary test asserted the inconsistent future-account state shown above and passed, confirming the defect. Passing that reproducer means the undesirable behavior occurred; it does not indicate correctness. The temporary test was removed after the review. No contract fixes were made, and the working tree was clean before this write-up.

## Suggested priority

1. Fix future-account registration and retain a regression test for preloaded land and creation progress.
2. Implement the ERC-1271 interface with an explicit signature policy.
3. Expand BOO-22 and independently validate country/account invariants and batch settlement behavior.
4. Complete BOO-35 before launching country sales, explicitly defining whether its guarantees cover land only.
5. Consolidate the final event and settlement specifications in BOO-6 and BOO-8, then complete frontend and indexer integration.
6. Proceed with BOO-5 once its actual ownership and issuer dependencies are ready; treat BOO-34 as an optional refactor rather than a required predecessor.
