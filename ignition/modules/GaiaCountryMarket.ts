import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

import GaiaModule from './Gaia';

// Deploys GaiaCountryMarket for the GaiaCountries of GaiaModule. The market has no roles.
const GaiaCountryMarketModule = buildModule('GaiaCountryMarketModule', m => {
  const { countries } = m.useModule(GaiaModule);
  const market = m.contract('GaiaCountryMarket', [countries]);
  return { market };
});

export default GaiaCountryMarketModule;
