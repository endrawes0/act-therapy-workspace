import {
  Activity,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  Download,
  Eye,
  FileJson,
  FileText,
  FolderOpen,
  HeartHandshake,
  ImageDown,
  Link,
  Lock,
  Map,
  MessageSquareText,
  MonitorUp,
  PenLine,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Role = 'client' | 'counselor'
type ConnectionStatus = 'offline' | 'connecting' | 'connected'

type Field = {
  id: string
  label: string
  prompt: string
  value: string
  placeholder: string
}

type Worksheet = {
  id: string
  name: string
  shortName: string
  focus: string
  icon: 'values' | 'lifemap' | 'defusion' | 'choice' | 'matrix' | 'mindful'
  sections: Field[]
}

type SessionState = {
  clientName: string
  counselorName: string
  intention: string
  sessionNotes: string
  worksheets: Worksheet[]
  activeWorksheetId: string
  lastEditedBy: Role
  updatedAt: number
}

type SessionExport = {
  app: 'act-therapy-workspace'
  version: 1
  room: string
  exportedAt: string
  state: SessionState
}

type EncryptedSessionState = {
  version: 1
  algorithm: 'AES-GCM'
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

type FollowEvent =
  | { kind: 'worksheet'; worksheetId: string }
  | { kind: 'field'; worksheetId: string; fieldId: string }
  | { kind: 'scroll'; y: number }

type WireMessage =
  | { type: 'room-info'; room: string; exists?: boolean; verifierSalt?: string | null; encryptionSalt?: string | null }
  | {
      type: 'join'
      room: string
      participantId: string
      role: Role
      verifierHash: string
      verifierSalt?: string
      encryptionSalt?: string
      state?: EncryptedSessionState
    }
  | { type: 'state'; state: EncryptedSessionState | null; participantCount: number; followerId?: string | null }
  | { type: 'presence'; participantCount: number; followerId?: string | null }
  | { type: 'sync'; state: EncryptedSessionState; participantId: string; role: Role }
  | { type: 'follow'; event: FollowEvent; participantId: string; role: Role }
  | { type: 'follow-control'; enabled: boolean; participantId: string; role: Role }
  | { type: 'follow-state'; accepted: boolean; followerId: string | null }
  | { type: 'delete-room'; participantId: string; role: Role }
  | { type: 'room-deleted' }
  | { type: 'error'; code: string; reason: string }

const templates: Worksheet[] = [
  {
    id: 'values-compass',
    name: 'Values Compass',
    shortName: 'Values',
    focus: 'Clarify what matters and translate values into visible behavior.',
    icon: 'values',
    sections: [
      {
        id: 'domains',
        label: 'Life domains',
        prompt: 'Which areas feel most alive or most neglected right now?',
        value: '',
        placeholder: 'Relationships, health, work, learning, community...',
      },
      {
        id: 'values',
        label: 'Chosen values',
        prompt: 'Name qualities of action the client wants to embody.',
        value: '',
        placeholder: 'Present, honest, steady, generous, courageous...',
      },
      {
        id: 'behaviors',
        label: 'Visible behaviors',
        prompt: 'What would another person see if these values were being lived?',
        value: '',
        placeholder: 'Call my sister weekly; take lunch away from the desk...',
      },
    ],
  },
  {
    id: 'life-map',
    name: 'Life Map',
    shortName: 'Life Map',
    focus: 'Notice what shows up inside, what pulls away, and what moves toward who and what matters.',
    icon: 'lifemap',
    sections: [
      {
        id: 'important',
        label: 'Who and what matters',
        prompt: 'Who and what is most important to you?',
        value: '',
        placeholder: 'My partner, children, health, creativity, faith, learning...',
      },
      {
        id: 'inner-barriers',
        label: 'Inner barriers',
        prompt: 'What thoughts, feelings, or sensations get in the way of moving forward?',
        value: '',
        placeholder: 'Fear of rejection, shame, tight chest, “I will mess this up”...',
      },
      {
        id: 'away-moves',
        label: 'Away moves',
        prompt: 'What do you do to move away from those difficult inner experiences?',
        value: '',
        placeholder: 'Avoid calls, argue, numb out, cancel, overthink, stay busy...',
      },
      {
        id: 'toward-moves',
        label: 'Toward moves',
        prompt: 'What could you do to move toward who or what is important to you?',
        value: '',
        placeholder: 'Make the call, ask for help, take one step, show up honestly...',
      },
    ],
  },
  {
    id: 'committed-action',
    name: 'Committed Action Plan',
    shortName: 'Action',
    focus: 'Turn values into small, workable steps with room for obstacles.',
    icon: 'choice',
    sections: [
      {
        id: 'goal',
        label: 'Values-based goal',
        prompt: 'Define one action that can happen before the next session.',
        value: '',
        placeholder: 'Take a 15-minute walk after work on Monday and Thursday.',
      },
      {
        id: 'barriers',
        label: 'Likely barriers',
        prompt: 'Name thoughts, feelings, sensations, or practical constraints.',
        value: '',
        placeholder: '“I am too tired,” rain, anxious tightness, phone scrolling...',
      },
      {
        id: 'support',
        label: 'Support plan',
        prompt: 'Choose reminders, people, environments, and fallback steps.',
        value: '',
        placeholder: 'Put shoes by the door; text counselor after first walk...',
      },
    ],
  },
  {
    id: 'defusion-lab',
    name: 'Defusion Lab',
    shortName: 'Defusion',
    focus: 'Create distance from sticky thoughts without debating them.',
    icon: 'defusion',
    sections: [
      {
        id: 'thought',
        label: 'Sticky thought',
        prompt: 'Write the thought exactly as it shows up.',
        value: '',
        placeholder: 'I am failing. I cannot handle this. They will judge me.',
      },
      {
        id: 'technique',
        label: 'Defusion move',
        prompt: 'Try a brief phrase, voice, song, labeling, or “I am noticing...”',
        value: '',
        placeholder: 'I am noticing the “I am failing” story.',
      },
      {
        id: 'next-action',
        label: 'Action after defusion',
        prompt: 'What can the client do while carrying the thought lightly?',
        value: '',
        placeholder: 'Send the email draft; return to the conversation...',
      },
    ],
  },
  {
    id: 'choice-point',
    name: 'Choice Point',
    shortName: 'Choice Point',
    focus: 'Sort hooks, helpers, away moves, and toward moves in the moment.',
    icon: 'choice',
    sections: [
      {
        id: 'situation',
        label: 'Situation',
        prompt: 'What is the current context or triggering moment?',
        value: '',
        placeholder: 'Partner asks about money after a long work day.',
      },
      {
        id: 'hooks',
        label: 'Hooks and away moves',
        prompt: 'What pulls the client away from values?',
        value: '',
        placeholder: 'Defensiveness, shutting down, proving I am right...',
      },
      {
        id: 'toward',
        label: 'Helpers and toward moves',
        prompt: 'What helps the client move toward values?',
        value: '',
        placeholder: 'Slow breath, name anxiety, ask for 10 minutes, listen...',
      },
    ],
  },
  {
    id: 'act-matrix',
    name: 'ACT Matrix',
    shortName: 'Matrix',
    focus: 'Map inner experience, observable action, away moves, and toward moves.',
    icon: 'matrix',
    sections: [
      {
        id: 'inner',
        label: 'Inner experience',
        prompt: 'Thoughts, feelings, memories, urges, and body sensations.',
        value: '',
        placeholder: 'Tight chest, “I need certainty,” images of past conflict...',
      },
      {
        id: 'away',
        label: 'Away moves',
        prompt: 'Observable behaviors that move away from who or what matters.',
        value: '',
        placeholder: 'Avoid calls, over-research symptoms, cancel plans...',
      },
      {
        id: 'toward',
        label: 'Toward moves',
        prompt: 'Observable behaviors that move toward values.',
        value: '',
        placeholder: 'Ask for help, attend appointment, practice one exposure...',
      },
    ],
  },
  {
    id: 'acceptance-expansion',
    name: 'Acceptance and Expansion',
    shortName: 'Acceptance',
    focus: 'Make room for difficult sensations while staying connected to values.',
    icon: 'mindful',
    sections: [
      {
        id: 'sensation',
        label: 'Sensation map',
        prompt: 'Where is the feeling in the body, and what are its qualities?',
        value: '',
        placeholder: 'Warm pressure behind eyes; buzzing in hands; heavy stomach...',
      },
      {
        id: 'space',
        label: 'Making room',
        prompt: 'What image, breath, posture, or phrase helps create space?',
        value: '',
        placeholder: 'Let the shoulders drop; picture the feeling as weather...',
      },
      {
        id: 'withness',
        label: 'Carry it with you',
        prompt: 'What meaningful action can happen with the feeling present?',
        value: '',
        placeholder: 'Stay in the meeting and ask one clear question.',
      },
    ],
  },
  {
    id: 'observer-self',
    name: 'Observer Self',
    shortName: 'Observer',
    focus: 'Practice noticing experience from a steadier perspective.',
    icon: 'mindful',
    sections: [
      {
        id: 'noticed',
        label: 'What is noticed',
        prompt: 'List thoughts, feelings, sensations, and roles that appear.',
        value: '',
        placeholder: 'The critic, sadness, “good patient” role, tense jaw...',
      },
      {
        id: 'noticer',
        label: 'The noticing place',
        prompt: 'How does the client describe the part that notices?',
        value: '',
        placeholder: 'Quiet, wider, behind the eyes, like sitting on a hill...',
      },
      {
        id: 'return',
        label: 'Return cue',
        prompt: 'Choose a phrase or gesture to reconnect with observing.',
        value: '',
        placeholder: '“Here is noticing.” Feet on floor. Hand on chest.',
      },
    ],
  },
]

const createInitialState = (): SessionState => ({
  clientName: 'Client',
  counselorName: 'Counselor',
  intention: 'Build psychological flexibility in today\'s session.',
  sessionNotes: '',
  worksheets: templates,
  activeWorksheetId: templates[0].id,
  lastEditedBy: 'counselor',
  updatedAt: Date.now(),
})

const iconMap = {
  values: Sparkles,
  lifemap: Map,
  defusion: MessageSquareText,
  choice: CircleDot,
  matrix: Activity,
  mindful: HeartHandshake,
}

const normalizeSession = (state: SessionState): SessionState => {
  const worksheets = templates.map((template) => {
    const existing = state.worksheets.find((worksheet) => worksheet.id === template.id)
    if (!existing) return template
    return {
      ...template,
      ...existing,
      sections: template.sections.map((templateField) => {
        const existingField = existing.sections.find((field) => field.id === templateField.id)
        return existingField ? { ...templateField, value: existingField.value } : templateField
      }),
    }
  })

  return {
    ...state,
    worksheets,
    activeWorksheetId: worksheets.some((worksheet) => worksheet.id === state.activeWorksheetId)
      ? state.activeWorksheetId
      : templates[0].id,
  }
}

const getRoomFromUrl = () => {
  const params = new URLSearchParams(window.location.search)
  const room = params.get('room')
  if (room) return room
  const generated = crypto.randomUUID().slice(0, 8)
  params.set('room', generated)
  window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  return generated
}

const getSocketUrl = () => {
  const configured = import.meta.env.VITE_COLLAB_URL as string | undefined
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/collaboration`
}

const getSavedSessionKey = (room: string) => `act-session:${room}`
const roomKdfIterations = 210000

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

const base64ToBytes = (value: string) => {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const randomBase64 = (length: number) => {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

const getPassphraseBaseKey = (passphrase: string) =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  )

const getVerifierHash = async (
  room: string,
  passphrase: string,
  verifierSalt: string,
) => {
  const baseKey = await getPassphraseBaseKey(passphrase)
  const verifierBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`act-room-verifier:v2:${room}:${verifierSalt}`),
      iterations: roomKdfIterations,
      hash: 'SHA-256',
    },
    baseKey,
    256,
  )
  return bytesToBase64(new Uint8Array(verifierBits))
}

const getRoomKey = async (passphrase: string, encryptionSalt: string) => {
  const baseKey = await getPassphraseBaseKey(passphrase)
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(encryptionSalt),
      iterations: roomKdfIterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

const encryptSessionState = async (
  state: SessionState,
  key: CryptoKey,
  encryptionSalt: string,
): Promise<EncryptedSessionState> => {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const plaintext = new TextEncoder().encode(JSON.stringify(state))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: roomKdfIterations,
    salt: encryptionSalt,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

const decryptSessionState = async (
  state: EncryptedSessionState,
  key: CryptoKey,
): Promise<SessionState> => {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(state.iv) },
    key,
    base64ToBytes(state.ciphertext),
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as SessionState
}

const getExportName = (session: SessionState, extension: 'json' | 'md') => {
  const client = session.clientName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const date = new Date(session.updatedAt).toISOString().slice(0, 10)
  return `act-session-${client || 'client'}-${date}.${extension}`
}

const downloadText = (filename: string, text: string, type: string) => {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const wrapSvgText = (value: string, maxChars = 34, maxLines = 5) => {
  const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  if (words.length === 0) return ['Not recorded yet.']
  const lines: string[] = []
  let line = ''

  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word
    if (next.length > maxChars && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  })
  if (line) lines.push(line)

  if (lines.length > maxLines) {
    return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].slice(0, maxChars - 3)}...`]
  }
  return lines
}

