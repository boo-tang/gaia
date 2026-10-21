import { describe, expect, it } from 'vitest';
import { gaiaAuctionAbi } from '../src/abis';
import { parseDeployment } from '../src/deployment';

// The format that scripts/deploy-local.ts writes to deployments/local.json.
const local = {
  chainId: 31337,
  deployBlock: 1,
  contracts: {
    GaiaCountries: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    GaiaSquares: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    GaiaCountryAccount: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    GaiaAuction: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    GaiaLandSale: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    GaiaCountryMarket: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    ERC6551Registry: '0x000000006551c19487814612e58FE06813775758',
  },
  admin: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  treasury: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  auction: { startTime: 1792246554, endTime: 1792250154, maxEndTime: 1792336554 },
};

describe('parseDeployment', () => {
  it('accepts the file of yarn deploy:local', () => {
    const deployment = parseDeployment(JSON.parse(JSON.stringify(local)));
    expect(deployment).toEqual(local);
    const auction: `0x${string}` = deployment.contracts.GaiaAuction;
    expect(auction).toBe(local.contracts.GaiaAuction);
  });

  it('names each wrong field', () => {
    const bad = {
      ...local,
      chainId: '31337',
      contracts: { ...local.contracts, GaiaAuction: '0x1234', GaiaLandSale: undefined },
    };
    expect(() => parseDeployment(bad)).toThrow(/chainId/);
    expect(() => parseDeployment(bad)).toThrow(/contracts\.GaiaAuction/);
    expect(() => parseDeployment(bad)).toThrow(/contracts\.GaiaLandSale/);
  });

  it('rejects auction times out of order', () => {
    const bad = { ...local, auction: { ...local.auction, maxEndTime: local.auction.endTime - 1 } };
    expect(() => parseDeployment(bad)).toThrow(/auction/);
  });

  it('rejects a value that is not an object', () => {
    expect(() => parseDeployment(undefined)).toThrow(/Invalid deployment file/);
  });
});

describe('abis', () => {
  it('keeps the literal types of the ABI', () => {
    type FunctionName = Extract<(typeof gaiaAuctionAbi)[number], { type: 'function' }>['name'];
    const names: FunctionName[] = ['bidOnShape', 'settleShape', 'endTime', 'withdraw'];
    for (const name of names) {
      expect(gaiaAuctionAbi.some((item) => item.type === 'function' && item.name === name)).toBe(true);
    }
  });
});
