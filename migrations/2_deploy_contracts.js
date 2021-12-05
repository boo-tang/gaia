var Gaia_Location = artifacts.require('Gaia_Location')
var Gaia_Auction = artifacts.require('Gaia_Auction')
var Counter_Test = artifacts.require('Counter_Test')
var SimpleStorage = artifacts.require('SimpleStorage')

module.exports = function (deployer) {
  deployer.deploy(Gaia_Location)
  deployer.deploy(Gaia_Auction)
  deployer.deploy(Counter_Test)
  deployer.deploy(SimpleStorage)
}
