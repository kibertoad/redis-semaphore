import createDebug from 'debug'
import * as crypto from 'node:crypto'

import LostLockError from './errors/LostLockError'
import TimeoutError from './errors/TimeoutError'
import { defaultOnLockLost, defaultTimeoutOptions } from './misc'
import { AcquireOptions, LockLostCallback, LockOptions } from './types'

const REFRESH_INTERVAL_COEF = 0.8

const debug = createDebug('redis-semaphore:instance')

export abstract class Lock {
  protected abstract _kind: string
  protected abstract _key: string
  protected _identifier: string
  protected _acquireOptions: AcquireOptions
  protected _refreshTimeInterval: number
  protected _refreshInterval?: ReturnType<typeof setInterval>
  protected _refreshing = false
  protected _acquired = false
  protected _acquiredExternally = false
  protected _onLockLost: LockLostCallback

  protected abstract _refresh(): Promise<boolean>
  protected abstract _update(newTimeout: number): Promise<boolean>
  protected abstract _acquire(): Promise<boolean>
  protected abstract _release(): Promise<void>

  constructor({
    lockTimeout = defaultTimeoutOptions.lockTimeout,
    acquireTimeout = defaultTimeoutOptions.acquireTimeout,
    acquireAttemptsLimit = defaultTimeoutOptions.acquireAttemptsLimit,
    retryInterval = defaultTimeoutOptions.retryInterval,
    refreshInterval = Math.round(lockTimeout * REFRESH_INTERVAL_COEF),
    onLockLost = defaultOnLockLost,
    externallyAcquiredIdentifier
  }: LockOptions = defaultTimeoutOptions) {
    this._identifier = externallyAcquiredIdentifier || crypto.randomUUID()
    this._acquiredExternally = !!externallyAcquiredIdentifier
    this._acquireOptions = {
      lockTimeout,
      acquireTimeout,
      acquireAttemptsLimit,
      retryInterval,
      identifier: this._identifier
    }
    this._refreshTimeInterval = refreshInterval
    this._processRefresh = this._processRefresh.bind(this)
    this._onLockLost = onLockLost
  }

  get identifier() {
    return this._identifier
  }

  get isAcquired() {
    return this._acquired
  }

  private _startRefresh() {
    this._refreshInterval = setInterval(
      this._processRefresh,
      this._refreshTimeInterval
    )
    this._refreshInterval.unref()
  }

  stopRefresh() {
    if (this._refreshInterval) {
      debug(
        `clear refresh interval ${this._kind} (key: ${this._key}, identifier: ${this._identifier})`
      )
      clearInterval(this._refreshInterval)
    }
  }

  private async _processRefresh() {
    if (this._refreshing) {
      debug(
        `already refreshing ${this._kind} (key: ${this._key}, identifier: ${this._identifier}) (skip)`
      )
      return
    }
    this._refreshing = true
    try {
      debug(
        `refresh ${this._kind} (key: ${this._key}, identifier: ${this._identifier})`
      )
      const refreshed = await this._refresh()
      if (!refreshed) {
        this._acquired = false
        this.stopRefresh()
        const lockLostError = new LostLockError(
          `Lost ${this._kind} for key ${this._key}`
        )
        this._onLockLost(lockLostError)
      }
    } finally {
      this._refreshing = false
    }
  }

  async acquire() {
    debug(`acquire ${this._kind} (key: ${this._key})`)
    const acquired = await this.tryAcquire()
    if (!acquired) {
      throw new TimeoutError(`Acquire ${this._kind} ${this._key} timeout`)
    }
  }

  async update(newTimeout: number) {
    debug(`update ${this._kind} (key: ${this._key})`)
    const updated = await this._update(newTimeout)
    if (!updated) {
      this._acquired = false
      this.stopRefresh()
      const lockLostError = new LostLockError(
        `Lost ${this._kind} for key ${this._key}`
      )
      this._onLockLost(lockLostError)
    }
  }

  async tryAcquire() {
    debug(`tryAcquire ${this._kind} (key: ${this._key})`)
    const acquired = this._acquiredExternally
      ? await this._refresh()
      : await this._acquire()
    if (!acquired) {
      return false
    }
    this._acquired = true
    this._acquiredExternally = false
    if (this._refreshTimeInterval > 0) {
      this._startRefresh()
    }
    return true
  }

  async release() {
    debug(
      `release ${this._kind} (key: ${this._key}, identifier: ${this._identifier})`
    )
    if (this._refreshTimeInterval > 0) {
      this.stopRefresh()
    }
    if (this._acquired || this._acquiredExternally) {
      await this._release()
    }
    this._acquired = false
    this._acquiredExternally = false
  }
}
