// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Loc, LOC_MAX_LAT, LOC_MAX_LNG} from "./interfaces/GaiaTypes.sol";
import {IGaiaCountries} from "./interfaces/IGaiaCountries.sol";
import {IGaiaAuction} from "./interfaces/IGaiaAuction.sol";

/**
 * @title GaiaAuction
 * @notice Timeboxed per-square bidding with an HV-convex shape constraint. Each winning shape
 *         settles into an ERC-721 country in GaiaCountries.
 *
 * Shape rule: HV-convex. Each row and each column of the shape is one unbroken range of squares,
 * and the rows are on consecutive latitudes and touch each other. Cross and plus shapes are valid.
 *
 * Anti-griefing rules enforced on every bid and on every simulated remainder after overlap:
 *   - Shape size must be in [minShapeSquares, maxShapeSquares].
 *   - Bounding-box aspect ratio must satisfy max(width,height) <= min(width,height) * maxShapeAspectRatio.
 *   - A bid that partially overlaps an existing active shape is accepted only if each affected
 *     shape's remaining squares are either zero (full takeover) or still form a valid shape.
 *     Otherwise it reverts with OverlapWouldInvalidateShape(shapeId) of the affected shape. The
 *     shape errors (GapBetweenLongitudes and the others) are only for the squares of the bid.
 *
 * Partial takeover: when a different bidder takes some squares of a shape, the first bidder gets
 * back the bid on each lost square through `withdraw`. The first bidder cannot cancel. They pay
 * for, and get, the squares that stay. There are no maximum (proxy) bids: a bidder defends a shape
 * by bidding again. To grow a shape, a bidder bids on a second shape next to it and moves the
 * squares into the first country after settlement.
 *
 * Coordinates: a square's `(lat, lng)` is its south-west corner, in 1/100 degree. `lat` 0 is 90°S,
 * `lat` 17999 ends at 90°N. All squares have the same price, but a square near a pole is smaller
 * on the ground.
 *
 * Bid rules (anti-sniping):
 *   - Soft close, global: a bid with less than `extensionWindow` seconds left moves `endTime` for the
 *     whole auction to `block.timestamp + extensionWindow`. A bid with exactly `extensionWindow`
 *     seconds left does not move it. `endTime` never goes past `maxEndTime`. Only a bid that
 *     raises the amount of at least one square moves `endTime`. A bid that raises no amount (for
 *     example a re-bid on own squares with `raiseOwnSquares = false`) does not move it.
 *   - A bid at `endTime` is accepted. A bid after `endTime` reverts.
 *   - Next bid on a square: the larger of `current + minBidPerSquareWei` and
 *     `current + current * minBidIncrementBps / 10000`. The first bid is `minBidPerSquareWei`.
 *   - Jump bid: a bidder can set `floorPerSquare`. Each square then gets the larger of its next bid
 *     and `floorPerSquare`.
 *   - All these values are constructor parameters and do not change after deployment.
 *
 * Own squares: an own square is a square where the caller is already the highest bidder.
 *   - `raiseOwnSquares = false`: the amount does not change. The square costs 0, gets no refund
 *     and `floorPerSquare` does not apply to it.
 *   - `raiseOwnSquares = true`: the amount goes up to `_bidAmount` (next bid, or `floorPerSquare`
 *     if larger). The bidder pays only the difference and gets no refund for the square.
 *   - In both cases the square moves to the new shape. The old shape keeps the rule for partial
 *     takeover: its remainder must be zero or a valid shape.
 *   - So a bidder can take back a full shape after a partial takeover and pay only for the lost
 *     squares, or merge two adjacent own shapes into one shape with a bid that costs 0.
 *
 * Input: `bidOnShape` takes each square as one `uint32`, `(uint32(lat) << 16) | lng`, the same
 * packing as `ShapeBid`. The bounds `lat < LOC_MAX_LAT` and `lng < LOC_MAX_LNG` are checked on the
 * unpacked values.
 *
 * Storage (gas): one slot per square ({uint128 amount, uint128 shapeId}, keyed by the packed
 * square); the bidder is the bidder of the shape. One slot per shape ({bidder, liveSquares,
 * frame, live rows}). A valid shape has one unbroken range of squares in each row, so each shape
 * stores one range (first and last normalised longitude) per row, eight rows per slot (_ranges).
 * The ranges are always the squares that the shape still holds: a bid that takes squares of a
 * shape makes the ranges of these rows shorter. A bid that takes squares from the middle of a
 * range reverts (OverlapWouldInvalidateShape). The remainder check reads only the rows that the
 * shape still holds, and a bid that takes all remaining squares of a shape skips it. The gas of
 * a bid grows with the number of squares, and with the number of rows of each shape that it cuts
 * into; see test/Gaia_Auction.gas.ts.
 *
 * Events: each bid emits one `ShapeBid` with the new shape ID, the bidder, all squares of the new
 * shape and their amounts after the bid. A square belongs to the newest shape that contains it,
 * so an indexer can rebuild all shapes and current bids from `ShapeBid` events only.
 *
 * Pause and cancel (emergency stop):
 *   - The contract has no owner of its own and is not upgradeable. The admin is the holder of
 *     `DEFAULT_ADMIN_ROLE` in `countries` (a multisig), read on each call. So a change of that
 *     role also moves these powers, and a renounce of it removes them. The admin has only the
 *     powers below here. It cannot take funds, change bids, change winners or change the bid rules.
 *   - `pause` stops bids, settlement and `withdrawProceeds`. The admin can pause only while
 *     `block.timestamp <= endTime`, so a pause always comes before the first settlement and before
 *     the treasury gets the proceeds. `withdraw` (refunds) always works.
 *   - `unpause` is possible only while `block.timestamp <= endTime`. It applies the soft close, so
 *     bidders get at least `extensionWindow` seconds after it (up to `maxEndTime`). The pause does
 *     not stop the clock.
 *   - `cancel` ends the auction for good. All current highest bids become refunds: each bidder
 *     gets back everything with `withdraw`. Nothing settles and the treasury gets nothing.
 *   - While paused, the admin can cancel at any time. After `endTime`, anybody can cancel a
 *     paused auction. So a paused auction cannot hold the funds: it either resumes before
 *     `endTime` or ends in a cancel.
 *
 * Longitude wraps: square 35999 and square 0 are neighbours. Shape checks use longitudes
 * normalised relative to the first square of the shape (see _normLng), so a shape can cross the
 * antimeridian. Sort order: lat ascending, then lng west to east within a row, continuing across
 * the antimeridian (e.g. 35998, 35999, 0, 1).
 */
