// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IGaiaLandSale
 * @notice Sale of the squares that the auction did not sell, at a price that drops over time.
 *         Opens after the auction ends. At a given time, every square has the same price.
 */
interface IGaiaLandSale {
    /// @notice One purchase: `squareCount` squares at `pricePerSquare` each, into `countryId`.
    event SquaresBought(
        uint256 indexed countryId,
        address indexed buyer,
        uint256 squareCount,
        uint256 pricePerSquare
    );

    /// @notice Creates a new country for the caller with `squares`, in the given order.
    ///         `msg.value` must cover `pricePerSquare() * squares.length`. The cost goes to the
    ///         treasury and the excess goes back to the caller in the same transaction.
    /// @param squares The squares, each packed as `(uint32(lat) << 16) | lng` (the same packing
    ///        as `bidOnShape`). Each square must touch an earlier square, and the country must
    ///        stay without holes after each square (GaiaSquares checks this).
    function buy(
        uint32[] calldata squares
    ) external payable returns (uint256 countryId);

    /// @notice Adds `squares`, in the given order, to a country that the caller owns. Payment
    ///         and square rules are the same as for `buy`. Each square must touch the country or
    ///         an earlier square.
    function buyInto(uint256 countryId, uint32[] calldata squares) external payable;

    /// @notice The price of one square now. Before the auction ends, returns `startPrice`.
    ///         After the end, the price stays at `startPrice` for `holdDuration` seconds, then
    ///         drops in a straight line to `endPrice` in `dropDuration` seconds, then stays at
    ///         `endPrice`.
    function pricePerSquare() external view returns (uint256);

    /// @notice True when a purchase can go through: the auction has ended and is not paused or
    ///         cancelled.
    function isOpen() external view returns (bool);
}
