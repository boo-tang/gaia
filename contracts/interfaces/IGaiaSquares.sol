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
    event CountryCompositionChanged(
        uint256 indexed countryId,
        uint256 version,
        uint256 squareCount
    );

    /// @notice The GaiaCountries contract, the only address that can mint squares.
    function countries() external view returns (address);

    /// @notice Links a country to its account. Only GaiaCountries.
    function registerCountry(uint256 countryId, address account) external;

    /// @notice Mints `squares`, in order, to the account of `countryId`. Only GaiaCountries.
    function mintToCountry(uint256 countryId, Loc[] calldata squares) external;

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

    function countryOfAccount(address account) external view returns (uint256);

    function accountOfCountry(uint256 countryId) external view returns (address);

    function squareCount(uint256 countryId) external view returns (uint256);

    /// @notice Increases on every change of the country's squares.
    function compositionVersion(
        uint256 countryId
    ) external view returns (uint256);
}
