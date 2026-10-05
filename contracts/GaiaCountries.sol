// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC6551AccountLib} from "erc6551/lib/ERC6551AccountLib.sol";
import {IGaiaCountries} from "./interfaces/IGaiaCountries.sol";
import {IGaiaSquares} from "./interfaces/IGaiaSquares.sol";
import {IGaiaAuction} from "./interfaces/IGaiaAuction.sol";
import {Loc} from "./interfaces/GaiaTypes.sol";

/**
 * @title GaiaCountries
 * @notice ERC-721 countries. Each country has one ERC-6551 account, derived from a fixed registry,
 *         account implementation and salt, which owns the country's square NFTs in GaiaSquares.
 *         Only issuer contracts (auctions, sales) can create or grow countries. The admin can
 *         manage issuers and auctions but cannot mint.
 */
contract GaiaCountries is ERC721, AccessControl, IGaiaCountries {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant ACCOUNT_SALT = bytes32(0);

    address public immutable registry;
    address public immutable accountImplementation;
    IGaiaSquares public squares;

    // Country ids start at 1; 0 means "no country".
    uint256 private _nextCountryId = 1;
    address[] private _auctions;

    error EmptySquares();
    error SquaresNotSet();
    error SquaresAlreadySet();
    error SquaresMismatch();
    error SquareReserved(uint16 lat, uint16 lng);
    error UnknownCountry();
    error NotCountryOwner();
    error AuctionAlreadyAdded();
    error UnknownAuction();
    error OwnershipLoop();

    constructor(
        address admin,
        address registry_,
        address accountImplementation_
    ) ERC721("Gaia Countries", "GAIA") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registry_;
        accountImplementation = accountImplementation_;
    }

    // -------- Issuers --------

    function createCountry(
        address owner,
        Loc[] calldata squareLocs
    ) external override onlyRole(ISSUER_ROLE) returns (uint256 countryId) {
        if (squareLocs.length == 0) revert EmptySquares();
        IGaiaSquares squares_ = _requireSquares();
        _requireNotReserved(squareLocs);

        countryId = _nextCountryId++;
        address account = accountOf(countryId);
        // Register before minting so that the ownership-loop guard already knows the account.
        squares_.registerCountry(countryId, account);
        _mint(owner, countryId);
        emit CountryCreated(countryId, owner, account, msg.sender);

        squares_.mintToCountry(countryId, squareLocs);
    }

    function addSquares(
        uint256 countryId,
        address buyer,
        Loc[] calldata squareLocs
    ) external override onlyRole(ISSUER_ROLE) {
        if (squareLocs.length == 0) revert EmptySquares();
        IGaiaSquares squares_ = _requireSquares();

        address owner = _ownerOf(countryId);
        if (owner == address(0)) revert UnknownCountry();
        if (owner != buyer) revert NotCountryOwner();

        _requireNotReserved(squareLocs);
        squares_.mintToCountry(countryId, squareLocs);
    }

    // -------- Admin --------

    /// @notice Links the square contract. Callable once, because each contract needs the other's
    ///         address.
    function setSquares(
        IGaiaSquares squares_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(squares) != address(0)) revert SquaresAlreadySet();
        if (squares_.countries() != address(this)) revert SquaresMismatch();
        squares = squares_;
    }

    function addAuction(
        address auction
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 len = _auctions.length;
        for (uint256 i = 0; i < len; i++) {
            if (_auctions[i] == auction) revert AuctionAlreadyAdded();
        }
        _auctions.push(auction);
        emit AuctionAdded(auction);
    }

    function removeAuction(
        address auction
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 len = _auctions.length;
        for (uint256 i = 0; i < len; i++) {
            if (_auctions[i] == auction) {
                _auctions[i] = _auctions[len - 1];
                _auctions.pop();
                emit AuctionRemoved(auction);
                return;
            }
        }
        revert UnknownAuction();
    }

    // -------- Views --------

    function accountOf(
        uint256 countryId
    ) public view override returns (address) {
        return
            ERC6551AccountLib.computeAddress(
                registry,
                accountImplementation,
                ACCOUNT_SALT,
                block.chainid,
                address(this),
                countryId
            );
    }

    function auctions() external view override returns (address[] memory) {
        return _auctions;
    }

    // -------- Internal --------

    function _requireSquares() private view returns (IGaiaSquares squares_) {
        squares_ = squares;
        if (address(squares_) == address(0)) revert SquaresNotSet();
    }

    /// An issuer cannot use a square that another registered auction reserves.
    function _requireNotReserved(Loc[] calldata squareLocs) private view {
        address[] memory auctionList = _auctions;
        uint256 auctionCount = auctionList.length;
        uint256 len = squareLocs.length;
        for (uint256 j = 0; j < auctionCount; j++) {
            address auction = auctionList[j];
            if (auction == msg.sender) continue;
            for (uint256 i = 0; i < len; i++) {
                uint16 lat = squareLocs[i].lat;
                uint16 lng = squareLocs[i].lng;
                if (IGaiaAuction(auction).squareShapeId(lat, lng) != 0) {
                    revert SquareReserved(lat, lng);
                }
            }
        }
    }

    /// A country can never be owned by a country account (its own or another's, deployed or not):
    /// that would create an ownership cycle and nobody could control the country again.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        IGaiaSquares squares_ = squares;
        if (
            address(squares_) != address(0) &&
            squares_.countryOfAccount(to) != 0
        ) revert OwnershipLoop();
        return super._update(to, tokenId, auth);
    }

    // -------- Overrides --------

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl, IERC165) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
