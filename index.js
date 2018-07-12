'use strict'

/**
 * Keep your Lambda functions warm
 * @author Jeremy Daly <jeremy@jeremydaly.com>
 * @version 0.1.0
 * @license MIT
 */

const AWS = require('aws-sdk')
const Promise = require('bluebird')

const id = Date.now().toString() + '-' + Math.floor(Math.random()*1000).toString().padStart(4,'0')

let warm = false
let lastAccess = null

const funcName = process.env.AWS_LAMBDA_FUNCTION_NAME

module.exports = (event,cfg = {}) => {

  let config = Object.assign({}, {
    flag: 'warmer', // default test flag
    concurrency: 'concurrency', // default concurrency field
    test: 'test', // default test flag
    log: true, // default logging to true
    correlationId: id, // default the correlationId
    delay: 75 // default the delay to 75ms
  },cfg)

  // If the event is a warmer ping
  if (event && event[config.flag]) {

    let concurrency = event[config.concurrency]
      && !isNaN(event[config.concurrency])
      && event[config.concurrency] > 1
       ? event[config.concurrency] : 1

    let invokeCount = event['__WARMER_INVOCATION__']
      && !isNaN(event['__WARMER_INVOCATION__'])
        ? event['__WARMER_INVOCATION__'] : 1

    let invokeTotal = event['__WARMER_CONCURRENCY__']
      && !isNaN(event['__WARMER_CONCURRENCY__'])
        ? event['__WARMER_CONCURRENCY__'] : concurrency

    let correlationId = event['__WARMER_CORRELATIONID__']
        ? event['__WARMER_CORRELATIONID__'] : config.correlationId

    // Create log record
    let log = {
      action: "warmer",
      function: funcName,
      id,
      correlationId,
      count: invokeCount,
      concurrency: invokeTotal,
      warm,
      lastAccessed: lastAccess,
      lastAccessedSeconds: lastAccess === null ? null : ((Date.now()-lastAccess)/1000).toFixed(1)
    }

    // Log it
    config.log && console.log(log)

    // flag as warm
    warm = true

    // Fan out if concurrency is set higher than 1
    if (concurrency > 1 && !event[config.test]) {

      // init Lambda sdk
      let lambda = new AWS.Lambda()

      // init promise array
      let invocations = []

      // loop through concurrency count
      for (let i=2; i <= concurrency; i++) {

        // Set the params and wait for the final function to finish
        let params = {
          FunctionName: funcName,
          InvocationType: i === concurrency ? 'RequestResponse' : 'Event',
          LogType: 'None',
          Payload: new Buffer(JSON.stringify({
            [config.flag]: true, // send warmer flag
            '__WARMER_INVOCATION__': i, // send invocation number
            '__WARMER_CONCURRENCY__': concurrency, // send total concurrency
            '__WARMER_CORRELATIONID__': correlationId // send correlation id
          }))
        }

        // Add promise to invocations array
        invocations.push(lambda.invoke(params).promise())

      } // end for

      // Attempt to connect to
      return Promise.all(invocations)
        .then(() => true)
        .catch((e) => { throw new Error(e) })

    } else if (invokeCount > 1) {
      return Promise.delay(config.delay).then(() => true)
    }

    return Promise.resolve(true)
  } else {
    warm = true
    lastAccess = Date.now()
    return Promise.resolve(false)
  }

} // end module