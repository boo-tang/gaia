// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC6551Account} from "erc6551/interfaces/IERC6551Account.sol";
import {IERC6551Executable} from "erc6551/interfaces/IERC6551Executable.sol";

/**
 * @title GaiaCountryAccount
 * @notice Minimal, immutable ERC-6551 account implementation for Gaia countries. The account owns
 *         the country's square NFTs and can hold other assets. Only the current owner of the
 *         country NFT can act through it, with plain calls only.
 * @dev No delegatecall, no upgrades, no plugins and no stored permissions: authority always
 *      follows the current owner of the country NFT. No ERC-1271 signing, so the account cannot
 *      sign off-chain orders.
 */
contract GaiaCountryAccount is
    IERC165,
    IERC6551Account,
    IERC6551Executable,
    IERC721Receiver,
    IERC1155Receiver
{
    uint256 public state;

    error NotOwner();
    error UnsupportedOperation();

    receive() external payable {}

    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external payable returns (bytes memory result) {
        if (msg.sender != owner()) revert NotOwner();
        if (operation != 0) revert UnsupportedOperation();

        ++state;

        bool success;
        (success, result) = to.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function isValidSigner(
        address signer,
        bytes calldata
    ) external view returns (bytes4) {
        if (signer == owner()) return IERC6551Account.isValidSigner.selector;
        return bytes4(0);
    }

    /// The registry appends (salt, chainId, tokenContract, tokenId) to the proxy bytecode.
    function token() public view returns (uint256, address, uint256) {
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) external pure returns (bool) {
        return
            interfaceId == type(IERC165).interfaceId ||
            interfaceId == type(IERC6551Account).interfaceId ||
            interfaceId == type(IERC6551Executable).interfaceId ||
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId;
    }
}
