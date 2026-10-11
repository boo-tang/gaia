// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC6551Account} from "erc6551/interfaces/IERC6551Account.sol";
import {IGaiaCountries} from "./interfaces/IGaiaCountries.sol";

/**
 * @title GaiaCountryMarket
 * @notice Fixed-price sales of countries. A sale includes everything in the country's account:
 *         squares, ETH, tokens and NFTs. The buyer gives the composition version of the country
 *         and the state of its account that they saw. If either value changed, the purchase
 *         reverts. Assets that arrive in the account after that are not checked.
 * @dev Needs no role on other contracts. The seller approves this contract for the country
 *      with `approve(market, countryId)`. An operator approval for all countries
 *      (`setApprovalForAll`) is not accepted.
 *      A listing is valid only while:
 *      - the seller owns the country,
 *      - this contract has the approval for this country. ERC-721 clears that approval on each
 *        transfer, so a listing cannot become valid again when the country comes back to the
 *        seller. The seller must approve and list again.
 *      - the composition version is the same as at the time of listing. When a square enters or
 *        leaves the country, the seller must list again.
 */
contract GaiaCountryMarket is ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
        uint256 version;
    }

    IGaiaCountries public immutable countries;

    mapping(uint256 => Listing) private _listings;

    event Listed(
        uint256 indexed countryId,
        address indexed seller,
        uint256 price,
        uint256 version
    );
    event Cancelled(uint256 indexed countryId, address indexed seller);
    event Sold(
        uint256 indexed countryId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );

    error NotCountryOwner();
    error MarketNotApproved();
    error NotListed();
    error NotSeller();
    error SellerNotOwner();
    error WrongPrice();
    error ListingOutdated();
    error CompositionChanged();
    error AccountStateChanged();
    error PaymentFailed();

    constructor(IGaiaCountries countries_) {
        countries = countries_;
    }

    /// @notice Lists a country, or changes the price of its listing.
    function list(uint256 countryId, uint256 price) external {
        address owner = countries.ownerOf(countryId);
        if (msg.sender != owner) revert NotCountryOwner();
        if (countries.getApproved(countryId) != address(this)) revert MarketNotApproved();
        uint256 version = countries.compositionVersion(countryId);
        _listings[countryId] = Listing(owner, price, version);
        emit Listed(countryId, owner, price, version);
    }

    function cancel(uint256 countryId) external {
        address seller = _listings[countryId].seller;
        if (seller == address(0)) revert NotListed();
        if (msg.sender != seller) revert NotSeller();
        delete _listings[countryId];
        emit Cancelled(countryId, seller);
    }

    /// @notice Buys a listed country. Reverts if a square entered or left the country, or if the
    ///         account executed a call, after the buyer read `expectedVersion` and
    ///         `expectedState`. Use 0 as `expectedState` for an account that is not deployed.
    function buy(
        uint256 countryId,
        uint256 expectedVersion,
        uint256 expectedState
    ) external payable nonReentrant {
        Listing memory listing = _listings[countryId];
        if (listing.seller == address(0)) revert NotListed();
        if (countries.ownerOf(countryId) != listing.seller) revert SellerNotOwner();
        // Cleared by every transfer of the country, and by a revoke of the seller.
        if (countries.getApproved(countryId) != address(this)) revert MarketNotApproved();
        if (msg.value != listing.price) revert WrongPrice();
        uint256 version = countries.compositionVersion(countryId);
        // The seller set the price for the squares at the time of listing.
        if (version != listing.version) revert ListingOutdated();
        // The buyer agreed to the squares that they saw.
        if (version != expectedVersion) revert CompositionChanged();
        if (accountState(countryId) != expectedState) revert AccountStateChanged();

        delete _listings[countryId];
        countries.safeTransferFrom(listing.seller, msg.sender, countryId);
        (bool ok, ) = listing.seller.call{value: msg.value}("");
        if (!ok) revert PaymentFailed();
        emit Sold(countryId, listing.seller, msg.sender, listing.price);
    }

    // -------- Views --------

    function listingOf(uint256 countryId) external view returns (Listing memory) {
        return _listings[countryId];
    }

    /// @notice The state of the country's account. 0 if the account is not deployed.
    function accountState(uint256 countryId) public view returns (uint256) {
        address account = countries.accountOf(countryId);
        if (account.code.length == 0) return 0;
        return IERC6551Account(payable(account)).state();
    }
}
