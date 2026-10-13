// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGaiaLandSale} from "../interfaces/IGaiaLandSale.sol";

/// Test helper: a buyer contract that cannot receive ETH.
contract ContractBuyer {
    function buy(IGaiaLandSale sale, uint32[] calldata squares) external payable {
        sale.buy{value: msg.value}(squares);
    }
}
