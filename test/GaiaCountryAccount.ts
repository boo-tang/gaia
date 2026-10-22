import { expect } from 'chai';
import { encodeFunctionData, hashMessage, parseAbi, parseEther, toFunctionSelector, zeroAddress } from 'viem';

import { deployAccount, deployLand } from './helpers/land';
import { loadFixture, viem } from './helpers/setup';
import { row } from './helpers/shapes';

const approvalAbi = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function setApprovalForAll(address operator, bool approved)',
  'function increaseAllowance(address spender, uint256 amount)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function approve(address spender, uint256 id, uint256 amount)',
  'function setOperator(address spender, bool approved)',
  'function approveAndCall(address spender, uint256 amount)',
  'function approveAndCall(address spender, uint256 amount, bytes data)',
  'function authorizeOperator(address operator)',
]);

describe('GaiaCountryAccount', function () {
  // Alice owns country 1 (row 10, columns 10-12). Its account is deployed and holds 1 ETH and
  // 100 tokens.
  async function deploy() {
    const [admin, issuer, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const land = await deployLand(admin.account.address);
    await land.countries.write.grantRole([await land.countries.read.ISSUER_ROLE(), issuer.account.address]);
    const asIssuer = await viem.getContractAt('GaiaCountries', land.countries.address, { client: { wallet: issuer } });
    await asIssuer.write.createCountry([alice.account.address, row(10, 10, 12)]);

    const account = await deployAccount(land, 1n);
    const asAlice = await viem.getContractAt('GaiaCountryAccount', account, {
      client: { wallet: alice },
    });
    const token = await viem.deployContract('MockERC20');
    await token.write.mint([account, 100n]);
    await alice.sendTransaction({ to: account, value: parseEther('1') });
    return { land, account, asAlice, token, alice, bob, publicClient };
  }

  describe('ERC-1271', function () {
    it('never accepts a signature, also from the owner', async function () {
      const { asAlice, alice } = await loadFixture(deploy);
      const message = 'Sign in as country 1';
      const signature = await alice.signMessage({ message });
      expect(await asAlice.read.isValidSignature([hashMessage(message), signature])).to.equal('0xffffffff');
      expect(await asAlice.read.isValidSignature([hashMessage(message), '0x'])).to.equal('0xffffffff');
    });

    it('supports the ERC-1271 interface', async function () {
      const { asAlice } = await loadFixture(deploy);
      expect(await asAlice.read.supportsInterface(['0x1626ba7e'])).to.equal(true);
    });
  });

  describe('approvals through execute', function () {
    const calls: { name: string; selector: string; data: `0x${string}` }[] = [
      {
        name: 'approve(address,uint256)',
        selector: '0x095ea7b3',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'approve',
          args: [zeroAddress, 1n],
        }),
      },
      {
        name: 'setApprovalForAll(address,bool)',
        selector: '0xa22cb465',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'setApprovalForAll',
          args: [zeroAddress, true],
        }),
      },
      {
        name: 'increaseAllowance(address,uint256)',
        selector: '0x39509351',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'increaseAllowance',
          args: [zeroAddress, 1n],
        }),
      },
      {
        name: 'approve(address,address,uint160,uint48)',
        selector: '0x87517c45',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'approve',
          args: [zeroAddress, zeroAddress, 1n, 1],
        }),
      },
      {
        name: 'approve(address,uint256,uint256)',
        selector: '0x426a8493',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'approve',
          args: [zeroAddress, 1n, 1n],
        }),
      },
      {
        name: 'setOperator(address,bool)',
        selector: '0x558a7297',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'setOperator',
          args: [zeroAddress, true],
        }),
      },
      {
        name: 'approveAndCall(address,uint256)',
        selector: '0x3177029f',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'approveAndCall',
          args: [zeroAddress, 1n],
        }),
      },
      {
        name: 'approveAndCall(address,uint256,bytes)',
        selector: '0xcae9ca51',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'approveAndCall',
          args: [zeroAddress, 1n, '0x'],
        }),
      },
      {
        name: 'authorizeOperator(address)',
        selector: '0x959b8c3f',
        data: encodeFunctionData({
          abi: approvalAbi,
          functionName: 'authorizeOperator',
          args: [zeroAddress],
        }),
      },
    ];

    for (const call of calls) {
      it(`rejects ${call.name}`, async function () {
        const { asAlice, token } = await loadFixture(deploy);
        expect(call.data.slice(0, 10)).to.equal(call.selector);
        expect(toFunctionSelector(call.name)).to.equal(call.selector);
        await expect(asAlice.write.execute([token.address, 0n, call.data, 0])).to.be.rejectedWith('ApprovalNotAllowed');
        expect(await asAlice.read.state()).to.equal(0n);
      });
    }
  });

  describe('execute and signer rules', function () {
    it('rejects an operation other than a call', async function () {
      const { asAlice, token, bob } = await loadFixture(deploy);
      const data = encodeFunctionData({
        abi: token.abi,
        functionName: 'transfer',
        args: [bob.account.address, 1n],
      });
      // 1 is delegatecall in ERC-6551.
      await expect(asAlice.write.execute([token.address, 0n, data, 1])).to.be.rejectedWith('UnsupportedOperation');
      expect(await asAlice.read.state()).to.equal(0n);
    });

    it('accepts only the country owner as a signer', async function () {
      const { asAlice, alice, bob } = await loadFixture(deploy);
      // IERC6551Account.isValidSigner.selector
      expect(await asAlice.read.isValidSigner([alice.account.address, '0x'])).to.equal('0x523e3260');
      expect(await asAlice.read.isValidSigner([bob.account.address, '0x'])).to.equal('0x00000000');
    });
  });

  describe('receiving tokens', function () {
    it('receives ERC-1155 tokens by safe transfer, one and in a batch', async function () {
      const { account, alice } = await loadFixture(deploy);
      const nft = await viem.deployContract('MockERC1155');
      await nft.write.mint([alice.account.address, 1n, 5n]);
      await nft.write.mint([alice.account.address, 2n, 5n]);
      const asAliceNft = await viem.getContractAt('MockERC1155', nft.address, {
        client: { wallet: alice },
      });
      await asAliceNft.write.safeTransferFrom([alice.account.address, account, 1n, 2n, '0x']);
      await asAliceNft.write.safeBatchTransferFrom([alice.account.address, account, [1n, 2n], [1n, 3n], '0x']);
      expect(await nft.read.balanceOf([account, 1n])).to.equal(3n);
      expect(await nft.read.balanceOf([account, 2n])).to.equal(3n);
    });
  });

  describe('transfers through execute', function () {
    it('sends an ERC-20 token', async function () {
      const { account, asAlice, token, bob } = await loadFixture(deploy);
      const data = encodeFunctionData({
        abi: token.abi,
        functionName: 'transfer',
        args: [bob.account.address, 40n],
      });
      await asAlice.write.execute([token.address, 0n, data, 0]);
      expect(await token.read.balanceOf([bob.account.address])).to.equal(40n);
      expect(await token.read.balanceOf([account])).to.equal(60n);
      expect(await asAlice.read.state()).to.equal(1n);
    });

    it('sends ETH with empty data', async function () {
      const { account, asAlice, bob, publicClient } = await loadFixture(deploy);
      const before = await publicClient.getBalance({ address: bob.account.address });
      await asAlice.write.execute([bob.account.address, parseEther('1'), '0x', 0]);
      expect(await publicClient.getBalance({ address: bob.account.address })).to.equal(before + parseEther('1'));
      expect(await publicClient.getBalance({ address: account })).to.equal(0n);
    });
  });
});
