import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

const DEFAULT_ADMIN_ROLE =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

// Deploys the country account implementation, GaiaCountries, GaiaSquares and GaiaAuction, makes
// the auction the only issuer, and then moves the admin role from the deployer to `admin`
// (a multisig). The deployer keeps no role. `registry` is the canonical ERC-6551 registry.
const GaiaModule = buildModule('GaiaModule', (m) => {
  const deployer = m.getAccount(0);
  const admin = m.getParameter<string>('admin');
  const registry = m.getParameter<string>('registry');
  const treasury = m.getParameter<string>('treasury');
  const startTime = m.getParameter<bigint>('startTime');
  const endTime = m.getParameter<bigint>('endTime');
  const minBidPerSquareWei = m.getParameter<bigint>('minBidPerSquareWei');
  const minShapeSquares = m.getParameter<bigint>('minShapeSquares');
  const maxShapeSquares = m.getParameter<bigint>('maxShapeSquares');
  const maxShapeAspectRatio = m.getParameter<bigint>('maxShapeAspectRatio');

  const accountImplementation = m.contract('GaiaCountryAccount');
  const countries = m.contract('GaiaCountries', [
    deployer,
    registry,
    accountImplementation,
  ]);
  const squares = m.contract('GaiaSquares', [countries]);
  const setSquares = m.call(countries, 'setSquares', [squares]);
  const auction = m.contract('GaiaAuction', [
    countries,
    treasury,
    startTime,
    endTime,
    minBidPerSquareWei,
    minShapeSquares,
    maxShapeSquares,
    maxShapeAspectRatio,
  ]);

  const issuerRole = m.staticCall(countries, 'ISSUER_ROLE');
  const grantIssuer = m.call(countries, 'grantRole', [issuerRole, auction], {
    id: 'grantIssuerToAuction',
  });
  const addAuction = m.call(countries, 'addAuction', [auction]);

  const grantAdmin = m.call(
    countries,
    'grantRole',
    [DEFAULT_ADMIN_ROLE, admin],
    { id: 'grantAdminToMultisig', after: [setSquares, grantIssuer, addAuction] },
  );
  m.call(countries, 'renounceRole', [DEFAULT_ADMIN_ROLE, deployer], {
    after: [grantAdmin],
  });

  return { accountImplementation, countries, squares, auction };
});

export default GaiaModule;