const svgText = (
  value: string,
  x: number,
  y: number,
  options: {
    anchor?: 'start' | 'middle'
    className?: string
    lineHeight?: number
    maxChars?: number
    maxLines?: number
  } = {},
) => {
  const lines = wrapSvgText(value, options.maxChars, options.maxLines)
  const lineHeight = options.lineHeight ?? 22
  const anchor = options.anchor ?? 'start'
  const className = options.className ?? 'body'
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('')}</text>`
}

const getField = (worksheet: Worksheet, id: string) =>
  worksheet.sections.find((field) => field.id === id)?.value.trim() ?? ''

const visualFilename = (session: SessionState, worksheet: Worksheet) => {
  const client = session.clientName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const focus = worksheet.shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const date = new Date(session.updatedAt).toISOString().slice(0, 10)
  return `act-${focus}-visual-${client || 'client'}-${date}.svg`
}

const svgShell = (session: SessionState, worksheet: Worksheet, content: string) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="850" viewBox="0 0 1100 850" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(worksheet.name)} visual export</title>
  <desc id="desc">ACT worksheet visual reference for ${escapeXml(session.clientName)}.</desc>
  <style>
    .page { fill: #fbfaf5; }
    .ink { fill: #20302b; }
    .muted { fill: #617068; }
    .card { fill: #fffefa; stroke: #d7d0c1; stroke-width: 2; }
    .soft { fill: #eef6ef; stroke: #b8d1c2; stroke-width: 2; }
    .accent { fill: #2f6157; }
    .accent-soft { fill: #dcebe4; stroke: #2f6157; stroke-width: 3; }
    .warm { fill: #fff3d5; stroke: #cfb36a; stroke-width: 2; }
    .line { stroke: #2f6157; stroke-width: 5; stroke-linecap: round; fill: none; }
    .thin-line { stroke: #8a9b92; stroke-width: 2; stroke-linecap: round; fill: none; }
    .title { font: 700 38px Inter, Arial, sans-serif; fill: #20302b; }
    .subtitle { font: 500 18px Inter, Arial, sans-serif; fill: #617068; }
    .label { font: 700 16px Inter, Arial, sans-serif; fill: #41504a; letter-spacing: 1px; text-transform: uppercase; }
    .body { font: 500 19px Inter, Arial, sans-serif; fill: #20302b; }
    .small { font: 500 15px Inter, Arial, sans-serif; fill: #617068; }
    .node { font: 700 17px Inter, Arial, sans-serif; fill: #20302b; }
    .white-node { font: 700 17px Inter, Arial, sans-serif; fill: #ffffff; }
  </style>
  <rect class="page" width="1100" height="850" rx="0" />
  <text x="64" y="70" class="title">${escapeXml(worksheet.name)}</text>
  <text x="64" y="104" class="subtitle">${escapeXml(session.clientName)} with ${escapeXml(
    session.counselorName,
  )} • ${escapeXml(new Date(session.updatedAt).toLocaleDateString())}</text>
  ${content}
</svg>`

