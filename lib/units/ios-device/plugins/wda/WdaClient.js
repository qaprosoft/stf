const request = require('request-promise')
const Promise = require('bluebird')
const iputil = require('../util/iputil')
const syrup = require('stf-syrup')
const logger = require('../../../../util/logger')


module.exports = syrup.serial()
  .define((options) => {
    const log = logger.createLogger('WdaClient')
    const ip = iputil(options.serial)

    const WdaClient = {
      tochDownParams: {},
      isMove: false,
      baseUrl: '',
      sessionId: '',
      orientation: 'PORTRAIT',
      connect: function (port) {
        this.baseUrl = `http://${ip}:${port || options.wdaServerPort}`
        return new Promise((resolve, reject) => {
          request.get(this.baseUrl)
            .then(response => {
              try {
                this.sessionId = JSON.parse(response).sessionId
                return resolve()
              } catch (e) {
                return reject(new Error('Failed to parse json object'))
              }
            })
            .catch(err => {
              return reject(err)
            })
        })
      },
      swipe: function (params, deviceSize) {
        const scale = this.setScaleByRotation(params, deviceSize)
        this.isMove = true
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/dragfromtoforduration`,
            body: scale,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      touchUp: function () {
        if (!this.isMove) {
          return new Promise((resolve, reject) => {
            request({
              method: 'POST',
              uri: `${this.baseUrl}/session/${this.sessionId}/wda/tap/0`,
              body: this.tochDownParams,
              json: true
            })
              .then(response => resolve(response))
              .catch(err => reject(err))
          })
        }
      },
      tap: function (params) {
        this.tochDownParams = params
        this.isMove = false
      },
      homeBtn: function () {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/wda/homescreen`
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      size: function () {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${this.baseUrl}/session/${this.sessionId}/window/size`
          })
            .then(response => {
              try {
                return resolve(JSON.parse(response).value)
              } catch (e) {
                return reject(new Error('Failed to parse json object'))
              }
            })
            .catch(err => reject(err))
        })
      },
      typeKey: function (params) {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/keys`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      openUrl: function (params) {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      rotation: function (params) {
        this.orientation = params.orientation
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/orientation`,
            body: params,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      screenshot: function () {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${this.baseUrl}/screenshot`
          })
            .then(response => {
              try {
                resolve(JSON.parse(response))
              } catch (e) {
                reject(e)
              }
            })
            .catch(err => reject(err))
        })
      },
      setScaleByRotation: function (params, deviceSize) {
        switch (this.orientation) {
          case 'PORTRAIT':
            return {
              fromX: params.fromX * deviceSize.width,
              fromY: params.fromY * deviceSize.height,
              toX: params.toX * deviceSize.width,
              toY: params.toY * deviceSize.height,
              duration: params.duration
            }
          case 'LANDSCAPE':
            return {
              toX: params.fromY * deviceSize.width,
              toY: params.fromX * deviceSize.height,
              fromX: params.toY * deviceSize.width,
              fromY: params.toX * deviceSize.height,
              duration: params.duration
            }
          default:
            return {
              fromX: params.fromX * deviceSize.width,
              fromY: params.fromY * deviceSize.height,
              toX: params.toX * deviceSize.width,
              toY: params.toY * deviceSize.height,
              duration: params.duration
            }
        }
      },
      resetSession: function () {

      },
      getPasteboard: function () {
        return new Promise((resolve, reject) => {
          request({
            method: 'POST',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/getPasteboard`,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      },
      InformationIosDevice: function () {
        return new Promise((resolve, reject) => {
          request({
            method: 'GET',
            uri: `${this.baseUrl}/session/${this.sessionId}/wda/activeAppInfo`,
            json: true
          })
            .then(response => resolve(response))
            .catch(err => reject(err))
        })
      }
    }
    return WdaClient
  })
