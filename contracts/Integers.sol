// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * Integers Library
 *
 * In summary this is a simple library of integer functions which allow a simple
 * conversion to and from strings
 *
 * @author James Lockhart <james@n3tw0rk.co.uk>
 */
library Integers {
    /**
     * To String
     *
     * Converts an unsigned integer to the ASCII string equivalent value
     *
     * @param _base The unsigned integer to be converted to a string
     * @return string The resulting ASCII string value
     */
    function toString(uint256 _base) internal pure returns (string memory) {
        // handle 0 case
        if (_base == 0) {
            return "0";
        }
        bytes memory _tmp = new bytes(32);
        uint16 i;
        for (i = 0; _base > 0; i++) {
            _tmp[i] = bytes1(uint8((_base % 10) + 48));
            _base /= 10;
        }
        bytes memory _real = new bytes(i);
        for (uint16 j = 0; j < _real.length; j++) {
            i--;
            _real[j] = _tmp[i];
        }
        return string(_real);
    }
}
