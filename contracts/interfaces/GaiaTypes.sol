// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Exclusive upper bounds for square coordinates (1/100 degree precision).
uint16 constant LOC_MAX_LAT = 18000;
uint16 constant LOC_MAX_LNG = 36000;

struct Loc {
    uint16 lat;
    uint16 lng;
}
