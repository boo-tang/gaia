// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IGaiaLocation721} from "./interfaces/IGaiaLocation721.sol";

/**
 * @title GaiaLocation721
 * @notice ERC-721 representing world map squares (tiles). Coordinates are discretized as integers:
 *         lat in [0..18000], lng in [0..36000] for a precision of 1/100 degree.
 * @dev No on-chain enumeration to minimize gas. Use events/off-chain indexing for lists.
 */
contract GaiaLocation721 is ERC721, AccessControl, IGaiaLocation721 {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Coordinate bounds (same scheme used elsewhere in the repo)
    uint16 public constant MAX_LAT = 18000;
    uint16 public constant MAX_LNG = 36000;

    // Next token id to assign (starts at 0 for typical ERC721; you can start at 1 if preferred)
    uint256 private _nextTokenId;

    // Storage for existence and mappings
    mapping(uint16 => mapping(uint16 => bool)) private _locationMinted;
    mapping(uint16 => mapping(uint16 => uint256)) private _tokenIdByLocation;
    mapping(uint256 => Loc) private _locationByTokenId;

    constructor(address admin) ERC721("Gaia Squares", "GAIA") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _nextTokenId = 0;
    }

    // -------- Views --------

    function existsLoc(
        uint16 lat,
        uint16 lng
    ) public view override returns (bool) {
        return _locationMinted[lat][lng];
    }

    function tokenIdOfLoc(
        uint16 lat,
        uint16 lng
    ) external view override returns (uint256) {
        require(_locationMinted[lat][lng], "Location not minted");
        return _tokenIdByLocation[lat][lng];
    }

    function ownerOfLoc(
        uint16 lat,
        uint16 lng
    ) external view override returns (address) {
        if (!_locationMinted[lat][lng]) {
            return address(0);
        }
        uint256 tokenId = _tokenIdByLocation[lat][lng];
        return ownerOf(tokenId);
    }

    function locationOfToken(
        uint256 tokenId
    ) external view returns (Loc memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _locationByTokenId[tokenId];
    }

    // -------- Minting --------

    function mintTo(
        address to,
        Loc[] calldata locs
    )
        external
        override
        onlyRole(MINTER_ROLE)
        returns (uint256[] memory tokenIds)
    {
        uint256 len = locs.length;
        if (len == 0) {
            return new uint256[](0);
        }

        tokenIds = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            Loc calldata loc = locs[i];
            _validateLoc(loc.lat, loc.lng);
            require(
                !_locationMinted[loc.lat][loc.lng],
                "Location already minted"
            );

            uint256 tokenId = _nextTokenId;
            _nextTokenId = tokenId + 1;

            _safeMint(to, tokenId);

            _locationMinted[loc.lat][loc.lng] = true;
            _tokenIdByLocation[loc.lat][loc.lng] = tokenId;
            _locationByTokenId[tokenId] = Loc(loc.lat, loc.lng);

            tokenIds[i] = tokenId;
        }

        return tokenIds;
    }

    // -------- Internal --------

    function _validateLoc(uint16 lat, uint16 lng) internal pure {
        require(lat < MAX_LAT && lng < MAX_LNG, "Invalid coordinates");
    }

    // -------- Overrides --------

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
