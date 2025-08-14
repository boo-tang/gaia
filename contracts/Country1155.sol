// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ICountry1155} from "./interfaces/ICountry1155.sol";

/**
 * @title Country1155
 * @notice Minimal ERC-1155 representing a country bundle for squares
 * @dev Implements IERC721Receiver to be able to custody ERC-721 square tokens
 */
contract Country1155 is ERC1155, AccessControl, IERC721Receiver, ICountry1155 {
    bytes32 public constant AUCTION_ROLE = keccak256("AUCTION_ROLE");

    // Optional storage linking country id to square token ids
    mapping(uint256 => uint256[]) private _countryToSquares;

    constructor(address admin, string memory uri_) ERC1155(uri_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AUCTION_ROLE, admin);
    }

    function mintCountry(
        address to,
        uint256 countryId,
        uint256 amount
    ) external override onlyRole(AUCTION_ROLE) {
        _mint(to, countryId, amount, "");
    }

    function attachSquares(
        uint256 countryId,
        uint256[] calldata tokenIds
    ) external override onlyRole(AUCTION_ROLE) {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            _countryToSquares[countryId].push(tokenIds[i]);
        }
    }

    function getSquares(
        uint256 countryId
    ) external view returns (uint256[] memory) {
        return _countryToSquares[countryId];
    }

    // IERC721Receiver
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
