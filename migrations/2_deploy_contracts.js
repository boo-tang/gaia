var Gaia_Bit = artifacts.require('Gaia_Bit')
var Gaia_Loc = artifacts.require('Gaia_Loc')

module.exports = function (deployer) {
  deployer.deploy(Gaia_Bit)
  deployer.deploy(Gaia_Loc)
}
