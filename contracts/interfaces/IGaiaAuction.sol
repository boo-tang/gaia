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

    /// @notice Finalizes the auction, mints winning squares, and routes them to country ownership
    function finalize() external;
}
