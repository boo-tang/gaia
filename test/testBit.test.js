const Gaia_Bit = artifacts.require('Gaia_Bit')

contract('Gaia_Bit', accounts => {
  let gaia
  let expectedOwner

  before(async () => {
    gaia = await Gaia_Bit.deployed()
  })

  describe('purchasing a bit and retrieving account addresses', async () => {
    before('purchase a bit using accounts[0]', async () => {
      await gaia.purchaseOne(3, 8, { from: accounts[0] })

      expectedOwner = accounts[0]
    })

    it('can fetch the address of an owner by x-y coordinates', async () => {
      const owners = await gaia.getBits()
      const owner = owners[8][3]
      assert.equal(
        owner,
        expectedOwner,
        'The owner of the purchased bit should be the first account.',
      )
    })
  })
})
