import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    retentionMs: 24 * 60 * 60 * 1000,
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

const openSocket = async (url = baseUrl) => {
  const socket = new WebSocket(url)
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

const sessionPath = (room) => path.join(tempDir, 'sessions', `${room}.json`)

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for condition.')
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

test('persisted room records contain encrypted state without plaintext session contents', async () => {
  const socket = await openSocket()
  send(socket, {
    type: 'join',
    room: 'encrypted-persist',
    participantId: 'first',
    verifierSalt: 'persist-salt',
    verifierHash: 'persist-proof',
    encryptionSalt: 'persist-enc',
    state: encryptedState('P'),
  })
  assert.equal((await nextMessage(socket)).type, 'state')

  const persisted = await readFile(sessionPath('encrypted-persist'), 'utf8')
  assert.match(persisted, /"ciphertext"/)
  assert.doesNotMatch(persisted, /Client|Counselor|worksheet|sessionNotes|Values Compass/)
  socket.close()
})

test('delete-room removes the encrypted room blob and metadata', async () => {
  const socket = await openSocket()
  send(socket, {
    type: 'join',
    room: 'delete-room',
    participantId: 'first',
    verifierSalt: 'delete-salt',
    verifierHash: 'delete-proof',
    encryptionSalt: 'delete-enc',
    state: encryptedState('X'),
  })
  assert.equal((await nextMessage(socket)).type, 'state')
  await readFile(sessionPath('delete-room'), 'utf8')

  send(socket, { type: 'delete-room', participantId: 'first' })
  assert.equal((await nextMessage(socket)).type, 'room-deleted')
  await assert.rejects(readFile(sessionPath('delete-room'), 'utf8'), { code: 'ENOENT' })
  socket.close()
})

test('delete-room waits for pending writes and prevents room resurrection', async () => {
  const delayedDir = await mkdtemp(path.join(tmpdir(), 'act-delayed-storage-'))
  const writes = []
  const syncWrite = deferred()
  const storage = new Map()
  const created = createCollaborationServer({
    distDir: delayedDir,
    allowFileStorage: true,
    storageAdapter: {
      read: async (room) => storage.get(room) ?? null,
      write: async (room, record) => {
        writes.push(record.state.ciphertext)
        if (writes.length === 2) {
          await syncWrite.promise
        }
        storage.set(room, record)
      },
      delete: async (room) => {
        storage.delete(room)
      },
    },
  })
  await new Promise((resolve) => created.server.listen(0, '127.0.0.1', resolve))
  const address = created.server.address()
  const url = `ws://127.0.0.1:${address.port}/collaboration`
  const socket = await openSocket(url)
  const secondSocket = await openSocket(url)

  try {
    const firstJoin = nextMessageOfType(socket, 'state')
    send(socket, {
      type: 'join',
      room: 'delete-race',
      participantId: 'first',
      verifierSalt: 'delete-race-salt',
      verifierHash: 'delete-race-proof',
      encryptionSalt: 'delete-race-enc',
      state: encryptedState('initial'),
    })
    assert.equal((await firstJoin).type, 'state')
    const secondJoin = nextMessageOfType(secondSocket, 'state')
    send(secondSocket, {
      type: 'join',
      room: 'delete-race',
      participantId: 'second',
      verifierHash: 'delete-race-proof',
    })
    assert.equal((await secondJoin).type, 'state')

    const secondReceivesSync = nextMessageOfType(secondSocket, 'state')
    send(socket, {
      type: 'sync',
      participantId: 'first',
      state: encryptedState('pending'),
    })
    assert.equal((await secondReceivesSync).state.ciphertext, encryptedState('pending').ciphertext)
    await waitFor(() => writes.length === 2)
    send(socket, { type: 'delete-room', participantId: 'first' })
    await waitFor(() => created.deletingRooms.has('delete-race'))
    assert.ok(storage.has('delete-race'))
    const rejectedSyncMessage = nextMessageOfType(secondSocket, 'error')
    send(secondSocket, {
      type: 'sync',
      participantId: 'second',
      state: encryptedState('after-delete-started'),
    })
    const rejectedSync = await rejectedSyncMessage
    assert.equal(rejectedSync.code, 'bad-state')

    const firstDeleted = nextMessageOfType(socket, 'room-deleted')
    const secondDeleted = nextMessageOfType(secondSocket, 'room-deleted')
    syncWrite.resolve()
    assert.equal((await firstDeleted).type, 'room-deleted')
    assert.equal((await secondDeleted).type, 'room-deleted')
    assert.equal(storage.has('delete-race'), false)
    assert.deepEqual(writes, [encryptedState('initial').ciphertext, encryptedState('pending').ciphertext])
  } finally {
    socket.close()
    secondSocket.close()
    await new Promise((resolve) => created.server.close(resolve))
    await rm(delayedDir, { recursive: true, force: true })
  }
})

test('expired room records are deleted according to retention settings', async () => {
  const room = 'expired-room'
  await mkdir(path.join(tempDir, 'sessions'), { recursive: true })
  await writeFile(
    sessionPath(room),
    JSON.stringify({
      version: 2,
      verifierSalt: 'expired-salt',
      verifierHash: 'expired-proof',
      encryptionSalt: 'expired-enc',
      updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      state: encryptedState('E'),
    }),
  )

  const socket = await openSocket()
  try {
    send(socket, { type: 'room-info', room })
    const message = await nextMessage(socket)
    assert.equal(message.type, 'room-info')
    assert.equal(message.exists, false)
    await assert.rejects(readFile(sessionPath(room), 'utf8'), { code: 'ENOENT' })
  } finally {
    socket.close()
  }
})

test('legacy plaintext room records are removed instead of loaded', async () => {
  const room = 'legacy-plaintext'
  await mkdir(path.join(tempDir, 'sessions'), { recursive: true })
  await writeFile(
    sessionPath(room),
    JSON.stringify({
      clientName: 'Client',
      counselorName: 'Counselor',
      sessionNotes: 'Readable worksheet content',
    }),
  )

  const socket = await openSocket()
  try {
    send(socket, { type: 'room-info', room })
    const message = await nextMessage(socket)
    assert.equal(message.type, 'room-info')
    assert.equal(message.exists, false)
    await assert.rejects(readFile(sessionPath(room), 'utf8'), { code: 'ENOENT' })
  } finally {
    socket.close()
  }
})

test('disabled file storage does not write local session files', async () => {
  const noFileDir = await mkdtemp(path.join(tmpdir(), 'act-no-file-'))
  const created = createCollaborationServer({
    distDir: noFileDir,
    sessionDir: path.join(noFileDir, 'sessions'),
    allowFileStorage: false,
  })
  await new Promise((resolve) => created.server.listen(0, '127.0.0.1', resolve))
  const address = created.server.address()
  const socket = await openSocket(`ws://127.0.0.1:${address.port}/collaboration`)

  send(socket, {
    type: 'join',
    room: 'memory-only',
    participantId: 'first',
    verifierSalt: 'memory-salt',
    verifierHash: 'memory-proof',
    encryptionSalt: 'memory-enc',
    state: encryptedState('M'),
  })
  assert.equal((await nextMessage(socket)).type, 'state')
  await assert.rejects(
    readFile(path.join(noFileDir, 'sessions', 'memory-only.json'), 'utf8'),
    { code: 'ENOENT' },
  )

  socket.close()
  await new Promise((resolve) => created.server.close(resolve))
  await rm(noFileDir, { recursive: true, force: true })
})
