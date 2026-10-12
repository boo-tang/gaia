// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGaiaAuction} from "../interfaces/IGaiaAuction.sol";

/// Test helper: a bidder contract with no token receiver hooks.
contract ContractBidder {
    function bid(IGaiaAuction auction, uint32[] calldata squares) external payable {
        auction.bidOnShape{value: msg.value}(squares, 0, false);
    }
}
