// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Loc} from "./GaiaTypes.sol";

/**
 * @title IGaiaSquares
 * @notice ERC-721 land squares. Token ID = lat * 36000 + lng. A square in a country is owned by
 *         the country's ERC-6551 account.
 */
interface IGaiaSquares is IERC721 {
    /// @notice The GaiaCountries contract, the only address that can mint squares.
    function countries() external view returns (address);

    /// @notice Mints `squares`, in order, to the account of `countryId`. Only GaiaCountries.
    function mintToCountry(uint256 countryId, Loc[] calldata squares) external;

    /// @notice Moves the caller's squares `ids` to `to`, one at a time, in the order of `ids`. Each
    ///         move is a `transferFrom(msg.sender, to, id)`, so all transfer rules apply to each
    ///         square: only the account moves a square out of its country, the owner of the
    ///         destination country must consent (`NoConsent`), and each square must keep both
    ///         countries connected and without holes (`ShapeBroken`). A country account calls it
    ///         through `execute`. A wallet calls it directly. If one square fails, nothing moves.
    ///         A move of the last square of a country burns the country. An empty list does
    ///         nothing.
    /// @param ids ERC-721 token IDs (`lat * 36000 + lng`).
    function moveSquares(address to, uint256[] calldata ids) external;

    /// @notice Returns true if the square was ever claimed (it is never burned).
    function exists(uint16 lat, uint16 lng) external view returns (bool);

    /// @notice Returns the country that holds the square; 0 if unclaimed or standalone.
    function countryOf(uint16 lat, uint16 lng) external view returns (uint256);

    /// @notice Returns the address that controls the square: the country owner if the square is
    ///         in a country, otherwise the square owner; address(0) if unclaimed.
    function controllerOf(
        uint16 lat,
        uint16 lng
    ) external view returns (address);
}
