// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Loc} from "./GaiaTypes.sol";

/**
 * @title IGaiaCountries
 * @notice ERC-721 countries. Each country has one ERC-6551 account that owns its square NFTs.
 *         Only addresses with the issuer role can create or grow countries.
 */
interface IGaiaCountries is IERC721 {
    event CountryCreated(
        uint256 indexed countryId,
        address indexed owner,
        address account,
        address indexed issuer
    );
    event AuctionAdded(address indexed auction);
    event AuctionRemoved(address indexed auction);

    /// @notice Mints a new country to `owner` and mints `squares`, in order, into its account.
    /// @dev Issuer only. Each square must be unclaimed and not reserved by a registered auction
    ///      (the calling auction may use its own reservations). GaiaSquares checks the shape.
    function createCountry(
        address owner,
        Loc[] calldata squares
    ) external returns (uint256 countryId);

    /// @notice Mints `squares`, in order, into the account of an existing country.
    /// @dev Issuer only. `buyer` must own the country.
    function addSquares(
        uint256 countryId,
        address buyer,
        Loc[] calldata squares
    ) external;

    /// @notice Returns the ERC-6551 account of a country (deployed or not).
    function accountOf(uint256 countryId) external view returns (address);

    /// @notice Returns the auctions whose reservations block other issuers.
    function auctions() external view returns (address[] memory);
}
