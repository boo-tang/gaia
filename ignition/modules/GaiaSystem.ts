import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

import GaiaModule from './Gaia';
import GaiaCountryMarketModule from './GaiaCountryMarket';
import GaiaLandSaleModule from './GaiaLandSale';

// Deploys all Gaia contracts in one deployment: GaiaModule, the land sale and the country market.
// The land sale does not get ISSUER_ROLE here (see GaiaLandSale.ts).
const GaiaSystemModule = buildModule('GaiaSystemModule', m => {
  const gaia = m.useModule(GaiaModule);
  const { sale } = m.useModule(GaiaLandSaleModule);
  const { market } = m.useModule(GaiaCountryMarketModule);
  return { ...gaia, sale, market };
});

export default GaiaSystemModule;
