import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dayMs = 24 * 60 * 60 * 1000
const expectedKdfIterations = 210000
const maxWebSocketPayloadBytes = 1024 * 1024
const maxCiphertextBytes = 512 * 1024
const maxRoomIdLength = 80
const maxParticipantIdLength = 80
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/

const isPlainObject = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const isBoundedString = (value, maxLength, pattern = null) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  (!pattern || pattern.test(value))

const isBase64Bytes = (value, expectedLength = null, maxLength = null) => {
  const encodedLimit =
    expectedLength !== null
      ? Math.ceil(expectedLength / 3) * 4
      : maxLength !== null
        ? Math.ceil(maxLength / 3) * 4
        : 1024
  if (!isBoundedString(value, encodedLimit, base64Pattern)) return false
  try {
    const decoded = Buffer.from(value, 'base64')
    return (
      decoded.length > 0 &&
      Buffer.from(decoded).toString('base64') === value &&
      (expectedLength === null || decoded.length === expectedLength) &&
      (maxLength === null || decoded.length <= maxLength)
    )
  } catch {
    return false
  }
}

export const safeRoomId = (roomId) => String(roomId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, maxRoomIdLength)
export const isEncryptedState = (state) =>
  Boolean(
    isPlainObject(state) &&
      state.version === 1 &&
      state.algorithm === 'AES-GCM' &&
      state.kdf === 'PBKDF2-SHA-256' &&
      state.iterations === expectedKdfIterations &&
      isBase64Bytes(state.salt, 16) &&
      isBase64Bytes(state.iv, 12) &&
      isBase64Bytes(state.ciphertext, null, maxCiphertextBytes),
  )

const isRoomId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxRoomIdLength &&
  safeRoomId(value) === value

const isParticipantId = (value) =>
  isBoundedString(value, maxParticipantIdLength, /^[a-zA-Z0-9_-]+$/)

const isRole = (value) => value === 'client' || value === 'counselor'
const isVerifier = (value) => isBase64Bytes(value, 32)
const isSalt = (value) => isBase64Bytes(value, 16)

const isFollowEvent = (event) => {
  if (!isPlainObject(event)) return false
  if (event.kind === 'worksheet') {
    return isBoundedString(event.worksheetId, 80, /^[a-zA-Z0-9_-]+$/)
  }
  if (event.kind === 'field') {
    return (
      isBoundedString(event.worksheetId, 80, /^[a-zA-Z0-9_-]+$/) &&
      isBoundedString(event.fieldId, 80, /^[a-zA-Z0-9_-]+$/)
    )
  }
  if (event.kind === 'scroll') {
    return typeof event.y === 'number' && Number.isFinite(event.y) && event.y >= 0 && event.y <= 200000
  }
  return false
}

const isRoomRecord = (record) =>
  Boolean(
    record &&
      typeof record === 'object' &&
      record.version === 2 &&
      typeof record.verifierSalt === 'string' &&
      typeof record.verifierHash === 'string' &&
      typeof record.encryptionSalt === 'string' &&
      (typeof record.updatedAt === 'string' || typeof record.updatedAt === 'undefined') &&
      (record.state === null || isEncryptedState(record.state)),
  )

const getRetentionMs = () => {
  const days = Number(process.env.ACT_SESSION_RETENTION_DAYS ?? 30)
  return Number.isFinite(days) && days > 0 ? days * dayMs : null
}

const send = (client, payload) => {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify(payload))
  }
}

