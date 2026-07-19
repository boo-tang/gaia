// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IGaiaLocation721} from "./interfaces/IGaiaLocation721.sol";
import {ICountry1155} from "./interfaces/ICountry1155.sol";
import {IGaiaAuction} from "./interfaces/IGaiaAuction.sol";

/**
 * @title GaiaAuction
 * @notice Timeboxed per-square bidding with convex-shape constraint. Winners settle to an ERC-1155
 *         "country" that will custody the ERC-721 squares.
 *
 * Anti-griefing rules enforced on every bid and on every simulated remainder after overlap:
 *   - Shape size must be in [minShapeSquares, maxShapeSquares].
 *   - Bounding-box aspect ratio must satisfy max(width,height) <= min(width,height) * maxShapeAspectRatio.
 *   - A bid that partially overlaps an existing active shape is accepted only if each affected
 *     shape's remaining squares are either zero (full takeover) or still form a valid shape.
 */
contract GaiaAuction is ReentrancyGuard, IGaiaAuction {
    // --- External contracts ---
    IGaiaLocation721 public immutable squares;
    ICountry1155 public immutable countries;

    // --- Auction config ---
    uint64 public immutable startTime;
    uint64 public immutable endTime;
    uint256 public immutable minBidPerSquareWei;
    uint256 public immutable minShapeSquares;
    uint256 public immutable maxShapeSquares;
    // max(width, height) <= min(width, height) * maxShapeAspectRatio
    uint256 public immutable maxShapeAspectRatio;

    // --- Per-square bid state ---
    struct Bid {
        address bidder;
        uint256 amount;
    }
    // lat => lng => Bid
    mapping(uint16 => mapping(uint16 => Bid)) public highestBids;
    // refunds for outbid amounts
    mapping(address => uint256) public pendingReturns;
    // bool flag whether the auction has been finalized
    bool public finalized;

    // --- Per-shape state ---
    // shapeId 0 is a sentinel for "no active shape"; valid ids start at 1.
    uint256 private _nextShapeId;
    mapping(uint256 => address) public shapeBidder;
    // Original sorted locs submitted with the bid. Squares may later be overtaken by newer bids.
    mapping(uint256 => IGaiaLocation721.Loc[]) private _shapeLocs;
    // Current owning shape per square. 0 = no active shape.
    mapping(uint16 => mapping(uint16 => uint256)) private _squareShapeId;

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
    event HighestBidIncreased(
        address indexed bidder,
        uint256 amount,
        uint16 lat,
        uint16 lng
    );
    event AuctionFinalized();

    // --- Errors ---
    error AuctionAlreadyEnded();
    error AuctionNotYetStarted();
    error AuctionNotYetEnded();
    error AuctionAlreadyFinalized();
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
    error OverlapWouldInvalidateShape(uint256 shapeId);

    // --- Modifiers ---
    modifier onlyDuringAuction() {
        if (block.timestamp < startTime) revert AuctionNotYetStarted();
        if (block.timestamp > endTime) revert AuctionAlreadyEnded();
        _;
    }

    modifier onlyAfterAuction() {
        if (block.timestamp <= endTime) revert AuctionNotYetEnded();
        _;
    }

    constructor(
        IGaiaLocation721 squares_,
        ICountry1155 countries_,
        uint64 startTime_,
        uint64 endTime_,
        uint256 minBidPerSquareWei_,
        uint256 minShapeSquares_,
        uint256 maxShapeSquares_,
        uint256 maxShapeAspectRatio_
    ) {
        require(
            address(squares_) != address(0) &&
                address(countries_) != address(0),
            "zero address"
        );
        require(startTime_ < endTime_, "invalid time window");
        require(
            minShapeSquares_ >= 1 && minShapeSquares_ <= maxShapeSquares_,
            "invalid shape bounds"
        );
        require(maxShapeAspectRatio_ >= 1, "invalid aspect ratio");
        squares = squares_;
        countries = countries_;
        startTime = startTime_;
        endTime = endTime_;
        minBidPerSquareWei = minBidPerSquareWei_;
        minShapeSquares = minShapeSquares_;
        maxShapeSquares = maxShapeSquares_;
        maxShapeAspectRatio = maxShapeAspectRatio_;
        _nextShapeId = 1;
    }

    // --- IGaiaAuction ---

    /// @inheritdoc IGaiaAuction
    function bidOnShape(
        IGaiaLocation721.Loc[] calldata locs
    ) external payable override onlyDuringAuction {
        uint256 requiredTotal = _validateAndComputeTotal(locs);
        if (msg.value < requiredTotal) {
            revert InsufficientValue(msg.value, requiredTotal);
        }

        // Revert if any affected active shape would be left in an invalid state.
        _validateOverlaps(locs);

        uint256 newShapeId = _nextShapeId;
        unchecked {
            _nextShapeId = newShapeId + 1;
        }
        shapeBidder[newShapeId] = msg.sender;

        uint256 len = locs.length;
        for (uint256 i = 0; i < len; ) {
            IGaiaLocation721.Loc calldata loc = locs[i];
            Bid memory current = highestBids[loc.lat][loc.lng];

            if (current.bidder != address(0) && current.amount != 0) {
                unchecked {
                    pendingReturns[current.bidder] += current.amount;
                }
            }

            uint256 nextAmount = _nextBid(current.amount);
            highestBids[loc.lat][loc.lng] = Bid({
                bidder: msg.sender,
                amount: nextAmount
            });
            emit HighestBidIncreased(msg.sender, nextAmount, loc.lat, loc.lng);

            _squareShapeId[loc.lat][loc.lng] = newShapeId;
            _shapeLocs[newShapeId].push(loc);

            unchecked {
                i++;
            }
        }
    }

    /// @inheritdoc IGaiaAuction
    function withdraw() external override nonReentrant returns (bool) {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) {
            return true;
        }

        pendingReturns[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) {
            pendingReturns[msg.sender] = amount;
            return false;
        }

        return true;
    }

    /// @inheritdoc IGaiaAuction
    function finalize() external override onlyAfterAuction {
        if (finalized) {
            revert AuctionAlreadyFinalized();
        }
        // TODO: group by winner, mint ERC-721 squares to Country1155 custody, mint/attach country ids
        finalized = true;
        emit AuctionFinalized();
    }

    // --- Internal helpers ---

    /// Validates shape via calldata and computes the total bid required.
    /// Reverts on any shape-validity failure.
    function _validateAndComputeTotal(
        IGaiaLocation721.Loc[] calldata locs
    ) internal view returns (uint256 requiredTotal) {
        uint256 len = locs.length;
        if (len == 0) revert EmptyShape();
        if (len < minShapeSquares) revert ShapeTooSmall(len, minShapeSquares);
        if (len > maxShapeSquares) revert ShapeTooLarge(len, maxShapeSquares);

        ShapeState memory s;
        s.currentLat = locs[0].lat;
        s.prevLngInLat = locs[0].lng;
        s.longitudeRangeStart = locs[0].lng;
        s.longitudeRangeEnd = locs[0].lng;
        s.globalMinLng = locs[0].lng;
        s.globalMaxLng = locs[0].lng;
        s.prevLongitudeRangeStart = locs[0].lng;
        s.prevLongitudeRangeEnd = locs[0].lng;
        s.isFirstLat = true;
        s.latHasAdjacent = true;

        {
            Bid memory cur0 = highestBids[locs[0].lat][locs[0].lng];
            requiredTotal = _nextBid(cur0.amount);
        }

        for (uint256 i = 1; i < len; ) {
            uint16 lat = locs[i].lat;
            uint16 lng = locs[i].lng;

            {
                Bid memory current = highestBids[lat][lng];
                requiredTotal += _nextBid(current.amount);
            }

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

    /// Same shape validity checks as _validateAndComputeTotal but operates on a memory array
    /// and does not compute a bid total. Used for simulating affected shape remainders.
    function _validateShapeMem(
        IGaiaLocation721.Loc[] memory locs
    ) internal view {
        uint256 len = locs.length;
        if (len == 0) revert EmptyShape();
        if (len < minShapeSquares) revert ShapeTooSmall(len, minShapeSquares);
        if (len > maxShapeSquares) revert ShapeTooLarge(len, maxShapeSquares);

        ShapeState memory s;
        s.currentLat = locs[0].lat;
        s.prevLngInLat = locs[0].lng;
        s.longitudeRangeStart = locs[0].lng;
        s.longitudeRangeEnd = locs[0].lng;
        s.globalMinLng = locs[0].lng;
        s.globalMaxLng = locs[0].lng;
        s.prevLongitudeRangeStart = locs[0].lng;
        s.prevLongitudeRangeEnd = locs[0].lng;
        s.isFirstLat = true;
        s.latHasAdjacent = true;

        for (uint256 i = 1; i < len; ) {
            uint16 lat = locs[i].lat;
            uint16 lng = locs[i].lng;

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
        IGaiaLocation721.Loc[] calldata locs
    ) internal view {
        uint256 len = locs.length;
        uint256[] memory affected = new uint256[](len);
        uint256 affectedCount = 0;

        for (uint256 i = 0; i < len; ) {
            uint256 sid = _squareShapeId[locs[i].lat][locs[i].lng];
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
            _validateShapeRemainder(affected[i], locs);
            unchecked {
                i++;
            }
        }
    }

    /// Simulates removing `removing` from shapeId's effective squares and validates the remainder.
    /// Uses a merge scan (both stored and removing are sorted by lat asc, lng asc within lat).
    function _validateShapeRemainder(
        uint256 shapeId,
        IGaiaLocation721.Loc[] calldata removing
    ) internal view {
        IGaiaLocation721.Loc[] storage stored = _shapeLocs[shapeId];
        uint256 storedLen = stored.length;
        uint256 removeLen = removing.length;

        IGaiaLocation721.Loc[] memory remaining = new IGaiaLocation721.Loc[](
            storedLen
        );
        uint256 remainCount = 0;
        uint256 rIdx = 0;

        for (uint256 i = 0; i < storedLen; ) {
            uint16 sLat = stored[i].lat;
            uint16 sLng = stored[i].lng;

            // Skip squares already overtaken by a more recent bid.
            if (_squareShapeId[sLat][sLng] != shapeId) {
                unchecked {
                    i++;
                }
                continue;
            }

            // Advance removing pointer past entries sorted before (sLat, sLng).
            while (rIdx < removeLen) {
                uint16 rLat = removing[rIdx].lat;
                uint16 rLng = removing[rIdx].lng;
                if (rLat < sLat || (rLat == sLat && rLng < sLng)) {
                    unchecked {
                        rIdx++;
                    }
                } else {
                    break;
                }
            }

            // Check if this square is consumed by the incoming bid.
            if (
                rIdx < removeLen &&
                removing[rIdx].lat == sLat &&
                removing[rIdx].lng == sLng
            ) {
                unchecked {
                    rIdx++;
                    i++;
                }
                continue;
            }

            remaining[remainCount] = IGaiaLocation721.Loc({
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

    function _nextBid(uint256 current) internal view returns (uint256) {
        if (current < minBidPerSquareWei) return minBidPerSquareWei;
        return current + minBidPerSquareWei;
    }
}
