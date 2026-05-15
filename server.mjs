import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const server = createServer(app)
const rooms = new Map()
const dataDir = path.join(__dirname, 'data', 'sessions')

app.use(express.static(path.join(__dirname, 'dist')))
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const wss = new WebSocketServer({ server, path: '/collaboration' })

const safeRoomId = (roomId) => roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
const getSessionPath = (roomId) => path.join(dataDir, `${safeRoomId(roomId)}.json`)

const loadPersistedState = async (roomId) => {
  try {
    return JSON.parse(await readFile(getSessionPath(roomId), 'utf8'))
  } catch {
    return null
  }
}

const persistState = async (roomId, state) => {
  await mkdir(dataDir, { recursive: true })
  await writeFile(getSessionPath(roomId), JSON.stringify(state, null, 2))
}

const getRoom = async (roomId, initialState) => {
  if (!rooms.has(roomId)) {
    const persistedState = await loadPersistedState(roomId)
    rooms.set(roomId, {
      state: persistedState ?? initialState,
      clients: new Set(),
    })
  }
  return rooms.get(roomId)
}

const send = (client, payload) => {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify(payload))
  }
}

const broadcastPresence = (room) => {
  const payload = { type: 'presence', participantCount: room.clients.size }
  room.clients.forEach((client) => send(client, payload))
}

wss.on('connection', (socket) => {
  let currentRoomId = null

  socket.on('message', async (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (message.type === 'join') {
      currentRoomId = message.room
      const room = await getRoom(message.room, message.state)
      room.clients.add(socket)
      send(socket, {
        type: 'state',
        state: room.state,
        participantCount: room.clients.size,
      })
      broadcastPresence(room)
      return
    }

    if (message.type === 'sync' && currentRoomId) {
      const room = rooms.get(currentRoomId)
      if (!room) return
      room.state = message.state
      persistState(currentRoomId, room.state).catch((error) => {
        console.error(`Failed to save room ${currentRoomId}:`, error)
      })
      room.clients.forEach((client) => {
        if (client !== socket) {
          send(client, {
            type: 'state',
            state: room.state,
            participantCount: room.clients.size,
          })
        }
      })
      return
    }

    if (message.type === 'follow' && currentRoomId) {
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
    if (room.clients.size === 0) {
      rooms.delete(currentRoomId)
    } else {
      broadcastPresence(room)
    }
  })
})

const port = Number(process.env.PORT ?? 4173)
server.listen(port, '0.0.0.0', () => {
  console.log(`ACT therapy workspace listening on http://localhost:${port}`)
})
