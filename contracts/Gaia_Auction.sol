// contracts/Gaia_Auction.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract GaiaAuction {
    /**
     * Lat can have values from -90.00 -> 90.00
     * Long can have values from -180.00 -> 180.00
     * we want positive integers so the ranges become:
     * lat: 0 -> 18,000
     * lng: 0 -> 36,000
     */
    uint16 constant maxLat = 18000;
    uint16 constant maxLng = 36000;

    // starting price per location
    uint constant minBid = 0.001 ether;

    // Parameters of the auction. Times are either
    // absolute unix timestamps (seconds since 1970-01-01)
    // or time periods in seconds.
    address payable public beneficiary;
    uint public auctionEndTime;

    // custom struct to hold bidder + bid information on a locatoin
    struct Bid {
      address bidder;
      uint bidAmount;
    }

    // Location struct that holds lat + long info
    struct Loc {
        uint16 lat;
        uint16 lng;
    }

    // Current state of the auction.
    mapping(uint16 => mapping(uint16 => Bid)) public highestBids;

    // Allowed withdrawals of previous bids
    mapping(address => uint) pendingReturns;

    // Set to true at the end, disallows any change.
    // By default initialized to `false`.
    bool ended;

    // Events that will be emitted on changes.
    event HighestBidIncreased(address bidder, uint amount, Loc location);
    event AuctionEnded(address winner, uint amount);

    // Errors

    /// The auction has already ended.
    error AuctionAlreadyEnded();
    /// There is already a higher or equal bid.
    error BidNotHighEnough(uint highestBid);
    /// Not enough ether send to cover bids
    error NotEnoughEthSent();
    /// The auction has not ended yet.
    error AuctionNotYetEnded();
    /// The function auctionEnd has already been called.
    error AuctionEndAlreadyCalled();

    // CONSTRUCTOR

    /// Create a simple auction with `biddingTime`
    /// seconds bidding time on behalf of the
    /// beneficiary address `beneficiaryAddress`.
    constructor(
        uint biddingTime,
        address payable beneficiaryAddress
    ) {
        beneficiary = beneficiaryAddress;
        auctionEndTime = block.timestamp + biddingTime;
    }
    /// Bid on the auction with the value sent
    /// together with this transaction.
    /// The value is divided between the locations
    /// to determine the bid per location
    /// The value will only be refunded if the
    /// auction is not won.
    function bid(Loc[] memory locs) external payable {
        // Revert the call if the bidding
        // period is over.
        if (block.timestamp > auctionEndTime)
            revert AuctionAlreadyEnded();

        require(locs.length > 0);

        uint totalBidSent = msg.value;
        uint totalBidRequired = 0;

        // calculate how much is required
        // to outbid all locations requested
        for (uint i = 0; i < locs.length; i++) {
          Loc memory loc = locs[i];
          Bid memory currentBid = highestBids[loc.lat][loc.lng];
          uint newBidAmount = getNextBid(currentBid.bidAmount);

          // check total amount is enough
          totalBidRequired += newBidAmount;
          if (totalBidSent <= totalBidRequired) {
            revert NotEnoughEthSent();
          }


          // store previous bidder's ETH for withdrawal
          pendingReturns[currentBid.bidder] += currentBid.bidAmount;

          // update highest bidder for location
          Bid memory newBid = Bid(msg.sender, newBidAmount);
          highestBids[loc.lat][loc.lng] = newBid;
          emit HighestBidIncreased(msg.sender, newBidAmount, loc);
        }
    }


    /// Withdraw a bid that was overbid.
    function withdraw() external returns (bool) {
        uint amount = pendingReturns[msg.sender];
        if (amount > 0) {
            // It is important to set this to zero because the recipient
            // can call this function again as part of the receiving call
            // before `send` returns.
            pendingReturns[msg.sender] = 0;

            if (!payable(msg.sender).send(amount)) {
                // No need to call throw here, just reset the amount owing
                pendingReturns[msg.sender] = amount;
                return false;
            }
        }
        return true;
    }

    /// Increments a bid amount by a pre-set ETH amount
    function getNextBid(uint bidAmount) public pure returns (uint) {
      if (bidAmount < minBid) {
        return minBid;
      }

      if (bidAmount < 0.01 ether) {
        return bidAmount + 0.001 ether;
      }
      if (bidAmount < 0.1 ether) {
        return bidAmount + 0.01 ether;
      }
      return bidAmount + 0.1 ether;
    }
}