// contracts/Gaia_Location.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./Integers.sol";

contract Gaia_Location {
    using Integers for uint16;

    using Counters for Counters.Counter;
    Counters.Counter private _tokenIdTracker;

    // struct MintedLocation {
    //     uint16 lat;
    //     uint16 long;
    //     uint256 locId;
    //     uint64 dateMinted;
    // }

    struct Loc {
        uint16 lat;
        uint16 long;
    }

    /**
     * Lat can have values from -90.00 -> 90.00
     * Long can have values from -180.00 -> 180.00
     * we want positive integers so the ranges become:
     * lat: 0 -> 18,000
     * long: 0 -> 36,000
     */
    uint16 constant maxLat = 18000;
    uint16 constant maxLong = 36000;

    // event LocationClaimed(bytes indexed locId, address indexed by);
    // event LocationsClaimed(bytes[] indexed locIds, address indexed by);
    event LocationClaimed(address to, uint16 lat, uint16 long);
    event LocationsClaimed(address to, Loc[] locs);
    // event LocationClaimed(address to, uint16 lat, uint16 long);

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
    uint256 private totalSupply;

    mapping(uint16 => mapping(uint16 => address)) public locationMap;

    mapping(uint256 => address) public tokenIdToOwner;

    // bytes[] public locationIds;

    constructor() {
        uint256 supply = uint256(maxLong) * uint256(maxLat);
        totalSupply = supply;
    }

    function mintSingleLocation(uint16 lat, uint16 long)
        public
        returns (uint256)
    {
        require(isValidLoc(lat, long), "Invalid coordinates");
        // bytes memory locId = getLocHash(lat, long);

        // add owner to list if new
        if (balanceOf[msg.sender] == 0) {
            landOwners.push(msg.sender);
        }

        // get ERC721 ID
        uint256 tokenId = _tokenIdTracker.current();
        _tokenIdTracker.increment();
        tokenIdToOwner[tokenId] = msg.sender;

        // _tokenIDToLocID[tokenIdToAssign] = locId;
        // _locIDToTokenID[locId] = tokenIdToAssign;

        locationMap[lat][long] = msg.sender;
        balanceOf[msg.sender]++;
        // mintedLocations.push(locId);

        emit LocationClaimed(msg.sender, lat, long);

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
        uint16 prevLongitudeRangeStart = location.long;
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
            uint16 longitudeRangeStart = locs[locationIndex].long;

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
                    isValidLoc(location.lat, location.long),
                    "gap between latitudes detected"
                );
                // bytes memory locId = getLocHash(location.lat, location.long);
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
                    // otherwise we check for adjacency by checking if it's within previous lat's range
                    latHasAdjacent =
                        location.long >= prevLongitudeRangeStart &&
                        location.long <= prevLongitudeRangeEnd;
                }

                // generate tokenId & increment
                uint256 tokenId = _tokenIdTracker.current();
                _tokenIdTracker.increment();
                tokenIdToOwner[tokenId] = msg.sender;
                tokenIds[locationIndex] = tokenId;
                // add to locationMap for ownership checks
                locationMap[location.lat][location.long] = msg.sender;

                prevLocation = location;

                locationIndex++;
            }
            latIndex++;

            uint16 longitudeRangeEnd = prevLocation.long;

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
            prevLongitudeRangeEnd = prevLocation.long;
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

    function isValidLoc(uint16 lat, uint16 long) public pure returns (bool) {
        return lat < maxLat && long < maxLong;
    }

    function getAllOwners() public view returns (address[] memory) {
        return landOwners;
    }

    function ownerOfLoc(uint16 lat, uint16 long) public view returns (address) {
        return locationMap[lat][long];
    }

    function ownerOf(uint256 _tokenId) external view returns (address) {
        return tokenIdToOwner[_tokenId];
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
        uint16 long,
        address to
    ) public {
        //  require()
    }

    // function isValidLocation(Location memory loc) public returns (bool) {
    //     // TODO: figure out how the tiles will be calculated and therefore
    //     // which coordinates are considered valid
    // }

    // function hasOwner(uint16 lat, uint16 long) public view returns (bool) {
    //     bytes memory locId = getLocHash(lat, long);
    //     return !(locIdToOwner[locId] == address(0));
    // }

    function hasOwner(uint16 lat, uint16 long) public view returns (bool) {
        return !(locationMap[lat][long] == address(0));
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
