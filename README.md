# ACT Therapy Workspace

An interactive Acceptance and Commitment Therapy workspace for shared
client/counselor sessions. The app includes common ACT worksheets and activities
with live room-based editing over WebSockets.

## Demo

[Open the public Render demo](https://act-therapy-workspace-demo.onrender.com).

## Included Activities

- Values Compass
- Life Map
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

## Collaboration

Worksheet content syncs live for everyone in the same room. `Follow` mode is
off by default and only one participant can follow at a time. When a participant
turns it on, their view follows another participant's focus changes, worksheet
field focus, and scroll position; the followed field is highlighted in the
follower's view.

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
requirements. The current server persists room state as JSON files under
`data/sessions`, which is useful for restoration but should be replaced or
hardened with encrypted storage, access controls, retention policies, and audit
logging before clinical production use.

## Client Take-Away

Use the save panel in the app to:

- save a browser restore point for the current room
- restore the current browser's saved room state
- export a Markdown session summary for the client
- export a worksheet-specific SVG visual reference for the active focus
- export a JSON session file that can be imported later
- print or save the current worksheet view as a PDF

## Visual Worksheet Exports

The `Visual` button exports an SVG handout for the currently selected focus.

| Focus | Visual worksheet export |
| --- | --- |
| Values | Life Domains / Values Compass |
| Life Map | Life Map with Me/Noticing axes |
| Action | Committed Action Path |
| Defusion | Hexaflex with Cognitive Defusion highlighted |
| Choice Point | Choice Point fork map |
| Matrix | ACT Matrix |
| Acceptance | Hexaflex with Acceptance highlighted |
| Observer | Hexaflex with Self-as-Context highlighted |
