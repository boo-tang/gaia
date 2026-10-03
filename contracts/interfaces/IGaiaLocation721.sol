// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Exclusive upper bounds for square coordinates (1/100 degree precision).
uint16 constant LOC_MAX_LAT = 18000;
uint16 constant LOC_MAX_LNG = 36000;

interface IGaiaLocation721 {
    struct Loc {
        uint16 lat;
        uint16 lng;
    }

    /// @notice Returns true if a location already has a minted token
    function existsLoc(uint16 lat, uint16 lng) external view returns (bool);

    /// @notice Returns the tokenId for a location; reverts if it does not exist
    function tokenIdOfLoc(
        uint16 lat,
        uint16 lng
    ) external view returns (uint256);

    /// @notice Returns the owner address for a location; address(0) if unminted
    function ownerOfLoc(uint16 lat, uint16 lng) external view returns (address);

    /// @notice Mints ERC-721 tokens for the provided locations to `to`
    /// @dev Implementations must ensure locations are unique and within bounds
    function mintTo(
        address to,
        Loc[] calldata locs
    ) external returns (uint256[] memory tokenIds);
}
