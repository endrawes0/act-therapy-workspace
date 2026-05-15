# ACT Therapy Workspace

An interactive Acceptance and Commitment Therapy workspace for shared
client/counselor sessions. The app includes common ACT worksheets and activities
with live room-based editing over WebSockets.

## Included Activities

- Values Compass
- Committed Action Plan
- Defusion Lab
- Choice Point
- ACT Matrix
- Acceptance and Expansion
- Observer Self

## Development

Run commands from WSL in this project directory.

```bash
npm install
npm run dev
```

The Vite dev server only serves the frontend. For end-to-end collaboration,
build and run the Node server:

```bash
npm run build
npm start
```

Then open `http://localhost:4173`. Each generated `?room=` URL is a shared
session room.

## Deployment

The production server in `server.mjs` serves the built React app from `dist` and
hosts the `/collaboration` WebSocket endpoint on the same origin.

Typical deployment command:

```bash
npm ci
npm run build
PORT=4173 npm start
```

For telehealth or in-office use with protected health information, deploy only
on infrastructure covered by the required privacy, security, consent, and BAA
requirements. The current WebSocket room store is in memory, so session contents
are not persisted after server restart.
