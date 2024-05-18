import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const GaiaLocationModule = buildModule('GaiaLocationModule', (m) => {
  const gaia = m.contract('Gaia_Location');
  console.log(gaia);

  return { gaia };
});

export default GaiaLocationModule;