const card = (x: number, y: number, width: number, height: number, label: string, body: string) => `
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" class="card" />
  <text x="${x + 24}" y="${y + 38}" class="label">${escapeXml(label)}</text>
  ${svgText(body, x + 24, y + 76, { maxChars: Math.floor(width / 12), maxLines: 6 })}
`

const hexaflex = (highlight: string, centerNote: string) => {
  const nodes: Array<[string, number, number]> = [
    ['Contact With The Present Moment', 550, 178],
    ['Acceptance', 760, 298],
    ['Values', 760, 542],
    ['Committed Action', 550, 662],
    ['Self-As-Context', 340, 542],
    ['Cognitive Defusion', 340, 298],
  ]
  const points = nodes.map(([, x, y]) => `${x},${y}`).join(' ')
  return `
    <polygon points="${points}" class="thin-line" />
    <circle cx="550" cy="420" r="105" class="soft" />
    <text x="550" y="405" text-anchor="middle" class="node">Psychological</text>
    <text x="550" y="430" text-anchor="middle" class="node">Flexibility</text>
    ${svgText(centerNote, 550, 462, {
      anchor: 'middle',
      className: 'small',
      maxChars: 24,
      maxLines: 3,
      lineHeight: 18,
    })}
    ${nodes
      .map(([label, x, y]) => {
        const active = label === highlight
        return `
          <circle cx="${x}" cy="${y}" r="88" class="${active ? 'accent-soft' : 'card'}" />
          ${svgText(label, Number(x), Number(y) - 8, {
            anchor: 'middle',
            className: 'node',
            maxChars: 16,
            maxLines: 3,
            lineHeight: 20,
          })}
        `
      })
      .join('')}
  `
}

