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

    function mintMultipleLocations(Loc[] memory locs) public returns (bool) {
        // returns (bytes[] memory)
        if (locs.length == 0) {
            // return new bytes[](0);
            return true;
        }

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
        uint16 prevLongitudeRangeStart = location.long;
        uint16 prevLongitudeRangeEnd = 0;

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
            uint16 longitudeRangeStart = locs[locationIndex].long;

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
                    isValidLoc(location.lat, location.long),
                    "gap between latitudes detected"
                );
                bytes memory locId = getLocHash(location.lat, location.long);
                require(
                    locationMap[location.lat][location.long] == address(0),
                    "Included location has owner"
                );
                ///////////////////////////////////////////////////////////////////////
                ///////////////////////////////////////////////////////////////////////

                // check that longitudes are adjacent
                if (longCounter != 0) {
                    require(
                        location.long == prevLocation.long + 1,
                        "gap between longitudes detected"
                    );
                }
                longCounter++;

                // if this is the first lattitude we're iterating through,
                // no need to check for lat adjacency
                if (latIndex == 0) {
                    latHasAdjacent = true;
                } else if (latHasAdjacent != true) {
                    // otherwise we check for adjacency by checking if it's withing previous lat's range
                    latHasAdjacent =
                        location.long >= prevLongitudeRangeStart &&
                        location.long <= prevLongitudeRangeEnd;
                }
                prevLocation = location;
                locationIndex++;
            }
            latIndex++;
            // longitudeRangeEnd = prevLocation.long;

            // assign values for next lat to check
            prevLongitudeRangeEnd = prevLocation.long;
            prevLongitudeRangeStart = longitudeRangeStart;

            // check if we found an adjacent longitude in this lat
            require(latHasAdjacent, "lats are adjacent but not longitudes");
        }

        return true;
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
