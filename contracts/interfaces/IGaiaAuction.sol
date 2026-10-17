// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGaiaAuction {
    /// @notice Bids on a convex shape of squares. Each square of a different bidder, or with no
    ///         bid, gets the larger of its next bid and `floorPerSquare`. An own square (the caller
    ///         is its highest bidder) keeps its amount and costs 0, or, if `raiseOwnSquares` is
    ///         true, goes up to the same amount and costs only the difference. All squares move
    ///         to the new shape. `msg.value` must cover the sum; the excess goes to
    ///         `pendingReturns`. A bid that raises at least one amount, with less than
    ///         `extensionWindow` seconds left, extends the auction (see GaiaAuction). Emits one
    ///         `ShapeBid` event with the new shape ID, its squares and their amounts.
    /// @param squares The squares, each packed as `(uint32(lat) << 16) | lng`, with
    ///        `lat < 18000` and `lng < 36000`. Sorted by latitude, then west to east (the same
    ///        packing and order as the `ShapeBid` event).
    /// @param floorPerSquare Minimum amount per square (a jump bid). 0 bids the minimum.
    /// @param raiseOwnSquares If true, own squares also go up. If false, they keep their amount.
    function bidOnShape(
        uint32[] calldata squares,
        uint256 floorPerSquare,
        bool raiseOwnSquares
    ) external payable;

    /// @notice Withdraws refunds for outbid amounts and overpayments. After a cancel, also
    ///         withdraws the caller's current highest bids. Works also when the auction is paused.
    ///         Emits `Withdrawn(bidder, amount)` when it sends ETH. Returns false, with no event and
    ///         no change, when the send fails.
    function withdraw() external returns (bool);

    /// @notice Sends the sum of all winning bids to the treasury after the auction ends.
    ///         Callable by anyone. Does not touch bidder refunds in `pendingReturns`.
    function withdrawProceeds() external;

    /// @notice Settles a winning shape after the auction ends: adds its still-owned squares to a
    ///         country in GaiaCountries and, once fully processed, transfers the country to the
    ///         winner. Callable by anyone; resumable via `maxSquares` for shapes too large to
    ///         settle in a single transaction.
    /// @param shapeId The shape to settle.
    /// @param maxSquares Minimum number of squares to process in this call; the call continues to
    ///        the end of the current latitude row. 0 means no limit.
    function settleShape(uint256 shapeId, uint256 maxSquares) external;

    /// @notice Stops bids, settlement and `withdrawProceeds`. Only the admin of GaiaCountries
    ///         (`DEFAULT_ADMIN_ROLE`), and only while `block.timestamp <= endTime`.
    function pause() external;

    /// @notice Starts the auction again. Only the admin of GaiaCountries, and only while
    ///         `block.timestamp <= endTime`. Applies the soft close.
    function unpause() external;

    /// @notice Ends a paused auction for good. All current highest bids become refunds for
    ///         `withdraw`. The admin can cancel at any time while paused; after `endTime`,
    ///         anybody can cancel a paused auction.
    function cancel() external;

    /// @notice Returns the current end of the auction. A bid near the end moves it, up to
    ///         `maxEndTime`. After the end, it does not change.
    function endTime() external view returns (uint64);

    /// @notice Returns true while the auction is paused. A cancelled auction stays paused.
    function paused() external view returns (bool);

    /// @notice Returns true after a cancel.
    function cancelled() external view returns (bool);

    /// @notice Returns the shape that currently owns the square; 0 if no shape owns it.
    function squareShapeId(
        uint16 lat,
        uint16 lng
    ) external view returns (uint256);

    /// @notice Returns the bidder of the shape; address(0) for an unknown shape.
    function shapeBidder(uint256 shapeId) external view returns (address);

    /// @notice Returns the number of squares that the shape still holds (squares that later bids
    ///         did not take).
    function shapeLiveSquares(uint256 shapeId) external view returns (uint256);

    /// @notice Returns the current highest bidder and amount of the square. The bidder is the
    ///         bidder of the shape that owns the square. (address(0), 0) if the square has no bid.
    function highestBids(
        uint16 lat,
        uint16 lng
    ) external view returns (address bidder, uint256 amount);
}
