import type { Abi } from 'viem';

import GaiaAuctionArtifact from '../../artifacts/contracts/GaiaAuction.sol/GaiaAuction.json';
import GaiaLocation721Artifact from '../../artifacts/contracts/GaiaLocation721.sol/GaiaLocation721.json';
import Country1155Artifact from '../../artifacts/contracts/Country1155.sol/Country1155.json';

// Cast to viem's loose `Abi` type: JSON imports don't preserve the string-literal types
// (e.g. `type: "function"`) that wagmi's stricter generics expect from inline ABIs.
export const gaiaAuctionAbi = GaiaAuctionArtifact.abi as Abi;
export const gaiaLocation721Abi = GaiaLocation721Artifact.abi as Abi;
export const country1155Abi = Country1155Artifact.abi as Abi;
