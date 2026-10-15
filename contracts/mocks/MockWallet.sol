// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Test helper: a contract wallet that sends any call. It can refuse ETH, and it can make one call
/// back when it receives ETH or an ERC-721 token (to test reentrancy).
contract MockWallet {
    bool public acceptEth = true;
    address private _hookTarget;
    bytes private _hookData;

    function setAcceptEth(bool accept) external {
        acceptEth = accept;
    }

    /// The next receipt of ETH or of an ERC-721 token calls `target` with `data`, once. If that
    /// call reverts, the receipt reverts with the same error. `target` 0 removes the hook.
    function setHook(address target, bytes calldata data) external {
        _hookTarget = target;
        _hookData = data;
    }

    /// Calls `target` with `value` and `data`. Reverts with the error of `target`.
    function exec(
        address target,
        uint256 value,
        bytes calldata data
    ) external payable returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    receive() external payable {
        require(acceptEth, "MockWallet: ETH refused");
        _runHook();
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        _runHook();
        return this.onERC721Received.selector;
    }

    function _runHook() private {
        address target = _hookTarget;
        if (target == address(0)) return;
        _hookTarget = address(0);
        (bool ok, bytes memory result) = target.call(_hookData);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
}
