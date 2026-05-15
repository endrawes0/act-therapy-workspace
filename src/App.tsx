import {
  Activity,
  Check,
  CircleDot,
  Copy,
  HeartHandshake,
  Link,
  Lock,
  MessageSquareText,
  MonitorUp,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
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
  icon: 'values' | 'defusion' | 'choice' | 'matrix' | 'mindful'
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

type WireMessage =
  | { type: 'join'; room: string; participantId: string; role: Role; state: SessionState }
  | { type: 'state'; state: SessionState; participantCount: number }
  | { type: 'presence'; participantCount: number }
  | { type: 'sync'; state: SessionState; participantId: string; role: Role }

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
  defusion: MessageSquareText,
  choice: CircleDot,
  matrix: Activity,
  mindful: HeartHandshake,
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

function App() {
  const [session, setSession] = useState<SessionState>(createInitialState)
  const [role, setRole] = useState<Role>('counselor')
  const [room] = useState(getRoomFromUrl)
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [participants, setParticipants] = useState(1)
  const socketRef = useRef<WebSocket | null>(null)
  const sessionRef = useRef(session)
  const participantId = useMemo(() => crypto.randomUUID(), [])
  const activeWorksheet =
    session.worksheets.find((worksheet) => worksheet.id === session.activeWorksheetId) ??
    session.worksheets[0]
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room}`

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    let reconnect: number | undefined
    let closedByEffect = false

    const connect = () => {
      setStatus('connecting')
      const socket = new WebSocket(getSocketUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        setStatus('connected')
        socket.send(
          JSON.stringify({ type: 'join', room, participantId, role, state: sessionRef.current }),
        )
      })

      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data) as WireMessage
        if (message.type === 'state') {
          setSession(message.state)
          setParticipants(message.participantCount)
        }
        if (message.type === 'presence') setParticipants(message.participantCount)
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
  }, [participantId, role, room])

  const updateSession = (updater: (current: SessionState) => SessionState) => {
    setSession((current) => {
      const next = { ...updater(current), lastEditedBy: role, updatedAt: Date.now() }
      const message: WireMessage = { type: 'sync', state: next, participantId, role }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify(message))
      }
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

  const insertCue = (worksheetId: string, fieldId: string, value: string) => {
    updateSession((current) => ({
      ...current,
      activeWorksheetId: worksheetId,
      worksheets: current.worksheets.map((worksheet) =>
        worksheet.id === worksheetId
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
              onChange={(event) =>
                updateSession((current) => ({ ...current, clientName: event.target.value }))
              }
            />
          </label>
          <label>
            Counselor
            <input
              value={session.counselorName}
              onChange={(event) =>
                updateSession((current) => ({ ...current, counselorName: event.target.value }))
              }
            />
          </label>
          <label>
            Session intention
            <textarea
              value={session.intention}
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
          <div className="status-row">
            <span className={`status-dot ${status}`} />
            <span>{status === 'connected' ? 'Live collaboration' : 'Reconnecting'}</span>
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
            <span>Use with a HIPAA-ready host and BAA before PHI</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Session focus</p>
            <h2>{activeWorksheet.name}</h2>
            <p>{activeWorksheet.focus}</p>
          </div>
          <div className="progress-chip">
            <Check aria-hidden="true" />
            {completedFields}/{totalFields} prompts started
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
                onClick={() =>
                  updateSession((current) => ({ ...current, activeWorksheetId: worksheet.id }))
                }
              >
                <Icon aria-hidden="true" />
                <span>{worksheet.shortName}</span>
              </button>
            )
          })}
        </nav>

        <div className="worksheet-layout">
          <section className="activity-board" aria-label={`${activeWorksheet.name} worksheet`}>
            {activeWorksheet.sections.map((field) => (
              <article className="prompt-card" key={field.id}>
                <div>
                  <p className="eyebrow">{field.label}</p>
                  <h3>{field.prompt}</h3>
                </div>
                <textarea
                  value={field.value}
                  placeholder={field.placeholder}
                  onChange={(event) => updateWorksheetField(field.id, event.target.value)}
                />
              </article>
            ))}
          </section>

          <aside className="clinical-rail" aria-label="Session notes and safeguards">
            <section>
              <div className="rail-heading">
                <MessageSquareText aria-hidden="true" />
                <h3>Shared notes</h3>
              </div>
              <textarea
                value={session.sessionNotes}
                placeholder="Track homework, language that resonated, consent notes, or items for follow-up."
                onChange={(event) =>
                  updateSession((current) => ({ ...current, sessionNotes: event.target.value }))
                }
              />
            </section>

            <section className="exercise-stack">
              <div className="rail-heading">
                <RefreshCw aria-hidden="true" />
                <h3>Quick activities</h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  insertCue('defusion-lab', 'technique', 'I am noticing the thought that...')
                }
              >
                Add defusion starter
              </button>
              <button
                type="button"
                onClick={() =>
                  insertCue(
                    'acceptance-expansion',
                    'space',
                    'Breathe around the sensation and make 10% more room for it.',
                  )
                }
              >
                Add expansion cue
              </button>
              <button
                type="button"
                onClick={() =>
                  insertCue(
                    'choice-point',
                    'toward',
                    'One small toward move I can take in the next 24 hours is...',
                  )
                }
              >
                Add toward move
              </button>
            </section>

            <section className="safety-note">
              <Lock aria-hidden="true" />
              <p>
                This prototype does not replace clinical judgment, emergency care,
                consent procedures, or compliant record systems.
              </p>
            </section>
          </aside>
        </div>
      </section>
    </main>
  )
}

export default App
