import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import WebSocket from 'ws'
import { createCollaborationServer } from './server.mjs'

const encryptedState = (label) => ({
  version: 1,
  algorithm: 'AES-GCM',
  kdf: 'PBKDF2-SHA-256',
  iterations: 210000,
  salt: 'ZW5jcnlwdGlvbi1zYWx0',
  iv: `aXYt${label}`,
  ciphertext: `Y2lwaGVydGV4dC0${label}`,
})

let tempDir
let server
let baseUrl

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'act-collab-'))
  const created = createCollaborationServer({
    distDir: tempDir,
    sessionDir: path.join(tempDir, 'sessions'),
  })
  server = created.server
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `ws://127.0.0.1:${address.port}/collaboration`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(tempDir, { recursive: true, force: true })
})

const openSocket = async () => {
  const socket = new WebSocket(baseUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

const nextMessage = (socket) =>
  new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(raw.toString())))
  })

const nextMessageOfType = async (socket, type) => {
  while (true) {
    const message = await nextMessage(socket)
    if (message.type === type) return message
  }
}

const send = (socket, payload) => {
  socket.send(JSON.stringify(payload))
}

test('missing passphrase proof cannot join a room', async () => {
  const socket = await openSocket()
  send(socket, { type: 'join', room: 'missing-proof', participantId: 'p1' })
  const message = await nextMessage(socket)
  assert.equal(message.type, 'error')
  assert.equal(message.code, 'unauthorized')
  socket.close()
})

test('incorrect passphrase proof cannot join or receive state', async () => {
  const creator = await openSocket()
  send(creator, {
    type: 'join',
    room: 'wrong-proof',
    participantId: 'creator',
    verifierSalt: 'salt-1',
    verifierHash: 'correct-proof',
    encryptionSalt: 'enc-salt-1',
    state: encryptedState('A'),
  })
  assert.equal((await nextMessage(creator)).type, 'state')

  const intruder = await openSocket()
  send(intruder, {
    type: 'join',
    room: 'wrong-proof',
    participantId: 'intruder',
    verifierHash: 'wrong-proof',
  })
  const message = await nextMessage(intruder)
  assert.equal(message.type, 'error')
  assert.equal(message.code, 'unauthorized')

  creator.close()
  intruder.close()
})

test('concurrent first joins cannot overwrite the created room verifier', async () => {
  const first = await openSocket()
  const second = await openSocket()

  send(first, {
    type: 'join',
    room: 'creation-race',
    participantId: 'first',
    verifierSalt: 'race-salt-a',
    verifierHash: 'race-proof-a',
    encryptionSalt: 'race-enc-a',
    state: encryptedState('R'),
  })
  send(second, {
    type: 'join',
    room: 'creation-race',
    participantId: 'second',
    verifierSalt: 'race-salt-b',
    verifierHash: 'race-proof-b',
    encryptionSalt: 'race-enc-b',
    state: encryptedState('S'),
  })

  const messages = await Promise.all([nextMessage(first), nextMessage(second)])
  assert.equal(messages.filter((message) => message.type === 'state').length, 1)
  assert.equal(messages.filter((message) => message.code === 'unauthorized').length, 1)

  first.close()
  second.close()
})

test('unauthorized socket cannot sync room ciphertext', async () => {
  const socket = await openSocket()
  send(socket, {
    type: 'sync',
    participantId: 'intruder',
    state: encryptedState('B'),
  })
  const message = await nextMessage(socket)
  assert.equal(message.type, 'error')
  assert.equal(message.code, 'unauthorized')
  socket.close()
})

test('authorized sync broadcasts only encrypted room state', async () => {
  const first = await openSocket()
  const second = await openSocket()

  send(first, {
    type: 'join',
    room: 'authorized-sync',
    participantId: 'first',
    verifierSalt: 'salt-2',
    verifierHash: 'shared-proof',
    encryptionSalt: 'enc-salt-2',
    state: encryptedState('C'),
  })
  assert.equal((await nextMessage(first)).type, 'state')

  send(second, {
    type: 'join',
    room: 'authorized-sync',
    participantId: 'second',
    verifierHash: 'shared-proof',
  })
  const joined = await nextMessageOfType(second, 'state')
  assert.equal(joined.type, 'state')
  assert.equal(joined.state.ciphertext, encryptedState('C').ciphertext)

  send(first, {
    type: 'sync',
    participantId: 'first',
    state: encryptedState('D'),
  })
  const broadcast = await nextMessageOfType(second, 'state')
  assert.equal(broadcast.type, 'state')
  assert.equal(broadcast.state.ciphertext, encryptedState('D').ciphertext)
  assert.equal('clientName' in broadcast.state, false)

  first.close()
  second.close()
})
