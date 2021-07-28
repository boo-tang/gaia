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

    /**
     * Parse Int
     *
     * Converts an ASCII string value into an uint as long as the string
     * its self is a valid unsigned integer
     *
     * @param _value The ASCII string to be converted to an unsigned integer
     * @return _ret uint The unsigned value of the ASCII string
     */
    function parseInt(string memory _value) public pure returns (uint256 _ret) {
        bytes memory _bytesValue = bytes(_value);
        uint256 j = 1;
        for (
            uint256 i = _bytesValue.length - 1;
            i >= 0 && i < _bytesValue.length;
            i--
        ) {
            require(
                uint8(_bytesValue[i]) >= 48 && uint8(_bytesValue[i]) <= 57,
                "error in assertion"
            );
            _ret += (uint8(_bytesValue[i]) - 48) * j;
            j *= 10;
        }
    }
}
