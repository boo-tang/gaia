// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICountry1155 {
    /// @notice Mints a country token id to a user
    function mintCountry(
        address to,
        uint256 countryId,
        uint256 amount
    ) external;

    /// @notice Associates the provided ERC-721 square tokenIds to a given country id
    /// @dev Implementation choice: either store mapping or rely on off-chain events
    function attachSquares(
        uint256 countryId,
        uint256[] calldata tokenIds
    ) external;
}
