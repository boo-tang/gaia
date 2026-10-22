import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

import GaiaModule from './Gaia';

// Deploys GaiaLandSale, the sale of the squares that the auction did not sell, for the
// GaiaCountries and GaiaAuction of GaiaModule. Each purchase sends its ETH to `treasury`.
//
// This module does not grant ISSUER_ROLE to the sale. On Base, the admin multisig grants it after
// the auction ends (operating rule), with `GaiaCountries.grantRole(ISSUER_ROLE, sale)`. The
// deployer cannot do it, because GaiaModule removes its admin role.
const GaiaLandSaleModule = buildModule('GaiaLandSaleModule', m => {
  const { countries, auction } = m.useModule(GaiaModule);
  const treasury = m.getParameter<string>('treasury');
  const startPrice = m.getParameter<bigint>('startPrice');
  const endPrice = m.getParameter<bigint>('endPrice');
  const holdDuration = m.getParameter<bigint>('holdDuration');
  const dropDuration = m.getParameter<bigint>('dropDuration');

  const sale = m.contract('GaiaLandSale', [
    countries,
    auction,
    treasury,
    startPrice,
    endPrice,
    holdDuration,
    dropDuration,
  ]);

  return { sale };
});

export default GaiaLandSaleModule;
