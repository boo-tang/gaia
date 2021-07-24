// contracts/Gaia_Loc.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./Integers.sol";

contract Gaia_Loc {
    using Integers for uint16;

    using Counters for Counters.Counter;
    Counters.Counter private _tokenIdTracker;

    /**
     * Lat can have values from -90.00 -> 90.00
     * Long can have values from -180.00 -> 180.00
     * we want positive integers so the ranges become:
     * lat: 0 -> 18,000
     * long: 0 -> 36,000
     */
    struct MintedLocation {
        uint16 lat;
        uint16 long;
        bytes locId;
        uint64 dateMinted;
    }

    struct Loc {
        uint16 lat;
        uint16 long;
    }

    uint16 constant maxLat = 18000;
    uint16 constant maxLong = 36000;

    event LocationClaimed(bytes indexed locId, address indexed by);
    event LocationClaimed(bytes[] indexed locIds, address indexed by);
    event LocationTransfer(
        bytes indexed landId,
        address indexed from,
        address indexed to
    );

    string public name = "GAIA";
    string public symbol = "U+1F30D"; // unicode for `earth globe europe-africa`
    uint8 public decimals = 0;

    /**
     * @dev Tracks the amount of locations each land owner has
     */
    mapping(address => uint256) public balanceOf; //number of locations owned by a given address

    /**
     * @dev A mapping from NFT ID to the address that owns it.
     */
    // mapping(bytes => address) public locIdToOwner;

    /**
     * @dev A list of unique owners.
     */
    address[] public landOwners;

    /**
     * @dev list of minted locations
     */
    bytes[] public mintedLocations;

    /**
     * @dev usable locationId to ERC721 tokenID & vice versa
     */
    mapping(bytes => uint256) public _locIDToTokenID;
    mapping(uint256 => bytes) public _tokenIDToLocID;

    uint256 public remainingLocations;

    uint256 private totalSupply;

    mapping(uint16 => mapping(uint16 => address)) public locationMap;

    constructor() {
        uint256 supply = uint256(maxLong) * uint256(maxLat);
        totalSupply = supply;
        remainingLocations = supply;
    }

    function mintSingleLocation(uint16 lat, uint16 long)
        public
        returns (bytes memory)
    {
        require(isValidLoc(lat, long), "Invalid coordinates");
        bytes memory locId = getLocHash(lat, long);

        // Location memory loc = Location({
        //     lat: lat,
        //     long: long,
        //     dateMinted: uint64(block.timestamp),
        //     locId: locId
        // });

        // add owner to list if new
        if (balanceOf[msg.sender] == 0) {
            landOwners.push(msg.sender);
        }

        // get ERC721 ID
        uint256 tokenIdToAssign = _tokenIdTracker.current();
        _tokenIdTracker.increment();

        _tokenIDToLocID[tokenIdToAssign] = locId;
        _locIDToTokenID[locId] = tokenIdToAssign;

        locationMap[lat][long] = msg.sender;
        balanceOf[msg.sender]++;
        mintedLocations.push(locId);
        remainingLocations--;

        emit LocationClaimed(locId, msg.sender);

        return locId;
    }

    function mintMultipleLocations_4(Loc[] memory locs) public returns (bool) {
        // returns (bytes[] memory)
        if (locs.length == 0) {
            // return new bytes[](0);
            return true;
        }

        // keep track of which lattitude we're iterating through
        uint16 currentLat;
        // keep track of how many lattitude we've iterated through
        uint16 locationIndex = 0;
        Loc memory location = locs[locationIndex];
        // flag for current lattitude for adjacency
        bool latHasAdjacent = false;

        // keep track of previous lat's min & max longitudes for adjacency check
        uint16 prevLongitudeRangeStart = location.long;
        uint16 prevLongitudeRangeEnd = 0;

        while (locationIndex < locs.length) {
            ///////////////////////////////////////////////////////////////////////
            ////////   GET LOCATION AND PERFORM OWNERSHIP/VALIDITY TESTS   ////////
            require(
                isValidLoc(location.lat, location.long),
                "gap between latitudes detected"
            );
            bytes memory locId = getLocHash(location.lat, location.long);
            require(
                // locIdToOwner[locId] == address(0),
                locationMap[location.lat][location.long] == address(0),
                "Included location has owner"
            );
            ///////////////////////////////////////////////////////////////////////
            ///////////////////////////////////////////////////////////////////////

            currentLat = location.lat;

            // keep track of current lat's min & max longitudes for adjacency check
            uint16 longitudeRangeStart = location.long;
            // uint16 longitudeRangeEnd = 0;

            // extra location variable to save the last location of the lattitude
            Loc memory lastLocation;
            // iterate through current latitude locations
            while (location.lat == currentLat) {
                // if this is the first lattitude we're iterating through,
                // no need to check for lat adjacency
                if (locationIndex == 0) {
                    latHasAdjacent = true;
                } else {
                    // otherwise we check for adjacency by checking if it's withing previous lat's range
                    latHasAdjacent =
                        location.long >= prevLongitudeRangeStart &&
                        location.long <= prevLongitudeRangeEnd;
                }
                locationIndex++;
                lastLocation = location;
                location = locs[locationIndex];
            }
            // longitudeRangeEnd = lastLocation.long;

            // assign values for next lat to check
            prevLongitudeRangeEnd = lastLocation.long;
            prevLongitudeRangeStart = longitudeRangeStart;

            // `location` variable is now the FIRST of the next lattitude
            // the new lattitude MUST be prevLattitude + 1
            require(
                location.lat == currentLat + 1,
                "found disconnected lattitudes"
            );

            // check if we found an adjacent longitude in this lat
            require(latHasAdjacent, "found disconnected longitudes");
        }

        return true;
    }

    function mintMultipleLocations_3(Loc[] memory locs)
        public
        returns (bytes[] memory locHashes)
    {
        locHashes = new bytes[](locs.length);
        if (locs.length == 0) {
            return new bytes[](0);
        }
        // 1st pass: create 2d array that will hold all
        uint16 latCounter = 0;
        uint16 longCounter = 0;
        // largest numger of longitutes in a latitude
        // uint16 maxLong = 0;
        uint16 currentLat = locs[0].lat;
        uint16 i = 0;
        while (i < locs.length) {
            Loc memory location = locs[i];
            require(
                isValidLoc(location.lat, location.long),
                "gap between latitudes detected"
            );

            if (currentLat != location.lat) {
                // at this point we can check if latitudes are valid.
                // since locations are sorted by lat,
                // next lat HAS to be currentLat + 1 (otherwise there's a gap)
                require(location.lat == currentLat + 1);
                currentLat = location.lat;
                // if (longCounter > maxLong) {
                //     maxLong = longCounter;
                // }
                longCounter = 0;
                latCounter++;
            }
            longCounter++;
            i++;
        }

        // 2nd pass to map all locations in 2d array
        Loc[maxLong][] memory locationArray = new Loc[maxLong][](latCounter);
        // reset lat counter helper
        currentLat = locs[0].lat;
        uint16 locationIndex = 0;
        for (uint16 latIndex = 0; latIndex < latCounter; i++) {
            uint16 longIndex = 0;
            Loc memory location = locs[locationIndex];
            while (location.lat == currentLat) {
                locationArray[currentLat][longIndex] = location;
                longIndex++;
                locationIndex++;
                location = locs[locationIndex];
            }
            longIndex = 0;
            currentLat = location.lat;
            // locationIndex++;
        }

        // 3rd pass through 2d array to check adjacency
        // for (uint)
    }

    // function mintMultipleLocations_3(Loc[] memory locs)
    //     public
    //     returns (bytes[] memory)
    // {
    //     if (locs.length == 0) {
    //         return new bytes[](0);
    //     }
    //     bytes[] memory locHashes = new bytes[](locs.length);

    //     uint16 currentLat;
    //     uint16[] curre

    //     for (uint256 i = 0; i < locs.length; i++) {
    //         Loc memory location = locs[i];

    //         require(isValidLoc(location.lat, location.long));
    //         // get bytes ID
    //         bytes memory locId = getLocHash(location.lat, location.long);

    //         // check location has no owner yet
    //         require(
    //             locationMap[location.lat][location.long] == address(0),
    //             "Included location has owner"
    //         );

    //     }
    // }

    /**
     * @dev method to mint multiple locations. list of locations must be sorted by lat -> long
     */
    function mintMultipleLocations(Loc[] memory locs)
        public
        returns (bytes[] memory)
    {
        // loop through all locs to confirm validity & hash them
        bytes[] memory locHashes = new bytes[](locs.length);

        // e.g. valid location list;
        // [{lat: 1, long: 1}, {lat: 1, long: 2}, {lat: 1, long: 3}, {lat:2, long: 3}]
        for (uint256 i = 0; i < locs.length; i++) {
            Loc memory location = locs[i];
            // check location is valid
            require(isValidLoc(location.lat, location.long));
            bytes memory locId = getLocHash(location.lat, location.long);
            require(
                // locIdToOwner[locId] == address(0),
                locationMap[location.lat][location.long] == address(0),
                "Included location has owner"
            );

            if (i == 0) {
                mintedLocations.push(locId);
                locHashes[i] = locId;
                // locIdToOwner[locId] = msg.sender;
                locationMap[location.lat][location.long] = msg.sender;
            } else {
                Loc memory prevLocation = locs[i - 1];
                // 1st: check if we're on same lat
                if (location.lat == prevLocation.lat) {
                    // if on same lat, long must be adjacent.
                    // locations must be sorted so long should be 1 higher
                    require(location.long == prevLocation.long + 1);
                } else {
                    // 2nd: if different lat, check that it's adjacent to previous one
                    require(location.lat == prevLocation.lat + 1);

                    // // 3rd: at least one long in this lat must have an adjacent location in previous lat
                    Loc memory locationToCheck = prevLocation;
                    // uint16 prevLat = prevLocation.lat;
                    uint256 j = i;
                    bool hasAdjacent = false;
                    while (locationToCheck.lat == location.lat - 1 && j > 0) {
                        hasAdjacent = locationToCheck.long == location.long;
                        if (hasAdjacent) {
                            break;
                        }
                        j--;
                        locationToCheck = locs[j];
                    }
                    require(hasAdjacent);
                }

                mintedLocations.push(locId);
                locHashes[i] = locId;
                // locIdToOwner[locId] = msg.sender;
                locationMap[location.lat][location.long];
            }
        }
        // add owner to list if new
        if (balanceOf[msg.sender] == 0) {
            landOwners.push(msg.sender);
        }

        balanceOf[msg.sender] += locs.length;
        remainingLocations -= locs.length;

        return locHashes;
    }

    function isValidLoc(uint16 lat, uint16 long) public view returns (bool) {
        return lat < maxLat && long < maxLong;
    }

    function getAllOwners() public view returns (address[] memory) {
        return landOwners;
    }

    // function ownerOf(bytes memory locId) public view returns (address) {
    //     return locIdToOwner[locId];

    // }

    function ownerOf(uint16 lat, uint16 long) public view returns (address) {
        return locationMap[lat][long];
    }

    // TODO
    // function ownedLocations(address owner)
    //     public
    //     view
    //     returns (bytes[] memory)
    // {
    //     uint256 ownerBalance = balanceOf[owner];
    //     if (ownerBalance == 0) {
    //         return new bytes[](0);
    //     }

    //     // TODO: iterate through locIdToOwner to find their owned addresses
    //     // until we find all of `ownerBalance`
    // }

    /**
     * @dev Transfers location ownership
     */
    // function transfer(bytes memory locId, address to) public {
    //     require(
    //         locIdToOwner[locId] == msg.sender,
    //         "sender does not own the land"
    //     );

    //     locIdToOwner[locId] = msg.sender;
    //     balanceOf[msg.sender]--;
    //     balanceOf[to]++;

    //     emit LocationTransfer(locId, msg.sender, to);
    // }

    function transfer(
        uint16 lat,
        uint16 long,
        address to
    ) public {
        //  require()
    }

    // function isValidLocation(Location memory loc) public returns (bool) {
    //     // TODO: figure out how the tiles will be calculated and therefore
    //     // which coordinates are considered valid
    // }

    function getLocHash(uint16 lat, uint16 long)
        public
        pure
        returns (bytes memory)
    {
        string memory _lat = lat.toString();
        string memory _long = long.toString();
        string memory separator = "-";
        return abi.encodePacked(_lat, separator, _long);
    }

    // function hasOwner(uint16 lat, uint16 long) public view returns (bool) {
    //     bytes memory locId = getLocHash(lat, long);
    //     return !(locIdToOwner[locId] == address(0));
    // }

    function hasOwner(uint16 lat, uint16 long) public view returns (bool) {
        return !(locationMap[lat][long] == address(0));
    }

    function getLocFromId(bytes memory locId)
        public
        pure
        returns (string memory)
    {
        return string(locId);
    }

    // function removeLocFromOwner(bytes memory locId, address locOnwer) private {
    //   require(ownerToLocIds[locOwner])
    // }

    function areAdjacent(Loc memory loc1, Loc memory loc2)
        public
        view
        returns (bool)
    {
        // checks for right-left / up-down adjacency (not diagonal)
        // for 2 locs to be adjacent they need:
        // 1) same lat / long
        // 2) the other one (lat / long) to have a diff of 1
        require(isValidLoc(loc1.lat, loc1.long));
        require(isValidLoc(loc2.lat, loc2.long));
        if (loc1.lat == loc2.lat) {
            uint16 diff = loc1.long > loc2.long
                ? loc1.long - loc2.long
                : loc2.long - loc1.long;
            return diff == 1;
        } else if (loc1.long == loc2.long) {
            uint16 diff = loc1.lat > loc2.lat
                ? loc1.lat - loc2.lat
                : loc2.lat - loc1.lat;
            return diff == 1;
        }
        return false;
    }

    modifier onlyLandOwner(uint16 lat, uint16 long) {
        require(locationMap[lat][long] == msg.sender);
        _;
    }
}