export const createCollaborationServer = ({
  distDir = path.join(__dirname, 'dist'),
  sessionDir = path.join(__dirname, 'data', 'sessions'),
  allowFileStorage = process.env.NODE_ENV !== 'production' ||
    process.env.ACT_ENABLE_DEMO_FILE_STORAGE === 'true',
  retentionMs = getRetentionMs(),
  storageAdapter = null,
  maxPayloadBytes = maxWebSocketPayloadBytes,
  rateLimits = {
    'room-info': { limit: 20, windowMs: 60_000 },
    sync: { limit: 30, windowMs: 10_000 },
    follow: { limit: 60, windowMs: 10_000 },
    'follow-control': { limit: 20, windowMs: 10_000 },
  },
} = {}) => {
  const app = express()
  const server = createServer(app)
  const rooms = new Map()
  const roomCreationLocks = new Map()
  const roomStorageQueue = new Map()
  const deletedRooms = new Set()

  const getSessionPath = (roomId) => path.join(sessionDir, `${safeRoomId(roomId)}.json`)

  const isExpired = (record) =>
    Boolean(
      retentionMs &&
        typeof record.updatedAt === 'string' &&
        Date.now() - new Date(record.updatedAt).getTime() > retentionMs,
    )

  const deletePersistedRoom = async (roomId) => {
    if (!allowFileStorage) return
    if (storageAdapter?.delete) {
      await storageAdapter.delete(roomId)
      return
    }
    try {
      await unlink(getSessionPath(roomId))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  const loadPersistedRoom = async (roomId) => {
    if (!allowFileStorage) return null
    try {
      const record = storageAdapter?.read
        ? await storageAdapter.read(roomId)
        : JSON.parse(await readFile(getSessionPath(roomId), 'utf8'))
      if (!isRoomRecord(record)) {
        await deletePersistedRoom(roomId)
        return null
      }
      if (isExpired(record)) {
        await deletePersistedRoom(roomId)
        return null
      }
      return record
    } catch {
      return null
    }
  }

  const persistRoom = async (roomId, room) => {
    if (!allowFileStorage) return
    if (deletedRooms.has(roomId)) return
    const record = {
      version: 2,
      verifierSalt: room.verifierSalt,
      verifierHash: room.verifierHash,
      encryptionSalt: room.encryptionSalt,
      updatedAt: room.updatedAt,
      state: room.state,
    }
    if (storageAdapter?.write) {
      await storageAdapter.write(roomId, record)
      return
    }
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      getSessionPath(roomId),
      JSON.stringify(record, null, 2),
    )
  }

  const queueStorageOperation = (roomId, operation) => {
    const previous = roomStorageQueue.get(roomId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    roomStorageQueue.set(
      roomId,
      next.finally(() => {
        if (roomStorageQueue.get(roomId) === next) {
          roomStorageQueue.delete(roomId)
        }
      }),
    )
    return next
  }

  const queuePersistRoom = (roomId, room) =>
    queueStorageOperation(roomId, async () => {
      await persistRoom(roomId, room)
    })

  const queueDeleteRoom = (roomId) =>
    queueStorageOperation(roomId, async () => {
      await deletePersistedRoom(roomId)
    })

  const getRoom = async (roomId) => {
    if (!rooms.has(roomId)) {
      const persisted = await loadPersistedRoom(roomId)
      if (!persisted) return null
      rooms.set(roomId, {
        ...persisted,
        clients: new Set(),
        followerId: null,
      })
    }
    return rooms.get(roomId)
  }

  const createRoom = async (roomId, message) => {
    deletedRooms.delete(roomId)
    const room = {
      version: 2,
      verifierSalt: message.verifierSalt,
      verifierHash: message.verifierHash,
      encryptionSalt: message.encryptionSalt,
      updatedAt: new Date().toISOString(),
      state: isEncryptedState(message.state) ? message.state : null,
      clients: new Set(),
      followerId: null,
    }
    rooms.set(roomId, room)
    await queuePersistRoom(roomId, room)
    return room
  }

  const createRoomOnce = async (roomId, message) => {
    const existingRoom = await getRoom(roomId)
    if (existingRoom) return existingRoom

    const existingLock = roomCreationLocks.get(roomId)
    if (existingLock) {
      await existingLock
      return getRoom(roomId)
    }

    const creation = createRoom(roomId, message).finally(() => {
      roomCreationLocks.delete(roomId)
    })
    roomCreationLocks.set(roomId, creation)
    return creation
  }

  const broadcastPresence = (room) => {
    const payload = {
      type: 'presence',
      participantCount: room.clients.size,
      followerId: room.followerId,
    }
    room.clients.forEach((client) => send(client, payload))
  }

  app.use(express.static(distDir))
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })

  const wss = new WebSocketServer({ server, path: '/collaboration', maxPayload: maxPayloadBytes })

  wss.on('connection', (socket) => {
    let currentRoomId = null
    let currentParticipantId = null
    let currentRole = null
    const rateBuckets = new Map()

    const reject = (code, reason) => {
      send(socket, { type: 'error', code, reason })
    }

    const isRateLimited = (type) => {
      const config = rateLimits[type]
      if (!config) return false
      const now = Date.now()
      const bucket = rateBuckets.get(type)
      if (!bucket || now - bucket.startedAt >= config.windowMs) {
        rateBuckets.set(type, { startedAt: now, count: 1 })
        return false
      }
      bucket.count += 1
      return bucket.count > config.limit
    }

    socket.on('message', async (raw) => {
      if (raw.length > maxPayloadBytes) {
        reject('payload-too-large', 'Message payload is too large.')
        socket.close(1009, 'Message payload is too large.')
        return
      }
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        reject('bad-message', 'Message was not valid JSON.')
        return
      }
      if (!isPlainObject(message) || typeof message.type !== 'string') {
        reject('bad-message', 'Message shape is invalid.')
        return
      }
      if (isRateLimited(message.type)) {
        reject('rate-limited', 'Too many messages; slow down.')
        return
      }

      if (message.type === 'room-info') {
        if (!isRoomId(message.room)) {
          reject('bad-room', 'Room id is required.')
          return
        }
        const roomId = message.room
        const room = await getRoom(roomId)
        send(socket, {
          type: 'room-info',
          room: roomId,
          exists: Boolean(room),
          verifierSalt: room?.verifierSalt ?? null,
          encryptionSalt: room?.encryptionSalt ?? null,
        })
        return
      }

      if (message.type === 'join') {
        if (
          !isRoomId(message.room) ||
          !isParticipantId(message.participantId) ||
          !isRole(message.role) ||
          !isVerifier(message.verifierHash)
        ) {
          reject('unauthorized', 'A room passphrase proof is required.')
          return
        }
        const roomId = message.room

        let room = await getRoom(roomId)
        if (!room) {
          if (
            !isSalt(message.verifierSalt) ||
            !isSalt(message.encryptionSalt) ||
            !isEncryptedState(message.state)
          ) {
            reject('unauthorized', 'New rooms require a passphrase proof and encrypted state.')
            return
          }
          room = await createRoomOnce(roomId, message)
          if (!room) {
            reject('unauthorized', 'The room could not be created.')
            return
          }
        }

        if (room.verifierHash !== message.verifierHash) {
          reject('unauthorized', 'The room passphrase was rejected.')
          return
        }

        currentRoomId = roomId
        currentParticipantId = message.participantId
        currentRole = message.role
        room.clients.add(socket)
        send(socket, {
          type: 'state',
          state: room.state,
          participantCount: room.clients.size,
          followerId: room.followerId,
        })
        broadcastPresence(room)
        return
      }

      if (!['follow-control', 'sync', 'delete-room', 'follow'].includes(message.type)) {
        reject('unknown-message', 'Message type is not supported.')
        return
      }

      if (!currentRoomId) {
        reject('unauthorized', 'Join the room before sending collaboration messages.')
        return
      }

      if (message.type === 'follow-control') {
        const room = rooms.get(currentRoomId)
        if (!room) return
        if (typeof message.enabled !== 'boolean') {
          reject('bad-message', 'Follow control payload is invalid.')
          return
        }

        if (message.enabled) {
          if (room.followerId && room.followerId !== currentParticipantId) {
            send(socket, {
              type: 'follow-state',
              accepted: false,
              followerId: room.followerId,
            })
            return
          }
          room.followerId = currentParticipantId
        } else if (room.followerId === currentParticipantId) {
          room.followerId = null
        }

        room.clients.forEach((client) => {
          send(client, {
            type: 'follow-state',
            accepted: true,
            followerId: room.followerId,
          })
        })
        broadcastPresence(room)
        return
      }

      if (message.type === 'sync') {
        const room = rooms.get(currentRoomId)
        if (!room || deletedRooms.has(currentRoomId) || !isEncryptedState(message.state)) {
          reject('bad-state', 'Only encrypted room state can be synced.')
          return
        }

        room.state = message.state
        room.updatedAt = new Date().toISOString()
        queuePersistRoom(currentRoomId, { ...room }).catch((error) => {
          console.error(`Failed to save room ${currentRoomId}:`, error)
        })
        room.clients.forEach((client) => {
          if (client !== socket) {
            send(client, {
              type: 'state',
              state: room.state,
              participantCount: room.clients.size,
              followerId: room.followerId,
            })
          }
        })
        return
      }

      if (message.type === 'delete-room') {
        const room = rooms.get(currentRoomId)
        if (!room) return
        deletedRooms.add(currentRoomId)
        await queueDeleteRoom(currentRoomId)
        rooms.delete(currentRoomId)
        room.clients.forEach((client) => {
          send(client, { type: 'room-deleted' })
          client.close(1000, 'Room deleted')
        })
        return
      }

      if (message.type === 'follow') {
        const room = rooms.get(currentRoomId)
        if (!room) return
        if (!isFollowEvent(message.event)) {
          reject('bad-message', 'Follow event payload is invalid.')
          return
        }
        const followMessage = {
          type: 'follow',
          event: message.event,
          participantId: currentParticipantId,
          role: currentRole,
        }
        room.clients.forEach((client) => {
          if (client !== socket) {
            send(client, followMessage)
          }
        })
        return
      }

    })

    socket.on('close', () => {
      if (!currentRoomId) return
      const room = rooms.get(currentRoomId)
      if (!room) return
      room.clients.delete(socket)
      if (room.followerId === currentParticipantId) {
        room.followerId = null
      }
      if (room.clients.size === 0) {
        rooms.delete(currentRoomId)
      } else {
        broadcastPresence(room)
      }
    })
  })

  const cleanupExpiredRooms = async () => {
    if (!allowFileStorage || !retentionMs) return
    try {
      const entries = await readdir(sessionDir)
      await Promise.all(
        entries
          .filter((entry) => entry.endsWith('.json'))
          .map(async (entry) => {
            const roomId = entry.slice(0, -'.json'.length)
            let record
            try {
              record = JSON.parse(await readFile(getSessionPath(roomId), 'utf8'))
            } catch {
              await deletePersistedRoom(roomId)
              return
            }
            if (!isRoomRecord(record) || isExpired(record)) {
              await deletePersistedRoom(roomId)
            }
          }),
      )
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  void cleanupExpiredRooms().catch((error) => {
    console.error('Failed to clean expired session rooms:', error)
  })

  return { app, server, wss, rooms, deletingRooms: deletedRooms, cleanupExpiredRooms }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const { server } = createCollaborationServer()
  const port = Number(process.env.PORT ?? 4173)
  server.listen(port, '0.0.0.0', () => {
    console.log(`ACT therapy workspace listening on http://localhost:${port}`)
  })
}