contract GaiaAuction is ReentrancyGuard, IGaiaAuction {
    // --- External contracts ---
    IGaiaCountries public immutable countries;
    address public immutable treasury;

    // --- Auction config ---
    uint64 public immutable startTime;
    // Current end. A bid in the last `extensionWindow` seconds moves it, up to `maxEndTime`.
    uint64 public endTime;
    uint64 public immutable maxEndTime;
    uint64 public immutable extensionWindow;
    // First bid on a square, and the minimum absolute increase of each later bid.
    uint256 public immutable minBidPerSquareWei;
    // Minimum relative increase of a bid, in basis points (500 = 5%).
    uint256 public immutable minBidIncrementBps;
    uint256 public immutable minShapeSquares;
    uint256 public immutable maxShapeSquares;
    // max(width, height) <= min(width, height) * maxShapeAspectRatio
    uint256 public immutable maxShapeAspectRatio;

    // --- Per-square bid state ---
    // One storage slot per square. The bidder is the bidder of the shape. shapeId 0: no bid.
    struct Square {
        uint128 amount;
        uint128 shapeId;
    }
    // Packed square ((uint32(lat) << 16) | lng) => current highest bid
    mapping(uint32 => Square) private _squares;
    // refunds for outbid amounts
    mapping(address => uint256) public pendingReturns;
    // Sum of current highest bids; owed to the treasury. Kept separate from pendingReturns.
    uint256 public proceeds;
    // Sum of each bidder's current highest bids. The sum over all bidders equals `proceeds`.
    // After a cancel, `withdraw` pays it back.
    mapping(address => uint256) public activeBids;

    // --- Emergency state ---
    bool public paused;
    // A cancelled auction stays paused.
    bool public cancelled;

    // --- Per-shape state ---
    // shapeId 0 is a sentinel for "no active shape"; valid ids start at 1.
    uint256 private _nextShapeId;
    // One slot per shape. Row r of the shape is latitude `baseLat + r`. Longitudes of the ranges
    // are normalised with `refLng`, the longitude of the first square of the bid (see _normLng).
    // Rows `loRow` to `hiRow` hold squares; the other rows are empty.
    struct Shape {
        address bidder;
        // Number of squares that the shape still holds.
        uint24 liveSquares;
        // True only during a bid that takes squares of the shape (see _cut).
        bool touched;
        uint16 refLng;
        uint16 baseLat;
        uint16 loRow;
        uint16 hiRow;
    }
    mapping(uint256 => Shape) private _shapes;
    // Range of each row of a shape: row r is bits 32 * (r % 8) to 32 * (r % 8) + 31 of slot r / 8,
    // `(start << 16) | end` in the normalised frame of the shape. 0 is an empty row: a shape is
    // at most LNG_ORIGIN squares wide, so a normalised longitude is never 0.
    mapping(uint256 => mapping(uint256 => uint256)) private _ranges;

    // --- Per-shape settlement state ---
    // Next row (relative to `baseLat`) to settle. Settlement starts at `loRow`.
    mapping(uint256 => uint256) public shapeSettleCursor;
    // Count of squares actually settled (i.e. not overtaken) for the shape so far.
    mapping(uint256 => uint256) public shapeSettledSquares;
    // Country created for the shape in GaiaCountries. 0 = not created yet.
    mapping(uint256 => uint256) public shapeCountryId;

    // Normalised value of a shape's reference longitude. Squares up to LNG_ORIGIN columns west or
    // east of the reference keep their relative order after normalisation.
    uint16 private constant LNG_ORIGIN = LOC_MAX_LNG / 2;

    // --- Shape validation scratch struct ---
    struct ShapeState {
        uint16 currentLat;
        uint16 prevLngInLat;
        uint16 longitudeRangeStart;
        uint16 longitudeRangeEnd;
        uint16 prevLongitudeRangeStart;
        uint16 prevLongitudeRangeEnd;
        uint16 globalMinLng;
        uint16 globalMaxLng;
        bool leftDirectionFlipped;
        bool rightDirectionFlipped;
        bool isFirstLat;
        bool latHasAdjacent;
    }

    // Result of writing the squares of a bid (see _takeSquares).
    struct Taken {
        // New amount of each square, in bid order.
        uint256[] amounts;
        // ETH that the bid spends: the full amount of each new square plus the increase of each
        // raised own square.
        uint256 paid;
        // Sum of the increases of all amounts.
        uint256 proceedsIncrease;
        // IDs of the shapes that owned squares of the bid before it, each once.
        uint256[] affected;
        // A shape that would lose squares from the middle of a row (0: none).
        uint256 splitShape;
    }

    // The squares that a bid takes from one row of one shape: always one unbroken part of the
    // range of the row, because the bid also has one range per row. `first` and `last` are
    // normalised in the frame of the shape.
    struct Cut {
        uint256 shapeId;
        uint256 lat;
        uint256 first;
        uint256 last;
        address bidder;
        uint16 refLng;
    }

    // --- Events ---
    /// One event per bid. `squares` are the squares of the new shape in bid order, each packed as
    /// `(uint32(lat) << 16) | lng`. `amounts` are their amounts after the bid (also for own
    /// squares that did not change). `paid` is the ETH that the bid spends, without the excess.
    /// A square belongs to the newest shape that contains it.
    event ShapeBid(
        uint256 indexed shapeId,
        address indexed bidder,
        uint32[] squares,
        uint256[] amounts,
        uint256 paid
    );
    event ShapeSquaresSettled(
        uint256 indexed shapeId,
        uint256 indexed countryId,
        uint256 count
    );
    event ShapeSettled(
        uint256 indexed shapeId,
        uint256 indexed countryId,
        address indexed winner,
        uint256 totalSquares
    );
    event ProceedsWithdrawn(address indexed treasury, uint256 amount);
    event AuctionExtended(uint64 endTime);
    event AuctionPaused();
    event AuctionUnpaused();
    event AuctionCancelled(address indexed by);

    // --- Errors ---
    error AuctionAlreadyEnded();
    error AuctionNotYetStarted();
    error AuctionNotYetEnded();
    error UnknownShape();
    error ShapeAlreadySettled();
    error InsufficientValue(uint256 received, uint256 required);
    error EmptyShape();
    error ShapeTooSmall(uint256 count, uint256 minimum);
    error ShapeTooLarge(uint256 count, uint256 maximum);
    error AspectRatioExceeded();
    error Unsorted();
    error NonConsecutiveLatitudes();
    error GapBetweenLongitudes();
    error NoLatAdjacency();
    error NotConvexStart();
    error NotConvexEnd();
    error InvalidCoordinates();
    error OverlapWouldInvalidateShape(uint256 shapeId);
    error ProceedsTransferFailed();
    error CountryAccountCannotBid();
    error NotAdmin();
    error AuctionIsPaused();
    error AuctionNotPaused();
    error AuctionIsCancelled();

    // --- Modifiers ---
    modifier onlyDuringAuction() {
        if (block.timestamp < startTime) revert AuctionNotYetStarted();
        if (block.timestamp > endTime) revert AuctionAlreadyEnded();
        _requireNotStopped();
        _;
    }

    modifier onlyAfterAuction() {
        if (block.timestamp <= endTime) revert AuctionNotYetEnded();
        _requireNotStopped();
        _;
    }

    modifier onlyAdmin() {
        if (!_isAdmin(msg.sender)) revert NotAdmin();
        _;
    }

    constructor(
        IGaiaCountries countries_,
        address treasury_,
        uint64 startTime_,
        uint64 endTime_,
        uint64 maxEndTime_,
        uint64 extensionWindow_,
        uint256 minBidPerSquareWei_,
        uint256 minBidIncrementBps_,
        uint256 minShapeSquares_,
        uint256 maxShapeSquares_,
        uint256 maxShapeAspectRatio_
    ) {
        require(
            address(countries_) != address(0) && treasury_ != address(0),
            "zero address"
        );
        require(startTime_ < endTime_, "invalid time window");
        require(maxEndTime_ >= endTime_, "invalid max end time");
        require(minBidIncrementBps_ <= 10_000, "invalid bid increment");
        require(
            minShapeSquares_ >= 1 && minShapeSquares_ <= maxShapeSquares_,
            "invalid shape bounds"
        );
        // Longitude normalisation (_normLng) keeps order only within LNG_ORIGIN columns of the
        // reference square.
        require(
            maxShapeSquares_ <= LNG_ORIGIN,
            "shape too large for lng wrap"
        );
        require(maxShapeAspectRatio_ >= 1, "invalid aspect ratio");
        countries = countries_;
        treasury = treasury_;
        startTime = startTime_;
        endTime = endTime_;
        maxEndTime = maxEndTime_;
        extensionWindow = extensionWindow_;
        minBidPerSquareWei = minBidPerSquareWei_;
        minBidIncrementBps = minBidIncrementBps_;
        minShapeSquares = minShapeSquares_;
        maxShapeSquares = maxShapeSquares_;
        maxShapeAspectRatio = maxShapeAspectRatio_;
        _nextShapeId = 1;
    }

    // --- IGaiaAuction ---

    /// @inheritdoc IGaiaAuction
    function bidOnShape(
        uint32[] calldata squares,
        uint256 floorPerSquare,
        bool raiseOwnSquares
    ) external payable override onlyDuringAuction {
        // GaiaCountries does not let a country go to a country account (OwnershipLoop), so a
        // winning account could never get its country. An account exists only after its
        // country is created, so this check at bid time covers every case.
        if (countries.countryOfAccount(msg.sender) != 0) {
            revert CountryAccountCannotBid();
        }
        _validateShape(squares);

        uint256 newShapeId = _nextShapeId;
        unchecked {
            _nextShapeId = newShapeId + 1;
        }
        uint256 rowCount = _writeRows(newShapeId, squares);
        _shapes[newShapeId] = Shape({
            bidder: msg.sender,
            liveSquares: uint24(squares.length),
            touched: false,
            refLng: uint16(squares[0]),
            baseLat: uint16(squares[0] >> 16),
            loRow: 0,
            hiRow: uint16(rowCount - 1)
        });

        // Writes the squares first. A revert below undoes the writes.
        Taken memory t = _takeSquares(
            squares,
            newShapeId,
            floorPerSquare,
            raiseOwnSquares
        );
        if (msg.value < t.paid) {
            revert InsufficientValue(msg.value, t.paid);
        }

        // Revert if any affected active shape would be left in an invalid state.
        _validateOverlaps(t);

        if (msg.value != t.paid) {
            pendingReturns[msg.sender] += msg.value - t.paid;
        }
        proceeds += t.proceedsIncrease;
        // `paid` is the full amount of each new square plus the increase of each raised own
        // square, so the sum of `activeBids` stays equal to `proceeds`.
        activeBids[msg.sender] += t.paid;
        emit ShapeBid(newShapeId, msg.sender, squares, t.amounts, t.paid);

        // Soft close: only a bid that raises the amount of a square extends the auction. Thus a
        // free re-bid on own squares cannot move `endTime`.
        if (t.proceedsIncrease != 0) {
            _extendIfClosing();
        }
    }

    /// @inheritdoc IGaiaAuction
    function withdraw() external override nonReentrant returns (bool) {
        uint256 refund = pendingReturns[msg.sender];
        // After a cancel, the bidder's current highest bids are refunds too.
        uint256 bids = cancelled ? activeBids[msg.sender] : 0;
        uint256 amount = refund + bids;
        if (amount == 0) {
            return true;
        }

        pendingReturns[msg.sender] = 0;
        if (bids != 0) activeBids[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) {
            pendingReturns[msg.sender] = refund;
            if (bids != 0) activeBids[msg.sender] = bids;
            return false;
        }

        return true;
    }

    /// @inheritdoc IGaiaAuction
    function withdrawProceeds()
        external
        override
        nonReentrant
        onlyAfterAuction
    {
        uint256 amount = proceeds;
        if (amount == 0) return;

        proceeds = 0;

        (bool success, ) = payable(treasury).call{value: amount}("");
        if (!success) revert ProceedsTransferFailed();

        emit ProceedsWithdrawn(treasury, amount);
    }

    /// @inheritdoc IGaiaAuction
    function settleShape(
        uint256 shapeId,
        uint256 maxSquares
    ) external override onlyAfterAuction {
        Shape memory shape = _shapes[shapeId];
        address winner = shape.bidder;
        if (winner == address(0)) revert UnknownShape();

        uint256 hi = shape.hiRow;
        uint256 from = shapeSettleCursor[shapeId];
        if (from < shape.loRow) from = shape.loRow;
        if (from > hi) revert ShapeAlreadySettled();

        // Whole rows only, so each row is ordered as a whole (see _settlementOrder).
        mapping(uint256 => uint256) storage ranges = _ranges[shapeId];
        uint256 to = from;
        uint256 ownedCount = 0;
        while (to <= hi) {
            uint256 range = _range(ranges, to);
            unchecked {
                if (range != 0) ownedCount += (range & 0xffff) - (range >> 16) + 1;
                to++;
            }
            if (maxSquares != 0 && ownedCount >= maxSquares) break;
        }

        shapeSettleCursor[shapeId] = to;

        uint256 countryId = shapeCountryId[shapeId];
        if (ownedCount > 0) {
            Loc[] memory owned = _settlementOrder(
                ranges,
                shape,
                from,
                to,
                ownedCount
            );
            // The auction holds the country until the last chunk, so nobody can trade a
            // partially settled country.
            if (countryId == 0) {
                countryId = countries.createCountry(address(this), owned);
                shapeCountryId[shapeId] = countryId;
            } else {
                countries.addSquares(countryId, address(this), owned);
            }
            unchecked {
                shapeSettledSquares[shapeId] += ownedCount;
            }
            emit ShapeSquaresSettled(shapeId, countryId, ownedCount);
        }

        if (to > hi) {
            if (countryId != 0) {
                // transferFrom, not safeTransferFrom: a winner contract without a receiver hook
                // must not block settlement.
                countries.transferFrom(address(this), winner, countryId);
                emit ShapeSettled(
                    shapeId,
                    countryId,
                    winner,
                    shapeSettledSquares[shapeId]
                );
            }
        }
    }

    /// @inheritdoc IGaiaAuction
    function pause() external override onlyAdmin {
        if (cancelled) revert AuctionIsCancelled();
        if (paused) revert AuctionIsPaused();
        if (block.timestamp > endTime) revert AuctionAlreadyEnded();
        paused = true;
        emit AuctionPaused();
    }

    /// @inheritdoc IGaiaAuction
    function unpause() external override onlyAdmin {
        if (cancelled) revert AuctionIsCancelled();
        if (!paused) revert AuctionNotPaused();
        if (block.timestamp > endTime) revert AuctionAlreadyEnded();
        paused = false;
        emit AuctionUnpaused();
        _extendIfClosing();
    }

    /// @inheritdoc IGaiaAuction
    function cancel() external override {
        if (cancelled) revert AuctionIsCancelled();
        if (!paused) revert AuctionNotPaused();
        if (block.timestamp <= endTime && !_isAdmin(msg.sender)) {
            revert NotAdmin();
        }
        cancelled = true;
        // The bids go back to the bidders through `activeBids`.
        proceeds = 0;
        emit AuctionCancelled(msg.sender);
    }

    /// @inheritdoc IGaiaAuction
    function squareShapeId(
        uint16 lat,
        uint16 lng
    ) external view override returns (uint256) {
        return _squares[_key(lat, lng)].shapeId;
    }

    /// @inheritdoc IGaiaAuction
    function highestBids(
        uint16 lat,
        uint16 lng
    ) external view override returns (address bidder, uint256 amount) {
        Square memory square = _squares[_key(lat, lng)];
        return (_shapes[square.shapeId].bidder, square.amount);
    }

    /// @inheritdoc IGaiaAuction
    function shapeBidder(
        uint256 shapeId
    ) external view override returns (address) {
        return _shapes[shapeId].bidder;
    }

    /// @inheritdoc IGaiaAuction
    function shapeLiveSquares(
        uint256 shapeId
    ) external view override returns (uint256) {
        return _shapes[shapeId].liveSquares;
    }

    // --- Internal helpers ---

    /// The squares of rows `from` to `to - 1` of the shape, in the order for GaiaCountries.
    /// GaiaSquares adds squares one at a time and requires each one to keep the country connected
    /// and without holes. Rows go from south to north. Each row starts at an anchor: the first
    /// square above the range of the row below (that row is already in the country), or the first
    /// square of the range if the row is the first row of the shape. The row then extends west,
    /// then east, so every added square touches exactly one range of the country. `count` is the
    /// number of squares in these rows.
    function _settlementOrder(
        mapping(uint256 => uint256) storage ranges,
        Shape memory shape,
        uint256 from,
        uint256 to,
        uint256 count
    ) internal view returns (Loc[] memory ordered) {
        ordered = new Loc[](count);
        uint256 out = 0;
        for (uint256 r = from; r < to; r++) {
            uint256 range = _range(ranges, r);
            if (range == 0) continue;
            uint256 start = range >> 16;
            uint256 end = range & 0xffff;
            uint256 anchor = start;
            if (r > shape.loRow) {
                uint256 below = _range(ranges, r - 1) >> 16;
                if (below > anchor) anchor = below;
            }
            out = _appendRow(
                ordered,
                out,
                uint16(shape.baseLat + r),
                (start << 32) | (anchor << 16) | end,
                shape.refLng
            );
        }
    }

    /// Appends the squares of one row to `ordered` from index `out`: the anchor, then west to the
    /// start, then east to the end. `span` is `(start << 32) | (anchor << 16) | end`, normalised.
    /// Returns the next index.
    function _appendRow(
        Loc[] memory ordered,
        uint256 out,
        uint16 lat,
        uint256 span,
        uint16 refLng
    ) internal pure returns (uint256) {
        uint256 start = span >> 32;
        uint256 anchor = (span >> 16) & 0xffff;
        uint256 end = span & 0xffff;
        ordered[out++] = Loc(lat, _denormLng(anchor, refLng));
        for (uint256 c = anchor; c > start; ) {
            c--;
            ordered[out++] = Loc(lat, _denormLng(c, refLng));
        }
        for (uint256 c = anchor + 1; c <= end; c++) {
            ordered[out++] = Loc(lat, _denormLng(c, refLng));
        }
        return out;
    }

    /// The shape validator for a new bid. Reverts with the error of the first rule that fails.
    /// `squares` are packed `(uint32(lat) << 16) | lng`.
    function _validateShape(uint32[] memory squares) internal view {
        uint256 len = squares.length;
        if (len == 0) revert EmptyShape();
        if (len < minShapeSquares) revert ShapeTooSmall(len, minShapeSquares);
        if (len > maxShapeSquares) revert ShapeTooLarge(len, maxShapeSquares);

        bytes4 err = _shapeError(squares);
        if (err != bytes4(0)) {
            assembly {
                mstore(0, err)
                revert(0, 4)
            }
        }
    }

    /// The shape rule without the size limits. Returns the selector of the error of the first rule
    /// that fails, or 0 if the squares are a valid shape. _rangesOk applies the same rule to the
    /// row ranges of a shape. `squares` must not be empty.
    function _shapeError(
        uint32[] memory squares
    ) internal view returns (bytes4) {
        uint256 len = squares.length;
        uint16 refLng = uint16(squares[0]);
        // Check raw values: normalisation is modulo LOC_MAX_LNG and would hide out-of-range values.
        if (refLng >= LOC_MAX_LNG) return InvalidCoordinates.selector;

        ShapeState memory s;
        s.currentLat = uint16(squares[0] >> 16);
        s.prevLngInLat = LNG_ORIGIN;
        s.longitudeRangeStart = LNG_ORIGIN;
        s.longitudeRangeEnd = LNG_ORIGIN;
        s.globalMinLng = LNG_ORIGIN;
        s.globalMaxLng = LNG_ORIGIN;
        s.prevLongitudeRangeStart = LNG_ORIGIN;
        s.prevLongitudeRangeEnd = LNG_ORIGIN;
        s.isFirstLat = true;
        s.latHasAdjacent = true;

        for (uint256 i = 1; i < len; ) {
            uint32 square = squares[i];
            uint16 lat = uint16(square >> 16);
            uint16 lng = uint16(square);
            if (lng >= LOC_MAX_LNG) return InvalidCoordinates.selector;
            lng = _normLng(lng, refLng);

            if (lat == s.currentLat) {
                if (lng != s.prevLngInLat + 1) return GapBetweenLongitudes.selector;
                s.prevLngInLat = lng;
                s.longitudeRangeEnd = lng;
                if (lng > s.globalMaxLng) s.globalMaxLng = lng;

                if (!s.isFirstLat && !s.latHasAdjacent) {
                    if (
                        lng >= s.prevLongitudeRangeStart &&
                        lng <= s.prevLongitudeRangeEnd
                    ) {
                        s.latHasAdjacent = true;
                    }
                }
            } else {
                if (lat < s.currentLat) return Unsorted.selector;
                if (lat != s.currentLat + 1) return NonConsecutiveLatitudes.selector;

                if (!s.isFirstLat) {
                    if (!s.latHasAdjacent) return NoLatAdjacency.selector;
                    if (
                        s.longitudeRangeEnd < s.prevLongitudeRangeEnd &&
                        !s.rightDirectionFlipped
                    ) {
                        s.rightDirectionFlipped = true;
                    } else if (
                        s.rightDirectionFlipped &&
                        s.longitudeRangeEnd > s.prevLongitudeRangeEnd
                    ) {
                        return NotConvexEnd.selector;
                    }
                }

                s.prevLongitudeRangeStart = s.longitudeRangeStart;
                s.prevLongitudeRangeEnd = s.longitudeRangeEnd;
                s.currentLat = lat;
                s.prevLngInLat = lng;
                s.longitudeRangeStart = lng;
                s.longitudeRangeEnd = lng;

                if (lng < s.globalMinLng) s.globalMinLng = lng;
                if (lng > s.globalMaxLng) s.globalMaxLng = lng;

                if (
                    lng > s.prevLongitudeRangeStart &&
                    !s.leftDirectionFlipped
                ) {
                    s.leftDirectionFlipped = true;
                } else if (
                    s.leftDirectionFlipped &&
                    lng < s.prevLongitudeRangeStart
                ) {
                    return NotConvexStart.selector;
                }

                s.isFirstLat = false;
                s.latHasAdjacent = false;
                if (
                    lng >= s.prevLongitudeRangeStart &&
                    lng <= s.prevLongitudeRangeEnd
                ) {
                    s.latHasAdjacent = true;
                }
            }

            unchecked {
                i++;
            }
        }

        if (!s.isFirstLat) {
            if (!s.latHasAdjacent) return NoLatAdjacency.selector;
            if (
                s.longitudeRangeEnd < s.prevLongitudeRangeEnd &&
                !s.rightDirectionFlipped
            ) {
                s.rightDirectionFlipped = true;
            } else if (
                s.rightDirectionFlipped &&
                s.longitudeRangeEnd > s.prevLongitudeRangeEnd
            ) {
                return NotConvexEnd.selector;
            }
        }

        // Sorting guarantees the last square has the highest lat.
        if (squares[len - 1] >> 16 >= LOC_MAX_LAT) return InvalidCoordinates.selector;

        if (
            !_aspectRatioOk(
                uint16(squares[0] >> 16),
                uint16(squares[len - 1] >> 16),
                s.globalMinLng,
                s.globalMaxLng
            )
        ) return AspectRatioExceeded.selector;
        return bytes4(0);
    }

    /// Moves the squares to `newShapeId`. A square of a different bidder: the previous bidder gets
    /// a refund, and the bid pays the full new amount. Own square: no refund, and the amount goes
    /// up only if `raiseOwnSquares` is true; the bid pays only the increase. The refunds go to
    /// `pendingReturns` and out of `activeBids` once for each group of consecutive squares with the
    /// same previous bidder, not once for each square. Removes the squares from the row ranges of
    /// the shapes that held them (see _cut), and collects the IDs of these shapes.
    function _takeSquares(
        uint32[] calldata squares,
        uint256 newShapeId,
        uint256 floorPerSquare,
        bool raiseOwnSquares
    ) internal returns (Taken memory t) {
        uint256 len = squares.length;
        t.amounts = new uint256[](len);
        t.affected = new uint256[](len);
        uint256 affectedCount = 0;
        address refundTo;
        uint256 refund;
        Cut memory cut;
        for (uint256 i = 0; i < len; ) {
            uint32 square = squares[i];
            Square memory current = _squares[square];

            // The squares that the bid takes from one row of one shape are consecutive in the
            // bid. A new shape or a new row starts a new cut.
            if (current.shapeId != cut.shapeId || square >> 16 != cut.lat) {
                affectedCount = _cut(t, affectedCount, cut);
                cut.shapeId = current.shapeId;
                cut.lat = square >> 16;
                Shape memory owner = _shapes[current.shapeId];
                cut.bidder = owner.bidder;
                cut.refLng = owner.refLng;
                cut.first = _normLng(uint16(square), owner.refLng);
            }
            cut.last = _normLng(uint16(square), cut.refLng);

            address previous = cut.bidder;
            uint256 amount = current.amount;

            if (previous != msg.sender) {
                if (previous != refundTo) {
                    _refund(refundTo, refund);
                    refundTo = previous;
                    refund = 0;
                }
                refund += current.amount;
                amount = _bidAmount(current.amount, floorPerSquare);
                t.paid += amount;
            } else if (raiseOwnSquares) {
                amount = _bidAmount(current.amount, floorPerSquare);
                t.paid += amount - current.amount;
            }
            t.proceedsIncrease += amount - current.amount;
            t.amounts[i] = amount;

            // `msg.value` covers the sum of the amounts, so each amount fits in 128 bits. If it
            // does not, the bid reverts with InsufficientValue.
            _squares[square] = Square({
                amount: uint128(amount),
                shapeId: uint128(newShapeId)
            });

            unchecked {
                i++;
            }
        }
        affectedCount = _cut(t, affectedCount, cut);
        _refund(refundTo, refund);

        uint256[] memory affected = t.affected;
        assembly {
            mstore(affected, affectedCount)
        }
    }

    /// Removes the squares of `cut` from the range of their row and from the live square count of
    /// the shape. A cut from the middle of a range would split the row: the range does not change
    /// and `t.splitShape` records the shape (the bid then reverts in _validateOverlaps). Adds the
    /// shape to the first `count` entries of `t.affected` the first time, and returns the new
    /// count.
    /// No-op for shape 0 (squares with no bid).
    function _cut(
        Taken memory t,
        uint256 count,
        Cut memory cut
    ) internal returns (uint256) {
        uint256 shapeId = cut.shapeId;
        if (shapeId == 0) return count;
        Shape memory shape = _shapes[shapeId];

        uint256 r = cut.lat - shape.baseLat;
        mapping(uint256 => uint256) storage ranges = _ranges[shapeId];
        uint256 word = ranges[r >> 3];
        uint256 shift = (r & 7) << 5;
        uint256 range = (word >> shift) & 0xffffffff;
        uint256 start = range >> 16;
        uint256 end = range & 0xffff;
        uint256 newRange;
        if (cut.first == start) {
            newRange = cut.last == end ? 0 : ((cut.last + 1) << 16) | end;
        } else if (cut.last == end) {
            newRange = (start << 16) | (cut.first - 1);
        } else {
            if (t.splitShape == 0) t.splitShape = shapeId;
            newRange = range;
        }
        if (newRange != range) {
            ranges[r >> 3] =
                (word & ~(uint256(0xffffffff) << shift)) |
                (newRange << shift);
        }

        shape.liveSquares -= uint24(cut.last - cut.first + 1);
        if (!shape.touched) {
            shape.touched = true;
            t.affected[count] = shapeId;
            unchecked {
                count++;
            }
        }
        _shapes[shapeId] = shape;
        return count;
    }

    /// Writes the row ranges of a new shape. `squares` must be a valid shape. Returns the number of
    /// rows.
    function _writeRows(
        uint256 shapeId,
        uint32[] calldata squares
    ) internal returns (uint256) {
        mapping(uint256 => uint256) storage ranges = _ranges[shapeId];
        uint256 len = squares.length;
        uint16 refLng = uint16(squares[0]);
        uint256 lat = squares[0] >> 16;
        uint256 r = 0;
        uint256 start = LNG_ORIGIN;
        uint256 end = LNG_ORIGIN;
        uint256 word = 0;
        for (uint256 i = 1; i < len; ) {
            uint32 square = squares[i];
            uint256 lng = _normLng(uint16(square), refLng);
            if (square >> 16 != lat) {
                // Rows are consecutive, so this is row r + 1.
                word |= ((start << 16) | end) << ((r & 7) << 5);
                if (r & 7 == 7) {
                    ranges[r >> 3] = word;
                    word = 0;
                }
                unchecked {
                    r++;
                    lat++;
                }
                start = lng;
            }
            end = lng;
            unchecked {
                i++;
            }
        }
        ranges[r >> 3] = word | (((start << 16) | end) << ((r & 7) << 5));
        return r + 1;
    }

    /// Range of row `r` of a shape: `(start << 16) | end`, or 0 for an empty row.
    function _range(
        mapping(uint256 => uint256) storage ranges,
        uint256 r
    ) internal view returns (uint256) {
        return (ranges[r >> 3] >> ((r & 7) << 5)) & 0xffffffff;
    }

    /// Moves `amount` of the current bids of `bidder` to its refunds. No-op for address(0) (a
    /// square with no bid) or a zero amount.
    function _refund(address bidder, uint256 amount) internal {
        if (bidder == address(0) || amount == 0) return;
        unchecked {
            pendingReturns[bidder] += amount;
        }
        activeBids[bidder] -= amount;
    }

    /// Storage key of a square: `(uint32(lat) << 16) | lng`, the same packing as `ShapeBid`.
    function _key(uint16 lat, uint16 lng) internal pure returns (uint32) {
        return (uint32(lat) << 16) | lng;
    }

    /// Maps `lng` into a frame where `refLng` is LNG_ORIGIN, so that the columns on each side of the
    /// antimeridian are consecutive. Inputs must be < LOC_MAX_LNG.
    function _normLng(uint16 lng, uint16 refLng) internal pure returns (uint16) {
        unchecked {
            return
                uint16(
                    (uint256(lng) + LOC_MAX_LNG + LNG_ORIGIN - refLng) %
                        LOC_MAX_LNG
                );
        }
    }

    /// Inverse of _normLng: the longitude of the normalised value `norm` in the frame of `refLng`.
    function _denormLng(uint256 norm, uint16 refLng) internal pure returns (uint16) {
        unchecked {
            return uint16((norm + refLng + LOC_MAX_LNG - LNG_ORIGIN) % LOC_MAX_LNG);
        }
    }

    /// False if max(width, height) > min(width, height) * maxShapeAspectRatio.
    function _aspectRatioOk(
        uint16 minLat,
        uint16 maxLat,
        uint16 minLng,
        uint16 maxLng
    ) internal view returns (bool) {
        uint256 height = uint256(maxLat) - uint256(minLat) + 1;
        uint256 width = uint256(maxLng) - uint256(minLng) + 1;
        uint256 longer = height > width ? height : width;
        uint256 shorter = height > width ? width : height;
        return longer <= shorter * maxShapeAspectRatio;
    }

    /// Checks the remainder of each shape that the bid took squares from, after all squares of
    /// the bid are taken. A shape that holds no squares after the bid needs no check. Reverts with
    /// OverlapWouldInvalidateShape for a shape that would lose squares from the middle of a row or
    /// that keeps an invalid remainder. Clears the `touched` flag of each shape.
    function _validateOverlaps(Taken memory t) internal {
        if (t.splitShape != 0) revert OverlapWouldInvalidateShape(t.splitShape);
        uint256[] memory affected = t.affected;
        uint256 count = affected.length;
        for (uint256 i = 0; i < count; ) {
            uint256 shapeId = affected[i];
            Shape memory shape = _shapes[shapeId];
            shape.touched = false;
            // The remainder must itself be a valid shape. It is not larger than the shape, so it
            // is not above maxShapeSquares. One error for each invalid remainder: the shape errors
            // are about the squares of the bid, and the remainder is not.
            if (shape.liveSquares != 0 && !_rangesOk(shapeId, shape)) {
                revert OverlapWouldInvalidateShape(shapeId);
            }
            _shapes[shapeId] = shape;
            unchecked {
                i++;
            }
        }
    }

    /// The shape rule of _shapeError and minShapeSquares, on the row ranges of a shape that holds
    /// squares. Reads rows `loRow` to `hiRow` and sets them to the first and last row that hold
    /// squares. Each row holds one range (_cut makes sure of that), so the rows that hold squares
    /// must be consecutive, each range must touch the range below, the west ends must go west and
    /// then east (or one of the two), the east ends east and then west, and the bounding box must
    /// satisfy the aspect ratio.
    function _rangesOk(
        uint256 shapeId,
        Shape memory shape
    ) internal view returns (bool) {
        if (shape.liveSquares < minShapeSquares) return false;
        mapping(uint256 => uint256) storage ranges = _ranges[shapeId];
        uint256 hi = shape.hiRow;
        uint256 first = type(uint256).max;
        uint256 last;
        uint256 prevStart;
        uint256 prevEnd;
        uint256 minStart;
        uint256 maxEnd;
        bool startsGoEast;
        bool endsGoWest;
        uint256 word;
        for (uint256 r = shape.loRow; r <= hi; ) {
            if (r == shape.loRow || r & 7 == 0) word = ranges[r >> 3];
            uint256 range = (word >> ((r & 7) << 5)) & 0xffffffff;
            if (range != 0) {
                uint256 start = range >> 16;
                uint256 end = range & 0xffff;
                if (first == type(uint256).max) {
                    first = r;
                    minStart = start;
                    maxEnd = end;
                } else {
                    // An empty row between two rows, or no contact with the row below.
                    if (last != r - 1) return false;
                    if (start > prevEnd || end < prevStart) return false;
                    if (start > prevStart) startsGoEast = true;
                    else if (start < prevStart && startsGoEast) return false;
                    if (end < prevEnd) endsGoWest = true;
                    else if (end > prevEnd && endsGoWest) return false;
                    if (start < minStart) minStart = start;
                    if (end > maxEnd) maxEnd = end;
                }
                last = r;
                prevStart = start;
                prevEnd = end;
            }
            unchecked {
                r++;
            }
        }
        shape.loRow = uint16(first);
        shape.hiRow = uint16(last);
        uint256 height = last - first + 1;
        uint256 width = maxEnd - minStart + 1;
        uint256 longer = height > width ? height : width;
        uint256 shorter = height > width ? width : height;
        return longer <= shorter * maxShapeAspectRatio;
    }

    /// True if `account` has `DEFAULT_ADMIN_ROLE` in `countries`.
    function _isAdmin(address account) internal view returns (bool) {
        return
            IAccessControl(address(countries)).hasRole(
                0x00, // DEFAULT_ADMIN_ROLE
                account
            );
    }

    /// Reverts when the auction is cancelled or paused.
    function _requireNotStopped() internal view {
        if (cancelled) revert AuctionIsCancelled();
        if (paused) revert AuctionIsPaused();
    }

    /// Soft close: a bid with less than `extensionWindow` seconds left moves `endTime` to
    /// `block.timestamp + extensionWindow`, but not past `maxEndTime`. The caller makes sure that
    /// `block.timestamp <= endTime`.
    function _extendIfClosing() internal {
        uint64 end = endTime;
        if (end - block.timestamp >= extensionWindow) return;
        uint256 newEnd = block.timestamp + extensionWindow;
        if (newEnd > maxEndTime) newEnd = maxEndTime;
        if (newEnd <= end) return;
        endTime = uint64(newEnd);
        emit AuctionExtended(uint64(newEnd));
    }

    /// Amount a bid puts on a square: the next bid, or `floorPerSquare` if that is larger.
    function _bidAmount(
        uint256 current,
        uint256 floorPerSquare
    ) internal view returns (uint256) {
        uint256 next = _nextBid(current);
        return floorPerSquare > next ? floorPerSquare : next;
    }

    /// Minimum next bid: `minBidPerSquareWei` for an unbid square. Else the larger of
    /// `current + minBidPerSquareWei` and `current + current * minBidIncrementBps / 10000`.
    function _nextBid(uint256 current) internal view returns (uint256) {
        if (current < minBidPerSquareWei) return minBidPerSquareWei;
        uint256 relative = (current * minBidIncrementBps) / 10_000;
        uint256 step = relative > minBidPerSquareWei
            ? relative
            : minBidPerSquareWei;
        return current + step;
    }
}
