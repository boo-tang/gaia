var Gaia_Location = artifacts.require('Gaia_Location')
var Counter_Test = artifacts.require('Counter_Test')
var SimpleStorage = artifacts.require('SimpleStorage')

module.exports = function (deployer) {
  deployer.deploy(Gaia_Location)
  deployer.deploy(Counter_Test)
  deployer.deploy(SimpleStorage)
}
