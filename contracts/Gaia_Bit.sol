// contracts/Gaia_Bit.sol
// SPDX-License-Identifier: MIT

pragma solidity ^0.5.0;

// import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract Gaia_Bit {
    uint16 private _height = 10;
    uint16 private _width = 10;

    address[10][10] public landBits;

    function purchaseOne(uint16 x, uint16 y) public returns (bool) {
        require(x < _height && y < _width);

        landBits[y][x] = msg.sender;

        return true;
    }

    function getBits() public view returns (address[10][10] memory) {
        return landBits;
    }
}
