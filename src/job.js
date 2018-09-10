const v8 = require('v8')

const workerPool = require('./worker-pool')

const MISSING_HANDLER_ERROR = `job needs a function.\nTry with:\n> job(() => {...}, config)`
const WRONG_CONTEXT_ERROR = `job needs an object as ctx.\nTry with:\n> job(() => {...}, {ctx: {...}})`

workerPool.on('tick', ({work, worker}) => {
  const { handler, config, resolve, reject } = work

  try {
    let variables = ''
    for (const key in config.ctx) {
      if (!config.ctx.hasOwnProperty(key)) continue

      let variable
      switch (typeof config.ctx[key]) {
        case 'string':
          variable = `'${config.ctx[key]}'`
          break
        case 'object':
          variable = JSON.stringify(config.ctx[key])
          break
        default:
          variable = config.ctx[key]
      }
      variables += `let ${key} = ${variable}\n`
    }

    const dataStr = JSON.stringify(config.data)
    const workerStr = `
    async function __executor__() {
      ${variables}
      return await (${handler.toString()})(JSON.parse('${dataStr}'))
    }
    `

    // serialization precheck, due to this issue: https://github.com/nodejs/node/issues/22736
    v8.serialize(config.data)

    worker.once('message', message => {
      if (message.error) {
        const error = new Error(message.error.message)
        error.stack = message.error.stack
        workerPool.free(worker)
        reject(error)
      } else {
        workerPool.free(worker)
        resolve(message.data)
      }
    })

    worker.once('error', error => {
      workerPool.free(worker)
      reject(error)
    })

    worker.postMessage(workerStr)
  } catch (err) {
    workerPool.free(worker)
    reject(err)
  }
})

function job(handler, config = { ctx: {}, data: {} }) {
  return new Promise((resolve, reject) => {
    if (typeof handler !== 'function') return reject(new Error(MISSING_HANDLER_ERROR))

    config.ctx = config.ctx || {}
    config.data = config.data || {}

    if (typeof config.ctx !== 'object') return reject(new Error(WRONG_CONTEXT_ERROR))

    workerPool.enqueue({ handler, config, resolve, reject })
  })
}

function stop() {
  workerPool.teardown()
}

module.exports = { job, stop }
