App = {
  web3Provider: null,
  contracts: {},

  init: async function () {
    var rows = 10
    var cols = 10

    var $row = $('<div />', { class: 'grid-row' })
    var $square = $('<div />', {
      'class': 'grid-square',
      'data-y': 0,
      'data-x': 0,
    })

    //clone the temp row object with the columns to the wrapper
    for (var i = 0; i < rows; i++) {
      var row = $row.clone()

      for (var j = 0; j < cols; j++) {
        var square = $square.clone().attr('data-x', i).attr('data-y', j)
        row.append(square)
      }
      $('#gaia-grid').append(row)
    }

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
    $.getJSON('Gaia_Bit.json', function (data) {
      console.log('data', data)
      //  Get the necessary contract artifact file and instantiate it with @truffle/contract
      var GaiaBitArtifact = data
      App.contracts.Gaia_Bit = TruffleContract(GaiaBitArtifact)
      // Set the provider for our contract
      App.contracts.Gaia_Bit.setProvider(App.web3Provider)
      // Use our contract to retrieve and mark the purchased bits
      return App.markPurchased()
    })

    return App.bindEvents()
  },

  bindEvents: function () {
    $(document).on('click', '.grid-square', App.handlePurchase)
  },

  markPurchased: function () {
    var gaiaInstance
    console.log('markPurchased')
    App.contracts.Gaia_Bit.deployed()
      .then(function (instance) {
        gaiaInstance = instance
        console.log('getBits')
        return gaiaInstance.getBits.call()
      })
      .then(function (rows) {
        console.log('rows', rows)
        for (i = 0; i < rows.length; i++) {
          for (j = 0; j < rows[i].length; j++) {
            if (rows[j][i] !== '0x0000000000000000000000000000000000000000') {
              $('.grid-square')
                .eq(i * 10 + j)
                // .find('button')
                // .text('Success')
                // .attr('disabled', true)
                .addClass('purchased')
            }
          }
        }
      })
      .catch(function (err) {
        console.log(err.message)
      })
  },

  handlePurchase: function (event) {
    event.preventDefault()

    var xCoor = parseInt($(event.target).attr('data-x'))
    var yCoor = parseInt($(event.target).attr('data-y'))

    var gaiaInstance

    web3.eth.getAccounts(function (error, accounts) {
      if (error) {
        console.log(error)
      }

      var account = accounts[0]

      App.contracts.Gaia_Bit.deployed()
        .then(function (instance) {
          gaiaInstance = instance

          // Execute adopt as a transaction by sending account
          return gaiaInstance.purchaseOne(xCoor, yCoor, { from: account })
        })
        .then(function (result) {
          return App.markPurchased()
        })
        .catch(function (err) {
          console.log(err.message)
        })
    })
  },
}

$(function () {
  $(document).ready(function () {
    App.init()
  })
})
