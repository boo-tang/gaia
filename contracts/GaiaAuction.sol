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
 * Shape rule: HV-convex. Each row and each column of the shape is one unbroken run of squares, and
 * the rows are on consecutive latitudes and touch each other. Cross and plus shapes are valid.
 *
 * Anti-griefing rules enforced on every bid and on every simulated remainder after overlap:
 *   - Shape size must be in [minShapeSquares, maxShapeSquares].
 *   - Bounding-box aspect ratio must satisfy max(width,height) <= min(width,height) * maxShapeAspectRatio.
 *   - A bid that partially overlaps an existing active shape is accepted only if each affected
 *     shape's remaining squares are either zero (full takeover) or still form a valid shape.
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
    // One storage slot per square. The bidder is `shapeBidder[shapeId]`. shapeId 0: no bid.
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
    mapping(uint256 => address) public shapeBidder;
    // Original sorted squares of the bid, packed as `(uint32(lat) << 16) | lng`. Squares may later
    // be overtaken by newer bids.
    mapping(uint256 => uint32[]) private _shapeSquares;

    // --- Per-shape settlement state ---
    // Index into _shapeSquares[shapeId] up to which settlement has progressed.
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
        uint256 requiredTotal = _validateAndComputeTotal(
            squares,
            floorPerSquare,
            raiseOwnSquares
        );
        if (msg.value < requiredTotal) {
            revert InsufficientValue(msg.value, requiredTotal);
        }

        // Revert if any affected active shape would be left in an invalid state.
        _validateOverlaps(squares);

        uint256 newShapeId = _nextShapeId;
        unchecked {
            _nextShapeId = newShapeId + 1;
        }
        shapeBidder[newShapeId] = msg.sender;

        if (msg.value != requiredTotal) {
            pendingReturns[msg.sender] += msg.value - requiredTotal;
        }

        uint256 proceedsIncrease = 0;
        uint256 len = squares.length;
        uint256[] memory amounts = new uint256[](len);
        for (uint256 i = 0; i < len; ) {
            (uint256 amount, uint256 increase) = _takeSquare(
                squares[i],
                newShapeId,
                floorPerSquare,
                raiseOwnSquares
            );
            proceedsIncrease += increase;
            amounts[i] = amount;

            unchecked {
                i++;
            }
        }
        _shapeSquares[newShapeId] = squares;
        proceeds += proceedsIncrease;
        // requiredTotal is the full amount of each new square plus the increase of each raised
        // own square, so the sum of `activeBids` stays equal to `proceeds`.
        activeBids[msg.sender] += requiredTotal;
        emit ShapeBid(newShapeId, msg.sender, squares, amounts, requiredTotal);

        // Soft close: only a bid that raises the amount of a square extends the auction. Thus a
        // free re-bid on own squares cannot move `endTime`.
        if (proceedsIncrease != 0) {
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
        address winner = shapeBidder[shapeId];
        if (winner == address(0)) revert UnknownShape();

        uint32[] storage stored = _shapeSquares[shapeId];
        uint256 storedLen = stored.length;
        uint256 cursor = shapeSettleCursor[shapeId];
        if (cursor >= storedLen) revert ShapeAlreadySettled();

        uint256 end = storedLen;
        if (maxSquares != 0 && cursor + maxSquares < storedLen) {
            end = cursor + maxSquares;
            // Chunks end on a row boundary, so each row is ordered as a whole (see
            // _orderForSettlement).
            uint32 rowLat = stored[end - 1] >> 16;
            while (end < storedLen && stored[end] >> 16 == rowLat) {
                unchecked {
                    end++;
                }
            }
        }

        Loc[] memory owned = new Loc[](end - cursor);
        uint256 ownedCount = 0;

        for (uint256 i = cursor; i < end; ) {
            uint32 square = stored[i];
            if (_squares[square].shapeId == shapeId) {
                owned[ownedCount] = Loc({
                    lat: uint16(square >> 16),
                    lng: uint16(square)
                });
                unchecked {
                    ownedCount++;
                }
            }
            unchecked {
                i++;
            }
        }

        shapeSettleCursor[shapeId] = end;

        uint256 countryId = shapeCountryId[shapeId];
        if (ownedCount > 0) {
            // Trim the pre-allocated array to the actual owned count.
            assembly {
                mstore(owned, ownedCount)
            }
            owned = _orderForSettlement(owned, shapeId);
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

        if (end == storedLen) {
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
        return (shapeBidder[square.shapeId], square.amount);
    }

    // --- Internal helpers ---

    /// GaiaSquares adds squares one at a time and requires each one to keep the country connected
    /// and without holes. Input is sorted by row, west to east. Each row starts at an anchor: the
    /// first square above a square of this shape in the row below (that square is already in the
    /// country), or the first square if no row below exists. The row then extends west, then
    /// east, so every added square touches exactly one run of the country.
    function _orderForSettlement(
        Loc[] memory locs,
        uint256 shapeId
    ) internal view returns (Loc[] memory ordered) {
        uint256 len = locs.length;
        ordered = new Loc[](len);
        uint256 out = 0;
        uint256 rowStart = 0;

        while (rowStart < len) {
            uint16 lat = locs[rowStart].lat;
            uint256 rowEnd = rowStart + 1;
            while (rowEnd < len && locs[rowEnd].lat == lat) rowEnd++;

            uint256 anchor = rowStart;
            if (lat > 0) {
                for (uint256 k = rowStart; k < rowEnd; k++) {
                    if (_squares[_key(lat - 1, locs[k].lng)].shapeId == shapeId) {
                        anchor = k;
                        break;
                    }
                }
            }

            ordered[out++] = locs[anchor];
            for (uint256 k = anchor; k > rowStart; ) {
                k--;
                ordered[out++] = locs[k];
            }
            for (uint256 k = anchor + 1; k < rowEnd; k++) {
                ordered[out++] = locs[k];
            }
            rowStart = rowEnd;
        }
    }

    /// Validates shape via calldata and computes the total bid required.
    /// Reverts on any shape-validity failure.
    function _validateAndComputeTotal(
        uint32[] calldata squares,
        uint256 floorPerSquare,
        bool raiseOwnSquares
    ) internal view returns (uint256 requiredTotal) {
        uint256 len = squares.length;
        if (len == 0) revert EmptyShape();
        if (len < minShapeSquares) revert ShapeTooSmall(len, minShapeSquares);
        if (len > maxShapeSquares) revert ShapeTooLarge(len, maxShapeSquares);

        uint16 refLng = uint16(squares[0]);
        // Check raw values: normalisation is modulo LOC_MAX_LNG and would hide out-of-range values.
        if (refLng >= LOC_MAX_LNG) revert InvalidCoordinates();

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

        requiredTotal = _squareCost(
            squares[0],
            floorPerSquare,
            raiseOwnSquares
        );

        for (uint256 i = 1; i < len; ) {
            uint32 square = squares[i];
            uint16 lat = uint16(square >> 16);
            uint16 lng = uint16(square);
            if (lng >= LOC_MAX_LNG) revert InvalidCoordinates();

            requiredTotal += _squareCost(square, floorPerSquare, raiseOwnSquares);

            lng = _normLng(lng, refLng);

            if (lat == s.currentLat) {
                if (lng != s.prevLngInLat + 1) revert GapBetweenLongitudes();
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
                if (lat < s.currentLat) revert Unsorted();
                if (lat != s.currentLat + 1) revert NonConsecutiveLatitudes();

                if (!s.isFirstLat) {
                    if (!s.latHasAdjacent) revert NoLatAdjacency();
                    if (
                        s.longitudeRangeEnd < s.prevLongitudeRangeEnd &&
                        !s.rightDirectionFlipped
                    ) {
                        s.rightDirectionFlipped = true;
                    } else if (
                        s.rightDirectionFlipped &&
                        s.longitudeRangeEnd > s.prevLongitudeRangeEnd
                    ) {
                        revert NotConvexEnd();
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
                    revert NotConvexStart();
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
            if (!s.latHasAdjacent) revert NoLatAdjacency();
            if (
                s.longitudeRangeEnd < s.prevLongitudeRangeEnd &&
                !s.rightDirectionFlipped
            ) {
                s.rightDirectionFlipped = true;
            } else if (
                s.rightDirectionFlipped &&
                s.longitudeRangeEnd > s.prevLongitudeRangeEnd
            ) {
                revert NotConvexEnd();
            }
        }

        // Sorting guarantees the last square has the highest lat.
        if (squares[len - 1] >> 16 >= LOC_MAX_LAT) revert InvalidCoordinates();

        _checkAspectRatio(
            uint16(squares[0] >> 16),
            uint16(squares[len - 1] >> 16),
            s.globalMinLng,
            s.globalMaxLng
        );
    }

    /// Same shape validity checks as _validateAndComputeTotal but operates on a memory array
    /// and does not compute a bid total. Used for simulating affected shape remainders.
    function _validateShapeMem(
        Loc[] memory locs
    ) internal view {
        uint256 len = locs.length;
        if (len == 0) revert EmptyShape();
        if (len < minShapeSquares) revert ShapeTooSmall(len, minShapeSquares);
        if (len > maxShapeSquares) revert ShapeTooLarge(len, maxShapeSquares);

        uint16 refLng = locs[0].lng;

        ShapeState memory s;
        s.currentLat = locs[0].lat;
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
            uint16 lat = locs[i].lat;
            uint16 lng = _normLng(locs[i].lng, refLng);

            if (lat == s.currentLat) {
                if (lng != s.prevLngInLat + 1) revert GapBetweenLongitudes();
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
                if (lat < s.currentLat) revert Unsorted();
                if (lat != s.currentLat + 1) revert NonConsecutiveLatitudes();

                if (!s.isFirstLat) {
                    if (!s.latHasAdjacent) revert NoLatAdjacency();
                    if (
                        s.longitudeRangeEnd < s.prevLongitudeRangeEnd &&
                        !s.rightDirectionFlipped
                    ) {
                        s.rightDirectionFlipped = true;
                    } else if (
                        s.rightDirectionFlipped &&
                        s.longitudeRangeEnd > s.prevLongitudeRangeEnd
                    ) {
                        revert NotConvexEnd();
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
                    revert NotConvexStart();
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
            if (!s.latHasAdjacent) revert NoLatAdjacency();
            if (
                s.longitudeRangeEnd < s.prevLongitudeRangeEnd &&
                !s.rightDirectionFlipped
            ) {
                s.rightDirectionFlipped = true;
            } else if (
                s.rightDirectionFlipped &&
                s.longitudeRangeEnd > s.prevLongitudeRangeEnd
            ) {
                revert NotConvexEnd();
            }
        }

        _checkAspectRatio(
            locs[0].lat,
            locs[len - 1].lat,
            s.globalMinLng,
            s.globalMaxLng
        );
    }

    /// Moves a square to `newShapeId` and returns its new amount and the increase of its amount.
    /// A square of a different bidder: the previous bidder gets a refund. Own square: no refund,
    /// and the amount goes up only if `raiseOwnSquares` is true.
    function _takeSquare(
        uint32 key,
        uint256 newShapeId,
        uint256 floorPerSquare,
        bool raiseOwnSquares
    ) internal returns (uint256 amount, uint256 increase) {
        Square memory current = _squares[key];
        address previous = shapeBidder[current.shapeId];
        amount = current.amount;

        if (previous != msg.sender) {
            if (previous != address(0) && current.amount != 0) {
                unchecked {
                    pendingReturns[previous] += current.amount;
                }
                activeBids[previous] -= current.amount;
            }
            amount = _bidAmount(current.amount, floorPerSquare);
        } else if (raiseOwnSquares) {
            amount = _bidAmount(current.amount, floorPerSquare);
        }
        increase = amount - current.amount;

        // `msg.value` covers the sum of the amounts, so each amount fits in 128 bits.
        _squares[key] = Square({
            amount: uint128(amount),
            shapeId: uint128(newShapeId)
        });
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

    /// Reverts if max(width, height) > min(width, height) * maxShapeAspectRatio.
    function _checkAspectRatio(
        uint16 minLat,
        uint16 maxLat,
        uint16 minLng,
        uint16 maxLng
    ) internal view {
        uint256 height = uint256(maxLat) - uint256(minLat) + 1;
        uint256 width = uint256(maxLng) - uint256(minLng) + 1;
        uint256 longer = height > width ? height : width;
        uint256 shorter = height > width ? width : height;
        if (longer > shorter * maxShapeAspectRatio) revert AspectRatioExceeded();
    }

    /// Collects unique active shape ids affected by the incoming bid and validates each remainder.
    function _validateOverlaps(
        uint32[] calldata squares
    ) internal view {
        uint256 len = squares.length;
        uint256[] memory affected = new uint256[](len);
        uint256 affectedCount = 0;

        for (uint256 i = 0; i < len; ) {
            uint256 sid = _squares[squares[i]].shapeId;
            if (sid != 0) {
                bool found = false;
                for (uint256 j = 0; j < affectedCount; ) {
                    if (affected[j] == sid) {
                        found = true;
                        break;
                    }
                    unchecked {
                        j++;
                    }
                }
                if (!found) {
                    affected[affectedCount] = sid;
                    unchecked {
                        affectedCount++;
                    }
                }
            }
            unchecked {
                i++;
            }
        }

        for (uint256 i = 0; i < affectedCount; ) {
            _validateShapeRemainder(affected[i], squares);
            unchecked {
                i++;
            }
        }
    }

    /// Simulates removing `removing` from shapeId's effective squares and validates the remainder.
    /// Uses a merge scan (both stored and removing are sorted by lat asc, lng west to east within
    /// lat). Longitudes are compared in the stored shape's normalised frame.
    function _validateShapeRemainder(
        uint256 shapeId,
        uint32[] calldata removing
    ) internal view {
        uint32[] storage stored = _shapeSquares[shapeId];
        uint256 storedLen = stored.length;
        uint256 removeLen = removing.length;
        uint16 refLng = uint16(stored[0]);

        Loc[] memory remaining = new Loc[](
            storedLen
        );
        uint256 remainCount = 0;
        uint256 rIdx = 0;

        for (uint256 i = 0; i < storedLen; ) {
            uint32 square = stored[i];
            uint16 sLat = uint16(square >> 16);
            uint16 sLng = uint16(square);

            // Skip squares already overtaken by a more recent bid.
            if (_squares[square].shapeId != shapeId) {
                unchecked {
                    i++;
                }
                continue;
            }

            // Advance removing pointer past entries sorted before (sLat, sLng).
            uint16 sNorm = _normLng(sLng, refLng);
            while (rIdx < removeLen) {
                uint32 r = removing[rIdx];
                uint16 rLat = uint16(r >> 16);
                if (
                    rLat < sLat ||
                    (rLat == sLat && _normLng(uint16(r), refLng) < sNorm)
                ) {
                    unchecked {
                        rIdx++;
                    }
                } else {
                    break;
                }
            }

            // Check if this square is consumed by the incoming bid.
            if (rIdx < removeLen && removing[rIdx] == square) {
                unchecked {
                    rIdx++;
                    i++;
                }
                continue;
            }

            remaining[remainCount] = Loc({
                lat: sLat,
                lng: sLng
            });
            unchecked {
                remainCount++;
                i++;
            }
        }

        if (remainCount == 0) return; // Full takeover is permitted.

        if (remainCount < minShapeSquares) {
            revert OverlapWouldInvalidateShape(shapeId);
        }

        // Trim the pre-allocated array to the actual count.
        assembly {
            mstore(remaining, remainCount)
        }

        // The remainder must itself be a valid shape (contiguous, convex, within bounds).
        _validateShapeMem(remaining);
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

    /// ETH that a bid spends on one square. A square of a different bidder, or with no bid: the
    /// full `_bidAmount`. Own square: 0, or only the increase if `raiseOwnSquares` is true.
    function _squareCost(
        uint32 square,
        uint256 floorPerSquare,
        bool raiseOwnSquares
    ) internal view returns (uint256) {
        Square memory current = _squares[square];
        if (shapeBidder[current.shapeId] != msg.sender) {
            return _bidAmount(current.amount, floorPerSquare);
        }
        if (!raiseOwnSquares) return 0;
        return _bidAmount(current.amount, floorPerSquare) - current.amount;
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
