// contracts/Gaia_Bit.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

// import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract Gaia_Loc {
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

    uint16 maxLat = 18000;
    uint16 maxLong = 36000;

    event LocationClaimed(bytes indexed landId, address indexed by);
    event LocationTransfer(
        bytes indexed landId,
        address indexed from,
        address indexed to
    );

    /**
     * @dev Tracks the amount of locations each land owner has
     */
    mapping(address => uint256) public balanceOf; //number of locations owned by a given address

    /**
     * @dev A mapping from NFT ID to the address that owns it.
     */
    mapping(bytes => address) internal ownerToLocId;

    /**
     * @dev A list of unique owners.
     */
    address[] public landOwners;

    /**
     * @dev Mapping from owner address to count of their tokens.
     */
    mapping(address => uint256) private ownerToNFTokenCount;

    function mintLoc(uint16 lat, uint16 long) public returns (bytes memory) {
        require(isValidLoc(lat, long), "Invalid coordinates");
        bytes memory locId = getLocHash(lat, long);
        require(ownerToLocId[locId] == address(0), "Location has owner");

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

        ownerToLocId[locId] = msg.sender;
        balanceOf[msg.sender]++;

        emit LocationClaimed(locId, msg.sender);

        return locId;
    }

    function isValidLoc(uint16 lat, uint16 long) public view returns (bool) {
        return lat < maxLat && long < maxLong;
    }

    function getAllOwners() public view returns (address[] memory) {
        return landOwners;
    }

    // function claim(uint16 lat, uint16 long) public returns (bytes10) {
    //     require(lat < maxLat, "Invalid latitude");
    //     require(long < maxLong, "Invalid longtitue");

    // }

    /**
     * @dev Transfers location ownership
     */
    function transfer(bytes memory locId, address to) public {
        require(
            ownerToLocId[locId] == msg.sender,
            "sender does not own the land"
        );

        ownerToLocId[locId] = msg.sender;
        balanceOf[msg.sender]--;
        balanceOf[to]++;

        emit LocationTransfer(locId, msg.sender, to);
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
        return abi.encodePacked(lat, long);
    }

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

    // function uintToString(uint256 v) public pure returns (bytes5) {
    //     uint256 maxLength = 5;
    //     bytes memory reversed = new bytes(maxLength);
    //     uint256 i = 0;
    //     while (v != 0) {
    //         uint256 remainder = v % 10;
    //         v = v / 10;
    //         reversed[i++] = bytes1(uint8(48 + remainder));
    //     }
    //     bytes memory s = new bytes(i); // i + 1 is inefficient
    //     for (uint256 j = 0; j < i; j++) {
    //         s[j] = reversed[i - j - 1]; // to avoid the off-by-one error
    //     }
    //     // string memory str = string(s); // memory isn't implicitly convertible to storage
    //     return s;
    // }

    // function purchaseOne(uint16 x, uint16 y) public returns (bool) {
    //     require(x < _height && y < _width);

    //     landBits[y][x] = msg.sender;

    //     return true;
    // }

    // function getBits() public view returns (address[10][10] memory) {
    //     return landBits;
    // }
}
