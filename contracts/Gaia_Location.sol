// contracts/Gaia_Location.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
// import "@openzeppelin/contracts/utils/Counters.sol";
// import "./Integers.sol";

/**
 * @title Counters
 * @author Matt Condon (@shrugs)
 * @dev Provides counters that can only be incremented, decremented or reset. This can be used e.g. to track the number
 * of elements in a mapping, issuing ERC721 ids, or counting request ids.
 *
 * Include with `using Counters for Counters.Counter;`
 */
library Counters {
    struct Counter {
        // This variable should never be directly accessed by users of the library: interactions must be restricted to
        // the library's function. As of Solidity v0.5.2, this cannot be enforced, though there is a proposal to add
        // this feature: see https://github.com/ethereum/solidity/issues/4637
        uint256 _value; // default: 0
    }

    function current(Counter storage counter) internal view returns (uint256) {
        return counter._value;
    }

    function increment(Counter storage counter) internal {
        unchecked {
            counter._value += 1;
        }
    }

    function decrement(Counter storage counter) internal {
        uint256 value = counter._value;
        require(value > 0, "Counter: decrement overflow");
        unchecked {
            counter._value = value - 1;
        }
    }

    function reset(Counter storage counter) internal {
        counter._value = 0;
    }
}

contract Gaia_Location {
    // using Integers for uint16;

    using Counters for Counters.Counter;
    Counters.Counter private _tokenIdTracker;

    // struct MintedLocation {
    //     uint16 lat;
    //     uint16 lng;
    //     uint256 locId;
    //     uint64 dateMinted;
    // }

    struct Loc {
        uint16 lat;
        uint16 lng;
    }

    /**
     * Lat can have values from -90.00 -> 90.00
     * Long can have values from -180.00 -> 180.00
     * we want positive integers so the ranges become:
     * lat: 0 -> 18,000
     * lng: 0 -> 36,000
     */
    uint16 constant maxLat = 18000;
    uint16 constant maxLng = 36000;

    // event LocationClaimed(bytes indexed locId, address indexed by);
    // event LocationsClaimed(bytes[] indexed locIds, address indexed by);
    event LocationClaimed(address to, uint16 lat, uint16 lng);
    event LocationsClaimed(address to, Loc[] locs);
    // event LocationClaimed(address to, uint16 lat, uint16 lng);

    // event Transfer(uint256 tokenId, address indexed from, address indexed to);
    event Transfer(
        address indexed _from,
        address indexed _to,
        uint256 indexed _tokenId
    );

    string public name = "GAIA"; // or ErTH?? no spyro shut up that's silly
    string public symbol = "U+1F30D"; // unicode for `earth globe europe-africa`
    uint8 public decimals = 0;

    /**
     * @dev Tracks the amount of locations each land owner has
     */
    mapping(address => uint256) public balanceOf; //number of locations owned by a given address

    /**
     * @dev DEPRECATED
     * A mapping from NFT ID to the address that owns it.
     */
    mapping(bytes => address) public locIdToOwner;

    /**
     * @dev A list of unique owners.
     */
    address[] public landOwners;

    /**
     * @dev DEPRECATED
     * usable locationId to ERC721 tokenID & vice versa
     */
    // mapping(bytes => uint256) public _locIDToTokenID;
    // mapping(uint256 => bytes) public _tokenIDToLocID;

    /**
     * @dev total number of locations
     */
    uint256 public totalSupply;

    mapping(uint16 => mapping(uint16 => address)) public locationMap;

    mapping(uint256 => address) public tokenIdToOwner;

    mapping(address => uint256[]) public ownerToTokenIds;

    mapping(uint256 => Loc) public tokenIdToLocation;

    // bytes[] public locationIds;

    constructor() {
        uint256 supply = uint256(maxLng) * uint256(maxLat);
        totalSupply = supply;
    }

    function mintSingleLocation(uint16 lat, uint16 lng)
        public
        returns (uint256)
    {
        require(isValidLoc(lat, lng), "Invalid coordinates");
        require(!hasOwner(lat, lng), "Location Owned");
        // bytes memory locId = getLocHash(lat, lng);

        Loc memory loc = Loc(lat, lng);

        // add owner to list if new
        if (balanceOf[msg.sender] == 0) {
            landOwners.push(msg.sender);
        }

        // generate tokenId & increment
        uint256 tokenId = _tokenIdTracker.current();
        _tokenIdTracker.increment();
        // add to storage variables for ownership checks
        locationMap[lat][lng] = msg.sender;
        tokenIdToOwner[tokenId] = msg.sender;
        ownerToTokenIds[msg.sender].push(tokenId);
        tokenIdToLocation[tokenId] = loc;

        emit LocationClaimed(msg.sender, lat, lng);

        return tokenId;
    }

    function mintMultipleLocations(Loc[] memory locs)
        public
        returns (uint256[] memory tokenIds)
    {
        // returns (bytes[] memory)
        if (locs.length == 0) {
            return new uint256[](0);
        }

        // array where we'll store location IDs
        tokenIds = new uint256[](locs.length);

        // keep track of which lattitude we're iterating through
        uint16 currentLat;

        // keep track of how many lattitude we've iterated through
        uint16 latIndex = 0;

        // keep track of location in array
        uint16 locationIndex = 0;

        Loc memory location = locs[locationIndex];
        // extra location variable to save the last location of the lattitude
        Loc memory prevLocation;

        // keep track of previous lat's min & max longitudes for adjacency check
        uint16 prevLongitudeRangeStart = location.lng;
        uint16 prevLongitudeRangeEnd = 0;

        // flag to help figure out convexity
        // once the direction is flipped,
        // you can't have a longRangeStart that is smaller than previous one
        bool leftDirectionFlipped = false;
        // opposite goes for rangeEnd
        // once the direction is flipped,
        // you can't have a longRangeEnd that is larger than previous one
        bool rightDirectionFlipped = false;

        while (locationIndex < locs.length) {
            if (latIndex != 0) {
                // `location` variable is now the FIRST of the next lattitude
                // the new lattitude MUST be prevLattitude + 1
                require(
                    locs[locationIndex].lat == currentLat + 1,
                    "found disconnected lattitudes"
                );
            }
            currentLat = locs[locationIndex].lat;

            // keep track of current lat's min & max longitudes for adjacency check
            uint16 longitudeRangeStart = locs[locationIndex].lng;

            // if rangeStart is bigger than before, and direction not flipped already,
            // flip it now
            if (
                longitudeRangeStart > prevLongitudeRangeStart &&
                !leftDirectionFlipped
            ) {
                leftDirectionFlipped = true;
                // if direction has already flipped, then check new rangeStart is not smaller
            } else if (leftDirectionFlipped) {
                require(
                    longitudeRangeStart >= prevLongitudeRangeStart,
                    "Convexity broken on rangeStart"
                );
            }

            // iterate through current latitude locations
            uint16 longCounter = 0;

            // flag for current lattitude for adjacency
            bool latHasAdjacent = false;

            while (
                locationIndex < locs.length &&
                locs[locationIndex].lat == currentLat
            ) {
                ///////////////////////////////////////////////////////////////////////
                ////////   GET LOCATION AND PERFORM OWNERSHIP/VALIDITY TESTS   ////////
                location = locs[locationIndex];
                require(
                    isValidLoc(location.lat, location.lng),
                    "gap between latitudes detected"
                );
                // bytes memory locId = getLocHash(location.lat, location.lng);
                require(
                    locationOwner(location.lat, location.lng) == address(0),
                    "Included Location Owned"
                );
                ///////////////////////////////////////////////////////////////////////
                ///////////////////////////////////////////////////////////////////////

                // check that longitudes are adjacent
                if (longCounter != 0) {
                    require(
                        location.lng == prevLocation.lng + 1,
                        "gap between longitudes detected"
                    );
                }
                longCounter++;

                // if this is the first lattitude we're iterating through,
                // no need to check for lat adjacency
                if (latIndex == 0) {
                    latHasAdjacent = true;
                } else if (latHasAdjacent != true) {
                    // otherwise we check for adjacency by checking if it's within previous lat's range
                    latHasAdjacent =
                        location.lng >= prevLongitudeRangeStart &&
                        location.lng <= prevLongitudeRangeEnd;
                }

                // generate tokenId & increment
                uint256 tokenId = _tokenIdTracker.current();
                _tokenIdTracker.increment();
                // add to storage variables for ownership checks
                locationMap[location.lat][location.lng] = msg.sender;
                tokenIdToOwner[tokenId] = msg.sender;
                tokenIds[locationIndex] = tokenId;
                ownerToTokenIds[msg.sender].push(tokenId);
                tokenIdToLocation[tokenId] = location;

                prevLocation = location;

                locationIndex++;
            }
            latIndex++;

            uint16 longitudeRangeEnd = prevLocation.lng;

            // if rangeEnd is smaller than before, and direction not flipped already,
            // flip it now
            if (
                longitudeRangeEnd < prevLongitudeRangeEnd &&
                !rightDirectionFlipped
            ) {
                rightDirectionFlipped = true;
                // if direction has already flipped, then check new rangeStart is not smaller
            } else if (rightDirectionFlipped) {
                require(
                    longitudeRangeEnd <= prevLongitudeRangeEnd,
                    "Convexity broken on rangeEnd"
                );
            }

            // assign values for next lat to check
            prevLongitudeRangeEnd = prevLocation.lng;
            prevLongitudeRangeStart = longitudeRangeStart;

            // check if we found an adjacent longitude in this lat
            require(latHasAdjacent, "lats are adjacent but not longitudes");
        }

        // add owner to list if new
        if (balanceOf[msg.sender] == 0) {
            landOwners.push(msg.sender);
        }
        balanceOf[msg.sender] += tokenIds.length;
        // emit LocationsClaimed(locId, msg.sender);
        emit LocationsClaimed(msg.sender, locs);

        return tokenIds;
    }

    function isValidLoc(uint16 lat, uint16 lng) public pure returns (bool) {
        return lat < maxLat && lng < maxLng;
    }

    function getAllOwners() public view returns (address[] memory) {
        return landOwners;
    }

    function locationOwner(uint16 lat, uint16 lng)
        public
        view
        returns (address)
    {
        return locationMap[lat][lng];
    }

    function ownerOf(uint256 _tokenId) external view returns (address) {
        return tokenIdToOwner[_tokenId];
    }

    function getOwnedTokenIds(address _owner)
        public
        view
        returns (uint256[] memory)
    {
        require(balanceOf[_owner] > 0, "requested address has no balance");
        return ownerToTokenIds[_owner];
    }

    function getOwnedLocations(address _owner)
        external
        view
        returns (Loc[] memory)
    {
        if (balanceOf[_owner] == 0) {
            return new Loc[](0);
        }
        uint256[] memory tokenIds = getOwnedTokenIds(_owner);
        Loc[] memory locations = new Loc[](tokenIds.length);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            locations[i] = tokenIdToLocation[tokenIds[i]];
        }

        return locations;
    }

    // get OwnedLocations within bounds
    function getOwnedLocationsInBounds(
        address _owner,
        uint16 minOwnedLat,
        uint16 minOwnedLng,
        uint16 maxOwnedLat,
        uint16 maxOwnedLng
    ) external view returns (Loc[] memory ownedLocs) {
        if (balanceOf[_owner] == 0) {
            return ownedLocs;
        }
        // for (uint16 = minOwnedLat;)

        // TODO
    }

    function tokenOfOwnerByIndex(address _owner, uint256 _index)
        external
        view
        returns (uint256)
    {
        require(
            _index > balanceOf[_owner],
            "_index larger than user's balance"
        );

        return ownerToTokenIds[_owner][_index];
    }

    /**
     * @dev Transfers location ownership
     */
    function transferFrom(
        address _from,
        address _to,
        uint256 _tokenId
    ) external payable onlyOwner(_tokenId) {
        require(tokenIdToOwner[_tokenId] == msg.sender);
        require(tokenIdToOwner[_tokenId] == _from);
        require(_from == msg.sender);

        tokenIdToOwner[_tokenId] = _to;
        // bytes locId = _tokenIDToLocID[_tokenIDToLocID];
    }

    function transfer(
        uint16 lat,
        uint16 lng,
        address to
    ) public {
        //  require()
    }

    // function isValidLocation(Location memory loc) public returns (bool) {
    //     // TODO: figure out how the tiles will be calculated and therefore
    //     // which coordinates are considered valid
    // }

    // function hasOwner(uint16 lat, uint16 lng) public view returns (bool) {
    //     bytes memory locId = getLocHash(lat, lng);
    //     return !(locIdToOwner[locId] == address(0));
    // }

    function hasOwner(uint16 lat, uint16 lng) public view returns (bool) {
        return !(locationOwner(lat, lng) == address(0));
    }

    // function removeLocFromOwner(bytes memory locId, address locOnwer) private {
    //   require(ownerToLocIds[locOwner])
    // }

    function areAdjacent(Loc memory loc1, Loc memory loc2)
        public
        pure
        returns (bool)
    {
        // checks for right-left / up-down adjacency (not diagonal)
        // for 2 locs to be adjacent they need:
        // 1) same lat / lng
        // 2) the other one (lat / lng) to have a diff of 1
        require(isValidLoc(loc1.lat, loc1.lng));
        require(isValidLoc(loc2.lat, loc2.lng));
        if (loc1.lat == loc2.lat) {
            uint16 diff = loc1.lng > loc2.lng
                ? loc1.lng - loc2.lng
                : loc2.lng - loc1.lng;
            return diff == 1;
        } else if (loc1.lng == loc2.lng) {
            uint16 diff = loc1.lat > loc2.lat
                ? loc1.lat - loc2.lat
                : loc2.lat - loc1.lat;
            return diff == 1;
        }
        return false;
    }

    modifier onlyLandOwner(uint16 lat, uint16 lng) {
        require(locationOwner(lat, lng) == msg.sender);
        _;
    }

    modifier onlyOwner(uint256 tokenId) {
        require(tokenIdToOwner[tokenId] == msg.sender);
        _;
    }

    modifier validID(uint256 id) {
        require(id < totalSupply);
        // require(!plots[id].disabled);
        _;
    }

    /**
     * @dev DEPRECATED
     */
    // function getLocHash(uint16 lat, uint16 lng)
    //     public
    //     pure
    //     returns (bytes memory)
    // {
    //     string memory _lat = lat.toString();
    //     string memory _long = lng.toString();
    //     string memory separator = "-";
    //     return abi.encodePacked(_lat, separator, _long);
    // }

    /**
     * @dev DEPRECATED
     */
    function getLocFromId(bytes memory locId)
        public
        pure
        returns (string memory)
    {
        return string(locId);
    }
}
