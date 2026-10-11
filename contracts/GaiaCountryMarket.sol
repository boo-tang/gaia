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
 * @dev Needs no role on other contracts. The seller approves this contract for the country.
 *      A listing stays stored when the seller transfers the country. It cannot be bought while
 *      the seller is not the owner. If the country comes back to the seller, the listing is
 *      valid again. The seller can cancel it.
 */
contract GaiaCountryMarket is ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
    }

    IGaiaCountries public immutable countries;

    mapping(uint256 => Listing) private _listings;

    event Listed(uint256 indexed countryId, address indexed seller, uint256 price);
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
        if (
            countries.getApproved(countryId) != address(this) &&
            !countries.isApprovedForAll(owner, address(this))
        ) revert MarketNotApproved();
        _listings[countryId] = Listing(owner, price);
        emit Listed(countryId, owner, price);
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
        if (msg.value != listing.price) revert WrongPrice();
        if (countries.compositionVersion(countryId) != expectedVersion) {
            revert CompositionChanged();
        }
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