const buildVisualSvg = (session: SessionState, worksheet: Worksheet) => {
  if (worksheet.id === 'values-compass') {
    return svgShell(
      session,
      worksheet,
      `
        <circle cx="550" cy="430" r="196" class="soft" />
        <path d="M550 214 L608 430 L550 646 L492 430 Z" class="accent" opacity="0.18" />
        <path d="M334 430 L550 372 L766 430 L550 488 Z" class="accent" opacity="0.18" />
        <circle cx="550" cy="430" r="66" class="accent" />
        <text x="550" y="424" text-anchor="middle" class="white-node">Values</text>
        <text x="550" y="450" text-anchor="middle" class="white-node">Compass</text>
        ${card(64, 170, 286, 170, 'Life Domains', getField(worksheet, 'domains'))}
        ${card(750, 170, 286, 170, 'Chosen Values', getField(worksheet, 'values'))}
        ${card(390, 640, 320, 150, 'Visible Behaviors', getField(worksheet, 'behaviors'))}
        <path d="M382 318 C440 350 472 374 507 398" class="line" />
        <path d="M718 318 C660 350 628 374 593 398" class="line" />
        <path d="M550 504 L550 626" class="line" />
      `,
    )
  }

  if (worksheet.id === 'life-map') {
    return svgShell(
      session,
      worksheet,
      `
        <rect x="82" y="145" width="936" height="630" rx="0" fill="none" stroke="#44504b" stroke-width="2" />
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#20302b" />
          </marker>
        </defs>
        <line x1="550" y1="190" x2="550" y2="730" stroke="#20302b" stroke-width="7" marker-start="url(#arrow)" marker-end="url(#arrow)" />
        <line x1="150" y1="460" x2="950" y2="460" stroke="#20302b" stroke-width="7" marker-start="url(#arrow)" marker-end="url(#arrow)" />
        <circle cx="550" cy="460" r="70" fill="#fbfaf5" stroke="#20302b" stroke-width="4" />
        <line x1="490" y1="460" x2="610" y2="460" stroke="#20302b" stroke-width="4" />
        <text x="550" y="438" text-anchor="middle" class="node">Me</text>
        <text x="550" y="488" text-anchor="middle" class="node">Noticing</text>
        <text x="116" y="190" class="label">3. Away Moves</text>
        ${svgText(getField(worksheet, 'away-moves'), 116, 224, { maxChars: 31, maxLines: 7 })}
        <text x="616" y="190" class="label">4. Toward Moves</text>
        ${svgText(getField(worksheet, 'toward-moves'), 616, 224, { maxChars: 31, maxLines: 7 })}
        <text x="116" y="575" class="label">2. Inner Barriers</text>
        ${svgText(getField(worksheet, 'inner-barriers'), 116, 609, { maxChars: 31, maxLines: 7 })}
        <text x="616" y="575" class="label">1. Who And What Matters</text>
        ${svgText(getField(worksheet, 'important'), 616, 609, { maxChars: 31, maxLines: 7 })}
      `,
    )
  }

  if (worksheet.id === 'committed-action') {
    return svgShell(
      session,
      worksheet,
      `
        <path d="M125 420 C280 260 438 260 550 420 C662 580 820 580 975 420" class="line" />
        <circle cx="140" cy="420" r="38" class="accent" />
        <circle cx="550" cy="420" r="52" class="warm" />
        <circle cx="960" cy="420" r="38" class="accent" />
        <text x="140" y="426" text-anchor="middle" class="white-node">Start</text>
        <text x="550" y="414" text-anchor="middle" class="node">Barrier</text>
        <text x="550" y="438" text-anchor="middle" class="node">Plan</text>
        <text x="960" y="426" text-anchor="middle" class="white-node">Act</text>
        ${card(84, 570, 286, 170, 'Values-Based Goal', getField(worksheet, 'goal'))}
        ${card(407, 570, 286, 170, 'Likely Barriers', getField(worksheet, 'barriers'))}
        ${card(730, 570, 286, 170, 'Support Plan', getField(worksheet, 'support'))}
      `,
    )
  }

  if (worksheet.id === 'defusion-lab') {
    return svgShell(
      session,
      worksheet,
      `
        ${hexaflex('Cognitive Defusion', getField(worksheet, 'technique'))}
        ${card(64, 640, 300, 145, 'Sticky Thought', getField(worksheet, 'thought'))}
        ${card(736, 640, 300, 145, 'Next Action', getField(worksheet, 'next-action'))}
      `,
    )
  }

  if (worksheet.id === 'choice-point') {
    return svgShell(
      session,
      worksheet,
      `
        <path d="M550 650 L550 430" class="line" />
        <path d="M550 430 C450 365 344 315 220 260" class="line" />
        <path d="M550 430 C650 365 756 315 880 260" class="line" />
        <circle cx="550" cy="430" r="72" class="warm" />
        <text x="550" y="424" text-anchor="middle" class="node">Choice</text>
        <text x="550" y="448" text-anchor="middle" class="node">Point</text>
        ${card(390, 650, 320, 130, 'Situation', getField(worksheet, 'situation'))}
        ${card(64, 180, 330, 190, 'Hooks And Away Moves', getField(worksheet, 'hooks'))}
        ${card(706, 180, 330, 190, 'Helpers And Toward Moves', getField(worksheet, 'toward'))}
      `,
    )
  }

  if (worksheet.id === 'act-matrix') {
    return svgShell(
      session,
      worksheet,
      `
        <line x1="550" y1="170" x2="550" y2="760" class="line" />
        <line x1="190" y1="465" x2="910" y2="465" class="line" />
        <text x="550" y="156" text-anchor="middle" class="label">Inner Experience</text>
        <text x="550" y="794" text-anchor="middle" class="label">Observable Behavior</text>
        <text x="170" y="456" text-anchor="middle" class="label">Away</text>
        <text x="930" y="456" text-anchor="middle" class="label">Toward</text>
        ${card(260, 195, 580, 170, 'Thoughts, Feelings, Sensations', getField(worksheet, 'inner'))}
        ${card(110, 530, 360, 190, 'Away Moves', getField(worksheet, 'away'))}
        ${card(630, 530, 360, 190, 'Toward Moves', getField(worksheet, 'toward'))}
      `,
    )
  }

  if (worksheet.id === 'acceptance-expansion') {
    return svgShell(
      session,
      worksheet,
      `
        ${hexaflex('Acceptance', getField(worksheet, 'space'))}
        ${card(64, 640, 300, 145, 'Sensation Map', getField(worksheet, 'sensation'))}
        ${card(736, 640, 300, 145, 'Carry It With You', getField(worksheet, 'withness'))}
      `,
    )
  }

  return svgShell(
    session,
    worksheet,
    `
      ${hexaflex('Self-As-Context', getField(worksheet, 'noticer'))}
      ${card(64, 640, 300, 145, 'What Is Noticed', getField(worksheet, 'noticed'))}
      ${card(736, 640, 300, 145, 'Return Cue', getField(worksheet, 'return'))}
    `,
  )
}

