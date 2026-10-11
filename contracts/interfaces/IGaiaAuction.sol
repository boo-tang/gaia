// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Loc} from "./GaiaTypes.sol";

interface IGaiaAuction {
    /// @notice Highest bid per location
    /// @dev Implementers may expose views for current highest bid and bidder

    /// @notice Bids on a convex shape of locations; `msg.value` must cover the sum of next bids
    function bidOnShape(Loc[] calldata locs) external payable;

    /// @notice Withdraws refunds for outbid amounts and overpayments
    function withdraw() external returns (bool);

    /// @notice Sends the sum of all winning bids to the treasury after the auction ends.
    ///         Callable by anyone. Does not touch bidder refunds in `pendingReturns`.
    function withdrawProceeds() external;

    /// @notice Settles a winning shape after the auction ends: adds its still-owned squares to a
    ///         country in GaiaCountries and, once fully processed, transfers the country to the
    ///         winner. Callable by anyone; resumable via `maxSquares` for shapes too large to
    ///         settle in a single transaction.
    /// @param shapeId The shape to settle.
    /// @param maxSquares Minimum number of squares to process in this call; the call continues to
    ///        the end of the current latitude row. 0 means no limit.
    function settleShape(uint256 shapeId, uint256 maxSquares) external;

    /// @notice Returns the shape that currently owns the square; 0 if no shape owns it.
    function squareShapeId(
        uint16 lat,
        uint16 lng
    ) external view returns (uint256);
}
