import { loadFixture } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

describe('Gaia_Location', function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.

  async function deployGaia() {
    const gaia = await hre.viem.deployContract('Gaia_Location', []);
    const publicClient = await hre.viem.getPublicClient();
    const [owner, otherAccount] = await hre.viem.getWalletClients();
    return {
      owner,
      otherAccount,
      publicClient,
      gaia,
    };
  }

  describe('Location Minting', function () {
    it('Should mint a location', async function () {
      const { gaia } = await loadFixture(deployGaia);
      await expect(gaia.write.mintSingleLocation([33, 69])).to.be.fulfilled;
    });
    it('Should mint adjacent locations', async function () {
      const { gaia, owner } = await loadFixture(deployGaia);

      await expect(
        gaia.write.mintMultipleLocations([
          [
            { lat: 33, lng: 69 },
            { lat: 33, lng: 70 },
          ],
        ]),
      ).to.be.fulfilled;
    });
    it('Should reject non-adjacent locations', async function () {
      const { gaia } = await loadFixture(deployGaia);

      await expect(
        gaia.write.mintMultipleLocations([
          [
            { lat: 33, lng: 69 },
            { lat: 33, lng: 71 },
          ],
        ]),
      ).to.be.rejectedWith('gap between longitudes detected');
    });
    it('Should reject a concave shape', async function () {
      const { gaia } = await loadFixture(deployGaia);

      await expect(
        gaia.write.mintMultipleLocations([
          [
            { lat: 33, lng: 69 },
            { lat: 33, lng: 70 },
            { lat: 33, lng: 71 },

            { lat: 34, lng: 71 },
            { lat: 34, lng: 72 },
            { lat: 34, lng: 73 },

            { lat: 35, lng: 69 },
            { lat: 35, lng: 70 },
            { lat: 35, lng: 71 },
          ],
        ]),
      ).to.be.rejectedWith('Shape is not convex');
    });
    it('Should accept a convex shape', async function () {
      const { gaia, publicClient } = await loadFixture(deployGaia);
      await expect(
        gaia.write.mintMultipleLocations([
          [
            { lat: 33, lng: 69 },
            { lat: 33, lng: 70 },
            { lat: 33, lng: 71 },

            { lat: 34, lng: 68 },
            { lat: 34, lng: 69 },
            { lat: 34, lng: 70 },
            { lat: 34, lng: 71 },

            { lat: 35, lng: 69 },
            { lat: 35, lng: 70 },
            { lat: 35, lng: 71 },
          ],
        ]),
      ).to.be.fulfilled;
    });

    it('Should not allow minting an owned location', async function () {
      const { gaia, otherAccount } = await loadFixture(deployGaia);
      const gaiaAsOtherAccount = await hre.viem.getContractAt(
        'Gaia_Location',
        gaia.address,
        { client: { wallet: otherAccount } },
      );
      await gaia.write.mintSingleLocation([33, 69]);
      await expect(
        gaiaAsOtherAccount.write.mintSingleLocation([33, 69]),
      ).to.be.rejectedWith('Location already owned');
    });
  });

  describe('Events', function () {
    it('Should emit an event on location minting', async function () {
      const { gaia, owner, publicClient } = await loadFixture(deployGaia);
      const hash = await gaia.write.mintSingleLocation([33, 69]);
      await publicClient.waitForTransactionReceipt({ hash });
      const mintEvents = await gaia.getEvents.LocationClaimed();

      expect(mintEvents).to.have.lengthOf(1);
      expect(mintEvents[0].args.to?.toString().toLocaleLowerCase()).to.equal(
        owner.account.address.toString().toLowerCase(),
      );
      expect(mintEvents[0].args.lat).to.equal(33);
      expect(mintEvents[0].args.lng).to.equal(69);
    });
    it('Should emit an event on multiple location minting', async function () {
      const { gaia, owner, publicClient } = await loadFixture(deployGaia);
      const hash = await gaia.write.mintMultipleLocations([
        [
          { lat: 33, lng: 69 },
          { lat: 33, lng: 70 },
        ],
      ]);
      await publicClient.waitForTransactionReceipt({ hash });
      const mintEvents = await gaia.getEvents.LocationsClaimed();

      console.log(mintEvents[0].args.locs![0].lat);
      expect(mintEvents).to.have.lengthOf(1);
      expect(mintEvents[0].args.to?.toString().toLocaleLowerCase()).to.equal(
        owner.account.address.toString().toLowerCase(),
      );
      expect(mintEvents[0].args.locs![0].lat).to.equal(33);
      expect(mintEvents[0].args.locs![0].lng).to.equal(69);
      expect(mintEvents[0].args.locs![1].lat).to.equal(33);
      expect(mintEvents[0].args.locs![1].lng).to.equal(70);
    });
  });

  describe('Getters', function () {
    it('Should return the owner of a location', async function () {
      const { gaia, owner } = await loadFixture(deployGaia);
      await gaia.write.mintSingleLocation([33, 69]);
      const ownerOfLocation = await gaia.read.locationOwner([33, 69]);
      expect(ownerOfLocation.toLowerCase()).to.equal(
        owner.account.address.toLowerCase(),
      );
    });
  });
});
