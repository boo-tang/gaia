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
    event CountryCompositionChanged(
        uint256 indexed countryId,
        uint256 version,
        uint256 squareCount
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

    /// @notice Records that a square entered (`added`) or left the country, and returns the
    ///         square count before the change.
    /// @dev GaiaSquares only.
    function recordSquareChange(
        uint256 countryId,
        bool added
    ) external returns (uint256 countBefore);

    function squareCount(uint256 countryId) external view returns (uint256);

    /// @notice Increases on every change of the country's squares.
    function compositionVersion(
        uint256 countryId
    ) external view returns (uint256);

    /// @notice Returns the country of a registered country account; 0 for any other address.
    function countryOfAccount(address account) external view returns (uint256);

    /// @notice Returns the ERC-6551 account of a country (deployed or not).
    function accountOf(uint256 countryId) external view returns (address);

    /// @notice Returns the auctions whose reservations block other issuers.
    function auctions() external view returns (address[] memory);
}
