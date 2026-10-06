import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { wav } from './voice-fixtures.mjs'

describe('wav', () => {
  it('wraps 16-bit mono PCM in a RIFF header Chrome can play as a fake microphone', () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0])
    const file = wav(pcm, 24000)
    assert.equal(file.length, 44 + pcm.length)
    assert.equal(file.toString('ascii', 0, 4), 'RIFF')
    assert.equal(file.readUInt32LE(4), 36 + pcm.length)
    assert.equal(file.toString('ascii', 8, 16), 'WAVEfmt ')
    assert.equal(file.readUInt16LE(20), 1) // PCM
    assert.equal(file.readUInt16LE(22), 1) // mono
    assert.equal(file.readUInt32LE(24), 24000)
    assert.equal(file.readUInt32LE(28), 48000) // bytes per second
    assert.equal(file.readUInt16LE(32), 2) // block align
    assert.equal(file.readUInt16LE(34), 16)
    assert.equal(file.toString('ascii', 36, 40), 'data')
    assert.equal(file.readUInt32LE(40), pcm.length)
    assert.deepEqual(file.subarray(44), pcm)
  })
})
