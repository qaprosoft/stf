const logger = require('../../../util/logger')
const Promise = require('bluebird')

const request = require('request')
const _ = require('lodash')
const url = require('url')
const util = require('util')
const syrup = require('stf-syrup')
const wire = require('../../../wire')
const wirerouter = require('../../../wire/router')
const wireutil = require('../../../wire/util')
const iosutil = require('../../../util/iosutil')

module.exports = syrup.serial()
  .dependency(require('./solo'))
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../support/sub'))
  .dependency(require('./wda/WdaClient'))
  .define((options, solo, router, push, sub, wdaClient) => {
    const log = logger.createLogger('wda:client')
    try {
      const Wda = {}
      const streamPort = 9100

      Wda.connect = (port) => {
        const wdaPort = port || options.wdaServerPort

        return wdaClient.connect(wdaPort)
          .then(result => {
            return wdaClient.size()
          })
          .then(response => {
            const deviceSize = _.pick(response, ['height', 'width'])
            let wdaSession = ''
            sub.on('message', wirerouter()
              .on(wire.KeyPressMessage, (channel, message) => {
                wdaClient.homeBtn()
              })
              .on(wire.TouchDownIosMessage, (channel, message) => {
                wdaClient.tap({
                  x: message.x * deviceSize.width,
                  y: message.y * deviceSize.height
                })
              })
              .on(wire.TouchMoveIosMessage, (channel, message) => {
                wdaClient.swipe(message, deviceSize)
              })
              .on(wire.TypeMessage, (channel, message) => {
                wdaClient.typeKey({ value: [iosutil.asciiparser(message.text)] })
              })
              .on(wire.KeyDownMessage, (channel, message) => {
                wdaClient.typeKey({ value: [iosutil.asciiparser(message.key)] })
              })
              .on(wire.BrowserOpenMessage, (channel, message) => {
                wdaClient.openUrl({
                  desiredCapabilities: {
                    bundleId: 'com.apple.mobilesafari',
                    arguments: ['-u', message.url]
                  }
                }).then(response => {
                  log.info('BrowserOpenMesage', response)
                })
                  .catch(err => {
                    log.error('BrowserOpenMessage faile with error', err)
                  })
              })
              .on(wire.RotateMessage, (channel, message) => {
                const rotation = iosutil.degreesToOrientation(message.rotation)
                wdaClient.rotation({ orientation: rotation })
                  .then(result => {
                    push.send([
                      wireutil.global,
                      wireutil.envelope(new wire.RotationEvent(
                        options.serial,
                        message.rotation
                      ))
                    ])
                  })
                  .catch(err => {
                    log.error('Failt to rotate device to : ', rotation)
                  })
              })
              .on(wire.TouchUpMessage, (channel, message) => {
                wdaClient.touchUp()
              })
              .on(wire.ScreenCaptureMessage, (channel, message) => {
                wdaClient.screenshot()
                  .then(response => {
                    let reply = wireutil.reply(options.serial)
                    let args = {
                      url: url.resolve(options.storageUrl, util.format('s/upload/%s', 'image'))
                    }

                    const imageBuffer = new Buffer(response.value, 'base64')

                    let req = request.post(args, function (err, res, body) {
                      try {
                        let result = JSON.parse(body)
                        push.send([
                          channel
                          , reply.okay('success', result.resources.file)
                        ])
                      }
                      catch (err) {
                        log.error('Invalid JSON in response', err.stack, body)
                      }
                    })
                    req.form().append('file', imageBuffer, {
                      filename: util.format('%s.png', options.serial),
                      contentType: 'image/png'
                    })
                  })
                  .catch(err => {
                    log.error('Failed to get screenshot', err)
                  })
              })
              // .on(wire.PasteMessage, function (channel, message) {
              //   log.info('Pasting "%s" to clipboard', message.text)
              //   var reply = wireutil.reply(options.serial)
              //   wdaClient.getPasteboard()(message.text)
              //     .then(function () {
              //       push.send([
              //         channel
              //         , reply.okay()
              //       ])
              //     })
              //     .catch(function (err) {
              //       log.error('Paste failed', err.stack)
              //       push.send([
              //         channel
              //         , reply.fail(err.message)
              //       ])
              //     })
              // })
              .on(wire.CopyMessage, (channel, message) => {
                const reply = wireutil.reply(options.serial)
                wdaClient.getPasteboard()
                  .then(function (content) {
                    push.send([
                      channel
                      , reply.okay(content)
                    ])
                  })
                  .catch(function (err) {
                    log.error('Copy failed', err.stack)
                    push.send([
                      channel
                      , reply.fail(err.message)
                    ])
                  })
              })
              .on(wire.InformationIosDevice, (channel, message) => {
                wdaClient.InformationIosDevice()

              })
              .handler())
          })
          .catch(err => {
            return Promise.reject()
          })
          .finally(() => {
            return Promise.resolve()
          })
      }

      Wda.startStream = () => {
        log.info(`start streaming on port ${streamPort}`)
        return request.get('http://192.168.0.110:8100')
      }

      return Wda
    } catch (e) {
      log.error('Failed to execute wda plugin with exception :', e)
    }

  })
