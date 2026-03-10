import {
  type FormEvent,
  type KeyboardEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'

type Role = 'user' | 'assistant' | 'system'

type Model = {
  id: string
  label: string
  subtitle: string
  badge: string
}

type Message = {
  id: string
  role: Role
  content: string
  createdAt: string
}

type ConversationSummary = {
  id: string
  title: string
  modelId: string
  updatedAt: string
  preview: string
}

type Conversation = ConversationSummary & {
  messages: Message[]
}

const EMPTY_TEXT = 'Describe el objetivo de la conversación y empieza a escribir.'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(payload?.error ?? 'La petición no se pudo completar.')
  }

  return response.json() as Promise<T>
}

function formatRelativeDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function App() {
  const [models, setModels] = useState<Model[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeModelId, setActiveModelId] = useState('gpt-5.4')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const deferredQuery = useDeferredValue(query)

  const filteredConversations = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()
    if (!normalized) {
      return conversations
    }

    return conversations.filter((conversation) => {
      return (
        conversation.title.toLowerCase().includes(normalized) ||
        conversation.preview.toLowerCase().includes(normalized)
      )
    })
  }, [conversations, deferredQuery])

  useEffect(() => {
    async function loadInitialState() {
      setError(null)

      try {
        const [modelPayload, conversationPayload] = await Promise.all([
          request<{ models: Model[] }>('/api/models'),
          request<{ conversations: ConversationSummary[] }>('/api/conversations'),
        ])

        setModels(modelPayload.models)
        setConversations(conversationPayload.conversations)

        if (modelPayload.models[0]) {
          setActiveModelId(modelPayload.models[0].id)
        }

        if (conversationPayload.conversations[0]) {
          await loadConversation(conversationPayload.conversations[0].id)
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la app.')
      }
    }

    void loadInitialState()
  }, [])

  useEffect(() => {
    if (!messageListRef.current) {
      return
    }

    messageListRef.current.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [activeConversation?.messages, isSending])

  async function loadConversation(id: string) {
    setIsLoadingConversation(true)
    setError(null)

    try {
      const payload = await request<{ conversation: Conversation }>(`/api/conversations/${id}`)
      startTransition(() => {
        setActiveConversation(payload.conversation)
        setActiveModelId(payload.conversation.modelId)
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudo abrir la conversación.')
    } finally {
      setIsLoadingConversation(false)
    }
  }

  async function createConversation() {
    setError(null)

    try {
      const payload = await request<{ conversation: Conversation }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ modelId: activeModelId }),
      })

      startTransition(() => {
        setActiveConversation(payload.conversation)
        setConversations((current) => [payload.conversation, ...current])
      })
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : 'No se pudo crear la conversación.',
      )
    }
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (isSending || !draft.trim()) {
      return
    }

    setError(null)
    setIsSending(true)

    try {
      let conversationId = activeConversation?.id

      if (!conversationId) {
        const created = await request<{ conversation: Conversation }>('/api/conversations', {
          method: 'POST',
          body: JSON.stringify({ modelId: activeModelId }),
        })

        conversationId = created.conversation.id
        setActiveConversation(created.conversation)
        setConversations((current) => [created.conversation, ...current])
      }

      const payload = await request<{
        conversation: Conversation
        conversations: ConversationSummary[]
      }>(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: draft.trim(),
          modelId: activeModelId,
        }),
      })

      setDraft('')
      startTransition(() => {
        setActiveConversation(payload.conversation)
        setConversations(payload.conversations)
      })
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'No se pudo enviar el mensaje.',
      )
    } finally {
      setIsSending(false)
    }
  }

  async function deleteConversation(id: string) {
    const shouldDelete = window.confirm('Se eliminará esta conversación del historial.')
    if (!shouldDelete) {
      return
    }

    setError(null)

    try {
      const payload = await request<{ conversations: ConversationSummary[] }>(
        `/api/conversations/${id}`,
        {
          method: 'DELETE',
        },
      )

      setConversations(payload.conversations)

      if (activeConversation?.id === id) {
        const nextConversation = payload.conversations[0]
        if (nextConversation) {
          await loadConversation(nextConversation.id)
        } else {
          setActiveConversation(null)
        }
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'No se pudo borrar la conversación.',
      )
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <p className="eyebrow">OpenAI Multi-Model</p>
            <h1>Studio Chat</h1>
          </div>
          <button className="primary-button" onClick={() => void createConversation()}>
            Nueva charla
          </button>
        </div>

        <label className="search">
          <span>Buscar</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Título o contenido"
          />
        </label>

        <div className="model-panel">
          <div className="panel-heading">
            <span>Modelos destacados</span>
            <small>Última generación</small>
          </div>
          <div className="model-list">
            {models.map((model) => (
              <button
                key={model.id}
                className={`model-card ${activeModelId === model.id ? 'selected' : ''}`}
                onClick={() => setActiveModelId(model.id)}
              >
                <div>
                  <strong>{model.label}</strong>
                  <p>{model.subtitle}</p>
                </div>
                <span>{model.badge}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="history-panel">
          <div className="panel-heading">
            <span>Historial</span>
            <small>{conversations.length} conversaciones</small>
          </div>

          <div className="history-list">
            {filteredConversations.map((conversation) => (
              <article
                key={conversation.id}
                className={`history-item ${
                  activeConversation?.id === conversation.id ? 'active' : ''
                }`}
              >
                <button onClick={() => void loadConversation(conversation.id)}>
                  <strong>{conversation.title}</strong>
                  <p>{conversation.preview || 'Sin mensajes todavía'}</p>
                  <small>{formatRelativeDate(conversation.updatedAt)}</small>
                </button>
                <button
                  className="ghost-button"
                  onClick={() => void deleteConversation(conversation.id)}
                  aria-label={`Eliminar ${conversation.title}`}
                >
                  ×
                </button>
              </article>
            ))}
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="hero">
          <div>
            <p className="eyebrow">Conversaciones con memoria local</p>
            <h2>{activeConversation?.title ?? 'Empieza una nueva conversación'}</h2>
          </div>
          <div className="hero-meta">
            <span>{models.find((model) => model.id === activeModelId)?.label ?? activeModelId}</span>
            <span>Los títulos se actualizan automáticamente con IA</span>
          </div>
        </header>

        <section className="chat-surface">
          <div className="message-list" ref={messageListRef}>
            {!activeConversation?.messages.length && !isLoadingConversation ? (
              <div className="empty-state">
                <p className="eyebrow">Listo para conversar</p>
                <h3>Selecciona un modelo y escribe tu primer mensaje.</h3>
                <p>{EMPTY_TEXT}</p>
              </div>
            ) : null}

            {isLoadingConversation ? (
              <div className="status-card">Cargando conversación...</div>
            ) : null}

            {activeConversation?.messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <span className="message-role">
                  {message.role === 'user' ? 'Tú' : message.role === 'assistant' ? 'IA' : 'Sistema'}
                </span>
                <p>{message.content}</p>
              </article>
            ))}

            {isSending ? <div className="status-card">Generando respuesta...</div> : null}
          </div>

          <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span>Mensaje</span>
              <textarea
                rows={4}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Pide una comparación, una explicación técnica, una estrategia o una revisión."
              />
            </label>

            <div className="composer-bar">
              <div className="composer-meta">
                <span>Enter para enviar</span>
                <span>Shift + Enter para salto de línea</span>
              </div>
              <button className="primary-button" type="submit" disabled={isSending || !draft.trim()}>
                Enviar
              </button>
            </div>
          </form>

          {error ? <div className="error-banner">{error}</div> : null}
        </section>
      </main>
    </div>
  )
}

export default App
