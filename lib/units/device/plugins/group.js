var events = require('events')

var Promise = require('bluebird')
var syrup = require('@devicefarmer/stf-syrup')

var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var grouputil = require('../../../util/grouputil')
var lifecycle = require('../../../util/lifecycle')

module.exports = syrup.serial()
  .dependency(require('./solo'))
  .dependency(require('./util/identity'))
  .dependency(require('./service'))
  .dependency(require('../support/router'))
  .dependency(require('../support/push'))
  .dependency(require('../support/sub'))
  .dependency(require('../support/channels'))
  .define(function(options, solo, ident, service, router, push, sub, channels) {
    var log = logger.createLogger('device:plugins:group')
    var currentGroup = null
    var plugin = new events.EventEmitter()

    log.info('MIRACLE group.js')

    plugin.get = Promise.method(function() {
      log.info('MIRACLE plugin.get: start')
      if (!currentGroup) {
        log.info('MIRACLE plugin.get: throw new grouputil.NoGroupError()')
        throw new grouputil.NoGroupError()
      }
      log.info('MIRACLE plugin.get: return currentGroup: ' + currentGroup.group)
      return currentGroup
    })

    plugin.join = function(newGroup, timeout, usage) {
      return plugin.get()
        .then(function() {
          log.info('MIRACLE plugin.join: currentGroup.group: ' + currentGroup.group)
          if (currentGroup.group !== newGroup.group) {
            log.info('MIRACLE plugin.join: throw new grouputil.AlreadyGroupedError()')
            throw new grouputil.AlreadyGroupedError()
          }
          log.info('MIRACLE plugin.join: currentGroup.group: ' + currentGroup.group)
          return currentGroup
        })
        .catch(grouputil.NoGroupError, function() {
          log.info('MIRACLE plugin.join catch: newGroup: ' + newGroup)
          currentGroup = newGroup

          log.important('Now owned by "%s"', currentGroup.email)
          log.info('Subscribing to group channel "%s"', currentGroup.group)

          channels.register(currentGroup.group, {
            timeout: timeout || options.groupTimeout
          , alias: solo.channel
          })

          sub.subscribe(currentGroup.group)

          push.send([
            wireutil.global
          , wireutil.envelope(new wire.JoinGroupMessage(
              options.serial
            , currentGroup
            , usage
            ))
          ])

          plugin.emit('join', currentGroup)

          return currentGroup
        })
    }

    plugin.keepalive = function() {
      log.info('MIRACLE plugin.keepalive: currentGroup.group: ' + currentGroup.group)
      if (currentGroup) {
        log.info('MIRACLE plugin.keepalive: channels.keepalive')
        channels.keepalive(currentGroup.group)
      }
    }

    plugin.leave = function(reason) {
      log.info('MIRACLE plugin.leave reason: ' + reason)
      return plugin.get()
        .then(function(group) {
          log.important('No longer owned by "%s"', group.email)
          log.info('Unsubscribing from group channel "%s"', group.group)

          channels.unregister(group.group)
          sub.unsubscribe(group.group)

          push.send([
            wireutil.global
          , wireutil.envelope(new wire.LeaveGroupMessage(
              options.serial
            , group
            , reason
            ))
          ])

          currentGroup = null
          plugin.emit('leave', group)

          return group
        })
    }

    plugin.on('join', function() {
      log.info('MIRACLE plugin.on: join')
      service.wake()
      service.acquireWakeLock()
    })

    plugin.on('leave', function() {
      log.info('MIRACLE plugin.on: leave')
      if (options.screenReset) {
       log.info('MIRACLE plugin.on: press home key')
        service.pressKey('home')
        service.thawRotation()
      }
      service.releaseWakeLock()
    })

    router
      .on(wire.GroupMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        grouputil.match(ident, message.requirements)
          .then(function() {
            return plugin.join(message.owner, message.timeout, message.usage)
          })
          .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
          })
          .catch(grouputil.RequirementMismatchError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
          .catch(grouputil.AlreadyGroupedError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })
      .on(wire.AutoGroupMessage, function(channel, message) {
        return plugin.join(message.owner, message.timeout, message.identifier)
          .then(function() {
            plugin.emit('autojoin', message.identifier, true)
          })
          .catch(grouputil.AlreadyGroupedError, function() {
            plugin.emit('autojoin', message.identifier, false)
          })
      })
      .on(wire.UngroupMessage, function(channel, message) {
        var reply = wireutil.reply(options.serial)
        grouputil.match(ident, message.requirements)
          .then(function() {
            return plugin.leave('ungroup_request')
          })
          .then(function() {
            push.send([
              channel
            , reply.okay()
            ])
          })
          .catch(grouputil.NoGroupError, function(err) {
            push.send([
              channel
            , reply.fail(err.message)
            ])
          })
      })

    channels.on('timeout', function(channel) {
      if (currentGroup && channel === currentGroup.group) {
        plugin.leave('automatic_timeout')
      }
    })

    lifecycle.observe(function() {
      return plugin.leave('device_absent')
        .catch(grouputil.NoGroupError, function() {
          return true
        })
    })

    return plugin
  })
