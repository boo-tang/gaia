// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGaiaLocation721} from "./IGaiaLocation721.sol";

interface IGaiaAuction {
    /// @notice Highest bid per location
    /// @dev Implementers may expose views for current highest bid and bidder

    /// @notice Bids on a convex shape of locations; `msg.value` must cover the sum of next bids
    function bidOnShape(IGaiaLocation721.Loc[] calldata locs) external payable;

    /// @notice Withdraws refunds for outbid amounts
    function withdraw() external returns (bool);

    /// @notice Settles a winning shape after the auction ends: mints its still-owned squares as
    ///         ERC-721 tokens into Country1155 custody and, once fully processed, mints the
    ///         corresponding country token to the winner. Callable by anyone; resumable via
    ///         `maxSquares` for shapes too large to settle in a single transaction.
    /// @param shapeId The shape to settle.
    /// @param maxSquares Maximum number of squares to process in this call; 0 means no limit.
    function settleShape(uint256 shapeId, uint256 maxSquares) external;
}
