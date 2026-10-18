// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IGaiaCountries} from "./interfaces/IGaiaCountries.sol";
import {IGaiaSquares} from "./interfaces/IGaiaSquares.sol";
import {Loc, LOC_MAX_LAT, LOC_MAX_LNG} from "./interfaces/GaiaTypes.sol";

/**
 * @title GaiaSquares
 * @notice ERC-721 land squares. A square is minted once, into the ERC-6551 account of a country,
 *         and is never burned. Splitting and merging land are normal transfers out of and into
 *         country accounts. Every mint and transfer is checked here:
 *         - a country stays connected and without holes;
 *         - only the account itself can move a square out of its country (no operator
 *           approvals, so approvals cannot survive a country sale);
 *         - only the owner of the destination country can add a square to it.
 * @dev Holes use 8-connected free land; the map edges at the poles count as open.
 */
contract GaiaSquares is ERC721, IGaiaSquares {
    address public immutable countries;

    // Square id => country id. 0 = standalone or unclaimed. A square joins a country only through
    // a mint or transfer into a registered account, never through a later registration.
    mapping(uint256 => uint256) private _countryOfSquare;

    error NotCountries();
    error InvalidCoordinates();
    error SquareAlreadyExists(uint16 lat, uint16 lng);
    error NotACountryAccount();
    error BurnNotAllowed();
    error TransferNotByAccount();
    error NoConsent();
    error ShapeBroken(uint16 lat, uint16 lng);

    modifier onlyCountries() {
        if (msg.sender != countries) revert NotCountries();
        _;
    }

    constructor(address countries_) ERC721("Gaia Squares", "GAIASQ") {
        countries = countries_;
    }

    // -------- GaiaCountries only --------

    function mintToCountry(
        uint256 countryId,
        Loc[] calldata squares
    ) external override onlyCountries {
        address account = IGaiaCountries(countries).accountOf(countryId);
        uint256 len = squares.length;
        for (uint256 i = 0; i < len; i++) {
            uint16 lat = squares[i].lat;
            uint16 lng = squares[i].lng;
            uint256 id = _squareId(lat, lng);
            // ERC721._mint only detects an existing token after _update has run the transfer
            // rules, which would report a misleading error.
            if (_ownerOf(id) != address(0)) revert SquareAlreadyExists(lat, lng);
            _mint(account, id);
        }
    }

    // -------- Views --------

    function exists(
        uint16 lat,
        uint16 lng
    ) external view override returns (bool) {
        return _ownerOf(_squareId(lat, lng)) != address(0);
    }

    function countryOf(
        uint16 lat,
        uint16 lng
    ) external view override returns (uint256) {
        return _countryOfSquare[_squareId(lat, lng)];
    }

    function controllerOf(
        uint16 lat,
        uint16 lng
    ) external view override returns (address) {
        uint256 id = _squareId(lat, lng);
        address owner = _ownerOf(id);
        if (owner == address(0)) return address(0);
        uint256 countryId = _countryOfSquare[id];
        if (countryId == 0) return owner;
        return IERC721(countries).ownerOf(countryId);
    }

    // -------- Transfer hook --------

    /// Runs after the ownership change, so the shape checks see the new state.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address from) {
        if (to == address(0)) revert BurnNotAllowed();
        from = super._update(to, tokenId, auth);
        if (from == to) return from;

        uint16 lat = uint16(tokenId / LOC_MAX_LNG);
        uint16 lng = uint16(tokenId % LOC_MAX_LNG);
        // The source country comes from the square's own record, not from the owner address. A
        // square that arrived at an account before its registration is standalone.
        uint256 fromCountry = _countryOfSquare[tokenId];
        uint256 toCountry = IGaiaCountries(countries).countryOfAccount(to);

        if (from == address(0) && toCountry == 0) revert NotACountryAccount();
        if (fromCountry != toCountry) _countryOfSquare[tokenId] = toCountry;

        // Check consent before the source country records the removal: the removal of its last
        // square burns it, and the consent check reads its owner.
        if (toCountry != 0 && from != address(0)) {
            _requireConsent(auth, from, fromCountry, toCountry);
        }

        // GaiaCountries records each change before the shape check. If a shape check fails, the
        // transaction reverts, so the order does not change the result.
        if (fromCountry != 0) {
            if (auth != from) revert TransferNotByAccount();
            uint256 countBefore = IGaiaCountries(countries).recordSquareChange(
                fromCountry,
                false
            );
            // The removal of the last square is always allowed.
            if (countBefore != 1) _checkShape(fromCountry, lat, lng);
        }

        if (toCountry != 0) {
            uint256 countBefore = IGaiaCountries(countries).recordSquareChange(
                toCountry,
                true
            );
            // The first square of a country is always allowed.
            if (countBefore != 0) _checkShape(toCountry, lat, lng);
        }
    }

    /// The caller must control the destination country: either its owner, or the account of
    /// another country with the same owner.
    function _requireConsent(
        address auth,
        address from,
        uint256 fromCountry,
        uint256 toCountry
    ) private view {
        address toOwner = IERC721(countries).ownerOf(toCountry);
        if (auth == toOwner) return;
        if (
            fromCountry != 0 &&
            auth == from &&
            IERC721(countries).ownerOf(fromCountry) == toOwner
        ) return;
        revert NoConsent();
    }

    /// Adding or removing square P keeps the country connected and without holes only if P is a
    /// simple point: Yokoi's 4-connectivity number of its 8 neighbours equals 1. The neighbours
    /// are read after the ownership change of P, so P itself is never read.
    function _checkShape(uint256 countryId, uint16 lat, uint16 lng) private view {
        if (_connectivityNumber(_neighbourMask(countryId, lat, lng)) != 1) {
            revert ShapeBroken(lat, lng);
        }
    }

    /// Bit k is set if neighbour k is in the country. Cyclic order from bit 0: E, NE, N, NW, W,
    /// SW, S, SE. Longitude wraps; rows beyond the poles are never in a country.
    function _neighbourMask(
        uint256 countryId,
        uint16 lat,
        uint16 lng
    ) private view returns (uint256 mask) {
        uint16 west = lng == 0 ? LOC_MAX_LNG - 1 : lng - 1;
        uint16 east = lng == LOC_MAX_LNG - 1 ? 0 : lng + 1;
        if (_isIn(countryId, lat, east)) mask |= 1;
        if (_isIn(countryId, lat, west)) mask |= 1 << 4;
        if (lat + 1 < LOC_MAX_LAT) {
            if (_isIn(countryId, lat + 1, east)) mask |= 1 << 1;
            if (_isIn(countryId, lat + 1, lng)) mask |= 1 << 2;
            if (_isIn(countryId, lat + 1, west)) mask |= 1 << 3;
        }
        if (lat > 0) {
            if (_isIn(countryId, lat - 1, west)) mask |= 1 << 5;
            if (_isIn(countryId, lat - 1, lng)) mask |= 1 << 6;
            if (_isIn(countryId, lat - 1, east)) mask |= 1 << 7;
        }
    }

    /// Yokoi's 4-connectivity number: sum over the side neighbours x_k of
    /// x_k - x_k * x_(k+1) * x_(k+2), with indices wrapping around the ring.
    function _connectivityNumber(
        uint256 mask
    ) private pure returns (uint256 nc) {
        for (uint256 k = 0; k < 8; k += 2) {
            bool side = (mask >> k) & 1 == 1;
            bool corner = (mask >> (k + 1)) & 1 == 1;
            bool nextSide = (mask >> ((k + 2) % 8)) & 1 == 1;
            if (side && !(corner && nextSide)) nc++;
        }
    }

    function _isIn(
        uint256 countryId,
        uint16 lat,
        uint16 lng
    ) private view returns (bool) {
        return _countryOfSquare[_squareIdUnchecked(lat, lng)] == countryId;
    }

    function _squareId(uint16 lat, uint16 lng) private pure returns (uint256) {
        if (lat >= LOC_MAX_LAT || lng >= LOC_MAX_LNG) revert InvalidCoordinates();
        return _squareIdUnchecked(lat, lng);
    }

    function _squareIdUnchecked(
        uint16 lat,
        uint16 lng
    ) private pure returns (uint256) {
        return uint256(lat) * LOC_MAX_LNG + lng;
    }
}
