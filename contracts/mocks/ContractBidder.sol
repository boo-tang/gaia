// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGaiaAuction} from "../interfaces/IGaiaAuction.sol";
import {Loc} from "../interfaces/GaiaTypes.sol";

/// Test helper: a bidder contract with no token receiver hooks.
contract ContractBidder {
    function bid(IGaiaAuction auction, Loc[] calldata locs) external payable {
        auction.bidOnShape{value: msg.value}(locs);
    }
}
