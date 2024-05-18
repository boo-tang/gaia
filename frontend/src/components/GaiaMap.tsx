import React, { useCallback, useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import RectGrid from "./RectGrid";
import {
  toggleLocation as toggleLocationAction,
  resetLocations as resetLocationsAction,
  getSelectedLocations,
} from "../state/locations";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { Loc } from "../types";
import GaiaLocationABI from "../../artifacts/contracts/Gaia_Location.sol/Gaia_Location.json";
import addresses from "../constants/addresses";
import { fromCoorToUint } from "../utils/location";

export const GaiaMap = () => {
  const account = useAccount();
  const dispatch = useAppDispatch();
  const chainId = useChainId();

  const { data: hash, isPending, writeContract, error } = useWriteContract();

  // ready state for map to display grid
  const [mapReady, setMapReady] = useState<boolean>(false);

  ////////////////////////////////////////////////////////////
  ////////////// Selected Locations tracking /////////////////
  ////////////////////////////////////////////////////////////
  // selected locations come from app Redux store
  const { selectedLocations } = useAppSelector(getSelectedLocations);

  const toggleLocation = useCallback(
    (loc: Loc) => dispatch(toggleLocationAction(loc)),
    [dispatch]
  );
  const resetLocations = useCallback(
    () => dispatch(resetLocationsAction()),
    [dispatch]
  );

  ////////////////////////////////////////////////////////////
  ////////////////// Web3 Contract Code //////////////////////
  ////////////////////////////////////////////////////////////
  const onPurchase = async () => {
    const locations = selectedLocations.map((_loc) => {
      const loc = fromCoorToUint(_loc);
      return [loc.lat, loc.lng];
    });
    console.log("minting selected locs", locations);
    writeContract({
      abi: GaiaLocationABI.abi,
      address: addresses.GaiaLocation[chainId || 1337],
      functionName: "mintMultipleLocations",
      args: [locations],
    });
  };

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash,
    });

  // read contract
  const { data, isLoading: isUserLocationsLoading } = useReadContract({
    abi: GaiaLocationABI.abi,
    address: addresses.GaiaLocation[chainId || 1337],
    functionName: "getUserLocations",
    args: [account.address],
  });

  const userLocationsData = data as unknown as Loc[];

  // useEffect(() => {
  //   const fn = async () => {
  //     if (account && !isPending) {
  //       const locations = await getUserLocations();
  //       updateUserLocations(locations);
  //       console.log('USER LOCATIONS', locations);
  //     }
  //   };
  //   fn();
  // }, [account, pendingTx, getUserLocations]);

  if (typeof account === "undefined") {
    return (
      <div className="MapContainer">
        Loading Web3, accounts, and contract... Reload page
      </div>
    );
  }

  return (
    <>
      {!!selectedLocations?.length &&
        account.address &&
        (!isPending ? (
          <button
            style={{
              position: "fixed",
              top: "6vh",
              left: "50%",
              transform: "translate(-50%, 0)",
              zIndex: "10000",
            }}
            onClick={onPurchase}
          >
            Click to Purchase
          </button>
        ) : (
          "Loading..."
        ))}
      <MapContainer
        // start rendering the map from Manhattan
        center={[40.76203, -73.96277]}
        zoom={12}
        scrollWheelZoom={true}
        className="MapContainer"
        whenReady={() => setMapReady(true)}
      >
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // url="http://{s}.tiles.wmflabs.org/osm-no-labels/{z}/{x}/{y}.png"
        />
        {!isConfirming && (
          <RectGrid
            toggleLocation={toggleLocation}
            userLocations={userLocationsData}
            selectedLocations={selectedLocations}
            mapReady={mapReady}
          />
        )}
      </MapContainer>
    </>
  );
};
