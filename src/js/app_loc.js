App = {
  web3Provider: null,
  contracts: {},

  init: async function () {
    return await App.initWeb3()
  },

  initWeb3: async function () {
    // Modern dapp browsers...
    if (window.ethereum) {
      App.web3Provider = window.ethereum
      try {
        // Request account access
        await window.ethereum.enable()
        console.log('connected with window.ethereum')
      } catch (error) {
        // User denied account access...
        console.error('User denied account access')
      }
    }
    // Legacy dapp browsers...
    else if (window.web3) {
      App.web3Provider = window.web3.currentProvider
    }
    // If no injected web3 instance is detected, fall back to Ganache
    else {
      App.web3Provider = new Web3.providers.HttpProvider(
        'http://localhost:8545',
      )
    }
    web3 = new Web3(App.web3Provider)

    return App.initContract()
  },

  initContract: function () {
    $.getJSON('Gaia_Loc.json', function (data) {
      console.log('data', data)
      //  Get the necessary contract artifact file and instantiate it with @truffle/contract
      var GaiaLocArtifact = data
      App.contracts.Gaia_Bit = TruffleContract(GaiaLocArtifact)
      // Set the provider for our contract
      App.contracts.Gaia_Bit.setProvider(App.web3Provider)
      // Use our contract to retrieve and mark the purchased bits
      return App.markPurchased()
    })

    return App.bindEvents()
  },
}
