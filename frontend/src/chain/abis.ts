import type { Abi } from 'viem';

import GaiaAuctionArtifact from '../../artifacts/contracts/GaiaAuction.sol/GaiaAuction.json';
import GaiaCountriesArtifact from '../../artifacts/contracts/GaiaCountries.sol/GaiaCountries.json';
import GaiaSquaresArtifact from '../../artifacts/contracts/GaiaSquares.sol/GaiaSquares.json';
import GaiaCountryAccountArtifact from '../../artifacts/contracts/GaiaCountryAccount.sol/GaiaCountryAccount.json';

// Cast to viem's loose `Abi` type: JSON imports don't preserve the string-literal types
// (e.g. `type: "function"`) that wagmi's stricter generics expect from inline ABIs.
export const gaiaAuctionAbi = GaiaAuctionArtifact.abi as Abi;
export const gaiaCountriesAbi = GaiaCountriesArtifact.abi as Abi;
export const gaiaSquaresAbi = GaiaSquaresArtifact.abi as Abi;
export const gaiaCountryAccountAbi = GaiaCountryAccountArtifact.abi as Abi;
