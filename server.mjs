import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const safeRoomId = (roomId) => String(roomId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
export const isEncryptedState = (state) =>
  Boolean(
    state &&
      typeof state === 'object' &&
      state.version === 1 &&
      state.algorithm === 'AES-GCM' &&
      state.kdf === 'PBKDF2-SHA-256' &&
      typeof state.iterations === 'number' &&
      typeof state.salt === 'string' &&
      typeof state.iv === 'string' &&
      typeof state.ciphertext === 'string',
  )

const isRoomRecord = (record) =>
  Boolean(
    record &&
      typeof record === 'object' &&
      record.version === 2 &&
      typeof record.verifierSalt === 'string' &&
      typeof record.verifierHash === 'string' &&
      typeof record.encryptionSalt === 'string' &&
      (record.state === null || isEncryptedState(record.state)),
  )

const send = (client, payload) => {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify(payload))
  }
}

export const createCollaborationServer = ({
  distDir = path.join(__dirname, 'dist'),
  sessionDir = path.join(__dirname, 'data', 'sessions'),
} = {}) => {
  const app = express()
  const server = createServer(app)
  const rooms = new Map()
  const roomCreationLocks = new Map()

  const getSessionPath = (roomId) => path.join(sessionDir, `${safeRoomId(roomId)}.json`)

  const loadPersistedRoom = async (roomId) => {
    try {
      const record = JSON.parse(await readFile(getSessionPath(roomId), 'utf8'))
      return isRoomRecord(record) ? record : null
    } catch {
      return null
    }
  }

  const persistRoom = async (roomId, room) => {
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      getSessionPath(roomId),
      JSON.stringify(
        {
          version: 2,
          verifierSalt: room.verifierSalt,
          verifierHash: room.verifierHash,
          encryptionSalt: room.encryptionSalt,
          state: room.state,
        },
        null,
        2,
      ),
    )
  }

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
    const room = {
      version: 2,
      verifierSalt: message.verifierSalt,
      verifierHash: message.verifierHash,
      encryptionSalt: message.encryptionSalt,
      state: isEncryptedState(message.state) ? message.state : null,
      clients: new Set(),
      followerId: null,
    }
    rooms.set(roomId, room)
    await persistRoom(roomId, room)
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

  const wss = new WebSocketServer({ server, path: '/collaboration' })

  wss.on('connection', (socket) => {
    let currentRoomId = null
    let currentParticipantId = null

    const reject = (code, reason) => {
      send(socket, { type: 'error', code, reason })
    }

    socket.on('message', async (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        reject('bad-message', 'Message was not valid JSON.')
        return
      }

      if (message.type === 'room-info') {
        const roomId = safeRoomId(message.room)
        if (!roomId) {
          reject('bad-room', 'Room id is required.')
          return
        }
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
        const roomId = safeRoomId(message.room)
        if (!roomId || typeof message.verifierHash !== 'string') {
          reject('unauthorized', 'A room passphrase proof is required.')
          return
        }

        let room = await getRoom(roomId)
        if (!room) {
          if (
            typeof message.verifierSalt !== 'string' ||
            typeof message.encryptionSalt !== 'string' ||
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

      if (!currentRoomId) {
        reject('unauthorized', 'Join the room before sending collaboration messages.')
        return
      }

      if (message.type === 'follow-control') {
        const room = rooms.get(currentRoomId)
        if (!room) return

        if (message.enabled) {
          if (room.followerId && room.followerId !== message.participantId) {
            send(socket, {
              type: 'follow-state',
              accepted: false,
              followerId: room.followerId,
            })
            return
          }
          room.followerId = message.participantId
        } else if (room.followerId === message.participantId) {
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
        if (!room || !isEncryptedState(message.state)) {
          reject('bad-state', 'Only encrypted room state can be synced.')
          return
        }

        room.state = message.state
        persistRoom(currentRoomId, room).catch((error) => {
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

      if (message.type === 'follow') {
        const room = rooms.get(currentRoomId)
        if (!room) return
        room.clients.forEach((client) => {
          if (client !== socket) {
            send(client, message)
          }
        })
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

  return { app, server, wss, rooms }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const { server } = createCollaborationServer()
  const port = Number(process.env.PORT ?? 4173)
  server.listen(port, '0.0.0.0', () => {
    console.log(`ACT therapy workspace listening on http://localhost:${port}`)
  })
}