const formatSessionMarkdown = (session: SessionState) => {
  const lines = [
    `# ACT Session Summary`,
    '',
    `Client: ${session.clientName}`,
    `Counselor: ${session.counselorName}`,
    `Updated: ${new Date(session.updatedAt).toLocaleString()}`,
    '',
    `## Session Intention`,
    session.intention || 'No intention recorded.',
    '',
  ]

  session.worksheets.forEach((worksheet) => {
    const completedSections = worksheet.sections.filter((field) => field.value.trim())
    if (completedSections.length === 0) return
    lines.push(`## ${worksheet.name}`, worksheet.focus, '')
    completedSections.forEach((field) => {
      lines.push(`### ${field.label}`, field.value.trim(), '')
    })
  })

  if (session.sessionNotes.trim()) {
    lines.push('## Shared Notes', session.sessionNotes.trim(), '')
  }

  return lines.join('\n')
}

const isSessionState = (value: unknown): value is SessionState => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SessionState>
  return (
    typeof candidate.clientName === 'string' &&
    typeof candidate.counselorName === 'string' &&
    typeof candidate.intention === 'string' &&
    Array.isArray(candidate.worksheets) &&
    typeof candidate.activeWorksheetId === 'string'
  )
}

function App() {
  const [session, setSession] = useState<SessionState>(createInitialState)
  const [role, setRole] = useState<Role>('counselor')
  const [room] = useState(getRoomFromUrl)
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [roomPassphrase, setRoomPassphrase] = useState('')
  const [roomSecret, setRoomSecret] = useState<string | null>(null)
  const [roomEncryptionSalt, setRoomEncryptionSalt] = useState<string | null>(null)
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null)
  const [roomLockError, setRoomLockError] = useState('')
  const [participants, setParticipants] = useState(1)
  const [notice, setNotice] = useState('Session autosaves locally and syncs as encrypted room data.')
  const [takeawayOpen, setTakeawayOpen] = useState(false)
  const [followMode, setFollowMode] = useState(false)
  const [roomFollowerId, setRoomFollowerId] = useState<string | null>(null)
  const [followedFieldId, setFollowedFieldId] = useState<string | null>(null)
  const [activeWorksheetId, setActiveWorksheetId] = useState(session.activeWorksheetId)
  const socketRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef(session)
  const roomEncryptionSaltRef = useRef(roomEncryptionSalt)
  const roomKeyRef = useRef(roomKey)
  const followModeRef = useRef(followMode)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const applyingFollowRef = useRef(false)
  const lastScrollEventRef = useRef(0)
  const syncInFlightRef = useRef(false)
  const pendingSyncRef = useRef<SessionState | null>(null)
  const participantId = useMemo(() => crypto.randomUUID(), [])
  const activeWorksheet =
    session.worksheets.find((worksheet) => worksheet.id === activeWorksheetId) ??
    session.worksheets[0]
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room}`
  const roomUnlocked = Boolean(roomSecret && roomKey && status === 'connected')
  const someoneElseIsFollowing = Boolean(roomFollowerId && roomFollowerId !== participantId)

  useEffect(() => {
    sessionRef.current = session
    localStorage.setItem(getSavedSessionKey(room), JSON.stringify(session))
  }, [room, session])

  useEffect(() => {
    roomEncryptionSaltRef.current = roomEncryptionSalt
  }, [roomEncryptionSalt])

  useEffect(() => {
    roomKeyRef.current = roomKey
  }, [roomKey])

  const setFollowModeState = (enabled: boolean) => {
    followModeRef.current = enabled
    setFollowMode(enabled)
  }

  const unlockRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const passphrase = roomPassphrase.trim()
    if (passphrase.length < 8) {
      setRoomLockError('Use a room passphrase with at least 8 characters.')
      return
    }
    setRoomLockError('')
    roomKeyRef.current = null
    setRoomKey(null)
    setRoomSecret(passphrase)
  }

  const sendFollowEvent = (event: FollowEvent) => {
    const message: WireMessage = { type: 'follow', event, participantId, role }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message))
    }
  }

  const requestFollowMode = (enabled: boolean) => {
    const message: WireMessage = { type: 'follow-control', enabled, participantId, role }
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message))
    }
    if (!enabled) {
      setFollowModeState(false)
      setFollowedFieldId(null)
    }
  }

  useEffect(() => {
    let reconnect: number | undefined
    let closedByEffect = false

    if (!roomSecret) {
      return () => undefined
    }

    const connect = () => {
      setStatus('connecting')
      const socket = new WebSocket(getSocketUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'room-info', room }))
      })

      socket.addEventListener('message', async (event) => {
        const message = JSON.parse(event.data) as WireMessage
        if (message.type === 'room-info') {
          try {
            const verifierSalt = message.verifierSalt ?? randomBase64(16)
            const encryptionSalt = message.encryptionSalt ?? randomBase64(16)
            const [verifierHash, derivedRoomKey] = await Promise.all([
              getVerifierHash(room, roomSecret, verifierSalt),
              getRoomKey(roomSecret, encryptionSalt),
            ])
            setRoomEncryptionSalt(encryptionSalt)
            roomEncryptionSaltRef.current = encryptionSalt
            roomKeyRef.current = derivedRoomKey
            setRoomKey(derivedRoomKey)
            const joinMessage: WireMessage = {
              type: 'join',
              room,
              participantId,
              role,
              verifierHash,
            }

            if (!message.exists) {
              joinMessage.verifierSalt = verifierSalt
              joinMessage.encryptionSalt = encryptionSalt
              joinMessage.state = await encryptSessionState(
                sessionRef.current,
                derivedRoomKey,
                encryptionSalt,
              )
            }

            socket.send(JSON.stringify(joinMessage))
          } catch {
            setRoomLockError('The room passphrase could not be prepared in this browser.')
            setRoomSecret(null)
            setRoomEncryptionSalt(null)
            roomEncryptionSaltRef.current = null
            roomKeyRef.current = null
            setRoomKey(null)
            socket.close()
          }
          return
        }
        if (message.type === 'state') {
          setStatus('connected')
          setParticipants(message.participantCount)
          setRoomFollowerId(message.followerId ?? null)
          if (message.state) {
            try {
              const key = roomKeyRef.current
              if (!key) throw new Error('Missing room key.')
              const decrypted = await decryptSessionState(message.state, key)
              const normalized = normalizeSession(decrypted)
              setSession(normalized)
              setActiveWorksheetId(normalized.activeWorksheetId)
            } catch {
              setRoomLockError('The passphrase did not decrypt this room.')
              setRoomSecret(null)
              setRoomEncryptionSalt(null)
              roomEncryptionSaltRef.current = null
              roomKeyRef.current = null
              setRoomKey(null)
              socket.close()
            }
          }
        }
        if (message.type === 'presence') {
          setParticipants(message.participantCount)
          setRoomFollowerId(message.followerId ?? null)
          if (message.followerId !== participantId) {
            setFollowModeState(false)
          }
        }
        if (message.type === 'follow-state') {
          setRoomFollowerId(message.followerId)
          const acceptedForMe = message.accepted && message.followerId === participantId
          setFollowModeState(acceptedForMe)
          if (!acceptedForMe) {
            setFollowedFieldId(null)
          }
        }
        if (
          message.type === 'follow' &&
          followModeRef.current &&
          message.participantId !== participantId
        ) {
          if (message.event.kind === 'worksheet') {
            setActiveWorksheetId(message.event.worksheetId)
            setFollowedFieldId(null)
          }
          if (message.event.kind === 'field') {
            const event = message.event
            setActiveWorksheetId(event.worksheetId)
            setFollowedFieldId(event.fieldId)
            window.setTimeout(() => {
              const target = document.querySelector<HTMLElement>(
                `[data-follow-field="${event.fieldId}"]`,
              )
              target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }, 80)
          }
          if (message.event.kind === 'scroll') {
            applyingFollowRef.current = true
            window.scrollTo({ top: message.event.y, behavior: 'smooth' })
            window.setTimeout(() => {
              applyingFollowRef.current = false
            }, 350)
          }
        }
        if (message.type === 'error') {
          setStatus('offline')
          if (message.code === 'unauthorized') {
            setRoomLockError(message.reason)
            setRoomSecret(null)
            setRoomEncryptionSalt(null)
            roomEncryptionSaltRef.current = null
            roomKeyRef.current = null
            setRoomKey(null)
            socket.close()
          } else {
            setNotice(message.reason)
          }
        }
        if (message.type === 'room-deleted') {
          setStatus('offline')
          setRoomSecret(null)
          setRoomEncryptionSalt(null)
          roomEncryptionSaltRef.current = null
          roomKeyRef.current = null
          setRoomKey(null)
          setParticipants(1)
          setTakeawayOpen(false)
          setNotice('Deleted the encrypted room data from the server.')
        }
      })

      socket.addEventListener('close', () => {
        setStatus('offline')
        if (!closedByEffect) reconnect = window.setTimeout(connect, 1600)
      })
    }

    connect()
    return () => {
      closedByEffect = true
      window.clearTimeout(reconnect)
      socketRef.current?.close()
    }
  }, [participantId, role, room, roomSecret])

  useEffect(() => {
    const handleScroll = () => {
      if (applyingFollowRef.current) return
      const now = Date.now()
      if (now - lastScrollEventRef.current < 250) return
      lastScrollEventRef.current = now
      sendFollowEvent({ kind: 'scroll', y: window.scrollY })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  })

  const flushPendingSync = async () => {
    if (syncInFlightRef.current) return
    const key = roomKeyRef.current
    const encryptionSalt = roomEncryptionSaltRef.current
    const socket = socketRef.current
    if (!key || !encryptionSalt || socket?.readyState !== WebSocket.OPEN) return

    syncInFlightRef.current = true
    try {
      while (pendingSyncRef.current) {
        const nextState = pendingSyncRef.current
        pendingSyncRef.current = null
        const encrypted = await encryptSessionState(nextState, key, encryptionSalt)
        if (socketRef.current?.readyState !== WebSocket.OPEN) return
        const message: WireMessage = { type: 'sync', state: encrypted, participantId, role }
        socketRef.current.send(JSON.stringify(message))
      }
    } catch {
      setNotice('The room update could not be encrypted.')
    } finally {
      syncInFlightRef.current = false
      if (pendingSyncRef.current) {
        void flushPendingSync()
      }
    }
  }

  const queueSessionSync = (state: SessionState) => {
    pendingSyncRef.current = state
    void flushPendingSync()
  }

  const updateSession = (updater: (current: SessionState) => SessionState) => {
    if (!roomUnlocked) {
      setNotice('Unlock the room before editing session content.')
      return
    }

    setSession((current) => {
      const next = { ...updater(current), lastEditedBy: role, updatedAt: Date.now() }
      queueSessionSync(next)
      return next
    })
  }

  const updateWorksheetField = (fieldId: string, value: string) => {
    updateSession((current) => ({
      ...current,
      worksheets: current.worksheets.map((worksheet) =>
        worksheet.id === activeWorksheet.id
          ? {
              ...worksheet,
              sections: worksheet.sections.map((field) =>
                field.id === fieldId ? { ...field, value } : field,
              ),
            }
          : worksheet,
      ),
    }))
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl)
    setNotice('Session link copied. Share the room passphrase separately.')
  }

  const saveSnapshot = () => {
    updateSession((current) => current)
    setNotice('Saved a browser restore point for this room.')
  }

  const restoreSnapshot = () => {
    const saved = localStorage.getItem(getSavedSessionKey(room))
    if (!saved) {
      setNotice('No browser restore point exists for this room yet.')
      return
    }
    try {
      const restored = JSON.parse(saved) as unknown
      if (!isSessionState(restored)) {
        setNotice('The saved restore point could not be read.')
        return
      }
      const normalized = normalizeSession(restored)
      setActiveWorksheetId(normalized.activeWorksheetId)
      updateSession(() => normalized)
      setNotice('Restored the browser save point and synced it to the room.')
    } catch {
      setNotice('The saved restore point could not be read.')
    }
  }

  const exportJson = () => {
    const payload: SessionExport = {
      app: 'act-therapy-workspace',
      version: 1,
      room,
      exportedAt: new Date().toISOString(),
      state: session,
    }
    downloadText(
      getExportName(session, 'json'),
      JSON.stringify(payload, null, 2),
      'application/json',
    )
    setNotice('Downloaded a restorable session file.')
  }

  const exportMarkdown = () => {
    downloadText(getExportName(session, 'md'), formatSessionMarkdown(session), 'text/markdown')
    setNotice('Downloaded a client-friendly session summary.')
  }

  const exportFocusVisual = () => {
    downloadText(
      visualFilename(session, activeWorksheet),
      buildVisualSvg(session, activeWorksheet),
      'image/svg+xml',
    )
    setNotice(`Downloaded a visual ${activeWorksheet.shortName.toLowerCase()} reference.`)
  }

  const importSession = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<SessionExport> | SessionState
      const imported = isSessionState(parsed) ? parsed : parsed.state
      if (!isSessionState(imported)) {
        setNotice('That file does not look like an ACT session export.')
        return
      }
      const normalized = normalizeSession(imported)
      setActiveWorksheetId(normalized.activeWorksheetId)
      updateSession(() => normalized)
      setNotice('Imported the session file and synced it to the room.')
    } catch {
      setNotice('The selected file could not be imported.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const deleteRoom = () => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setNotice('Unlock the room before deleting server data.')
      return
    }
    const message: WireMessage = { type: 'delete-room', participantId, role }
    socketRef.current.send(JSON.stringify(message))
  }

  const completedFields = session.worksheets.reduce(
    (total, worksheet) =>
      total + worksheet.sections.filter((field) => field.value.trim().length > 0).length,
    0,
  )
  const totalFields = session.worksheets.reduce(
    (total, worksheet) => total + worksheet.sections.length,
    0,
  )

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Session controls">
        <div className="brand-block">
          <div className="brand-mark">
            <HeartHandshake aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">ACT Therapy Workspace</p>
            <h1>Shared Session</h1>
          </div>
        </div>

        <div className="session-panel">
          <label>
            Client
            <input
              value={session.clientName}
              disabled={!roomUnlocked}
              onChange={(event) =>
                updateSession((current) => ({ ...current, clientName: event.target.value }))
              }
            />
          </label>
          <label>
            Counselor
            <input
              value={session.counselorName}
              disabled={!roomUnlocked}
              onChange={(event) =>
                updateSession((current) => ({ ...current, counselorName: event.target.value }))
              }
            />
          </label>
          <label>
            Session intention
            <textarea
              value={session.intention}
              disabled={!roomUnlocked}
              onChange={(event) =>
                updateSession((current) => ({ ...current, intention: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="role-switch" aria-label="Choose your role">
          <button
            className={role === 'counselor' ? 'selected' : ''}
            type="button"
            onClick={() => setRole('counselor')}
          >
            <MonitorUp aria-hidden="true" />
            Counselor
          </button>
          <button
            className={role === 'client' ? 'selected' : ''}
            type="button"
            onClick={() => setRole('client')}
          >
            <PenLine aria-hidden="true" />
            Client
          </button>
        </div>

        <div className="collab-box">
          <form className="room-lock-form" onSubmit={unlockRoom}>
            <label>
              Room passphrase
              <input
                type="password"
                value={roomPassphrase}
                placeholder="Shared outside this app"
                onChange={(event) => setRoomPassphrase(event.target.value)}
              />
            </label>
            <button type="submit">
              <Lock aria-hidden="true" />
              {roomUnlocked ? 'Room unlocked' : 'Unlock room'}
            </button>
            {roomLockError ? <p className="room-lock-error">{roomLockError}</p> : null}
          </form>
          <div className="status-row">
            <span className={`status-dot ${status}`} />
            <span>
              {roomSecret
                ? roomUnlocked
                  ? 'Encrypted collaboration'
                  : 'Connecting securely'
                : 'Locked room'}
            </span>
          </div>
          <div className="room-row">
            <Link aria-hidden="true" />
            <code>{room}</code>
            <button type="button" onClick={copyLink} aria-label="Copy session link">
              <Copy aria-hidden="true" />
            </button>
          </div>
          <div className="meta-row">
            <Users aria-hidden="true" />
            <span>{participants} participant{participants === 1 ? '' : 's'}</span>
          </div>
          <div className="meta-row">
            <ShieldCheck aria-hidden="true" />
            <span>Server stores encrypted room contents only</span>
          </div>
          <button
            className={`follow-toggle ${followMode ? 'selected' : ''}`}
            type="button"
            aria-pressed={followMode}
            disabled={!roomUnlocked || someoneElseIsFollowing}
            onClick={() => requestFollowMode(!followMode)}
          >
            <Eye aria-hidden="true" />
            {someoneElseIsFollowing ? 'Following in use' : `Follow ${followMode ? 'on' : 'off'}`}
          </button>
        </div>

        <div className="safety-note">
          <Lock aria-hidden="true" />
          <p>
            This prototype does not replace clinical judgment, emergency care,
            consent procedures, or compliant record systems.
          </p>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Session focus</p>
            <h2>{activeWorksheet.name}</h2>
            <p>{activeWorksheet.focus}</p>
          </div>
          <div className="workspace-actions">
            <div className="progress-chip">
              <Check aria-hidden="true" />
              {completedFields}/{totalFields} prompts started
            </div>
            <div className="takeaway-menu">
              <button
                className="takeaway-trigger"
                type="button"
                aria-expanded={takeawayOpen}
                disabled={!roomUnlocked}
                onClick={() => setTakeawayOpen((open) => !open)}
              >
                <Save aria-hidden="true" />
                Save and take-away
                <ChevronDown aria-hidden="true" />
              </button>
              {takeawayOpen ? (
                <div className="takeaway-panel">
                  <p>{notice}</p>
                  <div className="continuity-grid">
                    <button type="button" onClick={saveSnapshot}>
                      <Save aria-hidden="true" />
                      Save
                    </button>
                    <button type="button" onClick={restoreSnapshot}>
                      <FolderOpen aria-hidden="true" />
                      Restore
                    </button>
                    <button type="button" onClick={exportMarkdown}>
                      <FileText aria-hidden="true" />
                      Summary
                    </button>
                    <button type="button" onClick={exportFocusVisual}>
                      <ImageDown aria-hidden="true" />
                      Visual
                    </button>
                    <button type="button" onClick={exportJson}>
                      <FileJson aria-hidden="true" />
                      Session
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>
                      <Upload aria-hidden="true" />
                      Import
                    </button>
                    <button type="button" onClick={deleteRoom}>
                      <Lock aria-hidden="true" />
                      Delete room
                    </button>
                    <button type="button" onClick={() => window.print()}>
                      <Download aria-hidden="true" />
                      Print
                    </button>
                  </div>
                  <span className="saved-stamp">
                    Browser save: {new Date(session.updatedAt).toLocaleTimeString()}
                  </span>
                </div>
              ) : null}
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                accept="application/json,.json"
                onChange={(event) => importSession(event.target.files?.[0])}
              />
            </div>
          </div>
        </header>

        <nav className="worksheet-tabs" aria-label="ACT worksheets">
          {session.worksheets.map((worksheet) => {
            const Icon = iconMap[worksheet.icon]
            const active = worksheet.id === activeWorksheet.id
            return (
              <button
                key={worksheet.id}
                className={active ? 'active' : ''}
                type="button"
                onClick={() => {
                  setActiveWorksheetId(worksheet.id)
                  sendFollowEvent({ kind: 'worksheet', worksheetId: worksheet.id })
                }}
              >
                <Icon aria-hidden="true" />
                <span>{worksheet.shortName}</span>
              </button>
            )
          })}
        </nav>

        <section
          className={`activity-board ${activeWorksheet.id === 'life-map' ? 'life-map-board' : ''}`}
          aria-label={`${activeWorksheet.name} worksheet`}
        >
          {activeWorksheet.sections.map((field) => (
            <article
              className={`prompt-card ${followedFieldId === field.id ? 'follow-highlight' : ''}`}
              key={field.id}
            >
              <div>
                <p className="eyebrow">{field.label}</p>
                <h3>{field.prompt}</h3>
              </div>
              <textarea
                data-follow-field={field.id}
                value={field.value}
                placeholder={field.placeholder}
                onFocus={() =>
                  roomUnlocked
                    ? sendFollowEvent({
                        kind: 'field',
                        worksheetId: activeWorksheet.id,
                        fieldId: field.id,
                      })
                    : undefined
                }
                disabled={!roomUnlocked}
                onChange={(event) => updateWorksheetField(field.id, event.target.value)}
              />
            </article>
          ))}
        </section>

        <section className="notes-box workspace-notes">
          <div className="rail-heading">
            <MessageSquareText aria-hidden="true" />
            <h3>Shared notes</h3>
          </div>
          <textarea
            value={session.sessionNotes}
            placeholder="Track homework, resonant language, consent notes, or follow-up items."
            disabled={!roomUnlocked}
            onChange={(event) =>
              updateSession((current) => ({ ...current, sessionNotes: event.target.value }))
            }
          />
        </section>
      </section>
    </main>
  )
}

export default App
