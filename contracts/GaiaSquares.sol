// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
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

    mapping(address => uint256) private _countryOfAccount;
    mapping(uint256 => address) private _accountOfCountry;
    mapping(uint256 => uint256) private _squareCount;
    mapping(uint256 => uint256) private _compositionVersion;

    error NotCountries();
    error InvalidCoordinates();
    error AccountAlreadyRegistered();
    error UnknownCountry();
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

    function registerCountry(
        uint256 countryId,
        address account
    ) external override onlyCountries {
        if (
            _countryOfAccount[account] != 0 ||
            _accountOfCountry[countryId] != address(0)
        ) revert AccountAlreadyRegistered();
        _countryOfAccount[account] = countryId;
        _accountOfCountry[countryId] = account;
    }

    function mintToCountry(
        uint256 countryId,
        Loc[] calldata squares
    ) external override onlyCountries {
        address account = _accountOfCountry[countryId];
        if (account == address(0)) revert UnknownCountry();
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
        address owner = _ownerOf(_squareId(lat, lng));
        if (owner == address(0)) return 0;
        return _countryOfAccount[owner];
    }

    function controllerOf(
        uint16 lat,
        uint16 lng
    ) external view override returns (address) {
        address owner = _ownerOf(_squareId(lat, lng));
        if (owner == address(0)) return address(0);
        uint256 countryId = _countryOfAccount[owner];
        if (countryId == 0) return owner;
        return IERC721(countries).ownerOf(countryId);
    }

    function countryOfAccount(
        address account
    ) external view override returns (uint256) {
        return _countryOfAccount[account];
    }

    function accountOfCountry(
        uint256 countryId
    ) external view override returns (address) {
        return _accountOfCountry[countryId];
    }

    function squareCount(
        uint256 countryId
    ) external view override returns (uint256) {
        return _squareCount[countryId];
    }

    function compositionVersion(
        uint256 countryId
    ) external view override returns (uint256) {
        return _compositionVersion[countryId];
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
        uint256 fromCountry = from == address(0) ? 0 : _countryOfAccount[from];
        uint256 toCountry = _countryOfAccount[to];

        if (from == address(0) && toCountry == 0) revert NotACountryAccount();

        if (fromCountry != 0) {
            if (auth != from) revert TransferNotByAccount();
            _checkShape(from, fromCountry, lat, lng, false);
            _recordChange(fromCountry, _squareCount[fromCountry] - 1);
        }

        if (toCountry != 0) {
            if (from != address(0)) _requireConsent(auth, from, fromCountry, toCountry);
            _checkShape(to, toCountry, lat, lng, true);
            _recordChange(toCountry, _squareCount[toCountry] + 1);
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
    /// are read after the ownership change of P, so P itself is never read. The first square of a
    /// country and the removal of its last square are always allowed.
    function _checkShape(
        address account,
        uint256 countryId,
        uint16 lat,
        uint16 lng,
        bool adding
    ) private view {
        // Square count before this change: 0 when adding the first square, 1 when removing the
        // last one.
        uint256 countBefore = _squareCount[countryId];
        if (adding ? countBefore == 0 : countBefore == 1) return;

        if (_connectivityNumber(_neighbourMask(account, lat, lng)) != 1) {
            revert ShapeBroken(lat, lng);
        }
    }

    /// Bit k is set if neighbour k is in the country. Cyclic order from bit 0: E, NE, N, NW, W,
    /// SW, S, SE. Longitude wraps; rows beyond the poles are never in a country.
    function _neighbourMask(
        address account,
        uint16 lat,
        uint16 lng
    ) private view returns (uint256 mask) {
        uint16 west = lng == 0 ? LOC_MAX_LNG - 1 : lng - 1;
        uint16 east = lng == LOC_MAX_LNG - 1 ? 0 : lng + 1;
        if (_isIn(account, lat, east)) mask |= 1;
        if (_isIn(account, lat, west)) mask |= 1 << 4;
        if (lat + 1 < LOC_MAX_LAT) {
            if (_isIn(account, lat + 1, east)) mask |= 1 << 1;
            if (_isIn(account, lat + 1, lng)) mask |= 1 << 2;
            if (_isIn(account, lat + 1, west)) mask |= 1 << 3;
        }
        if (lat > 0) {
            if (_isIn(account, lat - 1, west)) mask |= 1 << 5;
            if (_isIn(account, lat - 1, lng)) mask |= 1 << 6;
            if (_isIn(account, lat - 1, east)) mask |= 1 << 7;
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

    function _recordChange(uint256 countryId, uint256 newCount) private {
        _squareCount[countryId] = newCount;
        uint256 version = ++_compositionVersion[countryId];
        emit CountryCompositionChanged(countryId, version, newCount);
    }

    function _isIn(
        address account,
        uint16 lat,
        uint16 lng
    ) private view returns (bool) {
        return _ownerOf(_squareIdUnchecked(lat, lng)) == account;
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
