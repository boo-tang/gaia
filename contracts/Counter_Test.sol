pragma solidity ^0.8.0;

contract Counter_Test {
    int256 private count = 0;

    function incrementCounter() public {
        count += 1;
    }

    function decrementCounter() public {
        count -= 1;
    }

    function set(int256 num) public {
        count = num;
    }

    function getCount() public view returns (int256) {
        return count;
    }
}
