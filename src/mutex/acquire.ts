import createDebug from 'debug'
import Redis from 'ioredis'

import { delay } from '../utils/index'

const debug = createDebug('redis-semaphore:mutex:acquire')

export interface Options {
  identifier: string
  lockTimeout: number
  acquireTimeout: number
  retryInterval: number
}

export async function acquireMutex(
  client: Redis,
  key: string,
  options: Options
) {
  const { identifier, lockTimeout, acquireTimeout, retryInterval } = options
  const end = Date.now() + acquireTimeout
  while (Date.now() < end) {
    debug(key, identifier, 'attempt')
    const result = await client.set(key, identifier, 'PX', lockTimeout, 'NX')
    debug('result', typeof result, result)
    if (result === 'OK') {
      debug(key, identifier, 'acquired')
      return true
    } else {
      await delay(retryInterval)
    }
  }
  debug(key, identifier, 'timeout')
  return false
}

export async function acquireMutexOnce(
  client: Redis,
  key: string,
  options: Options
) {
  const { identifier, lockTimeout } = options
    debug(key, identifier, 'attempt')
    const result = await client.set(key, identifier, 'PX', lockTimeout, 'NX')
    debug('result', typeof result, result)
    if (result === 'OK') {
      debug(key, identifier, 'acquired')
      return true
    }
  debug(key, identifier, 'timeout')
  return false
}
