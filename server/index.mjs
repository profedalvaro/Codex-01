import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const DATA_FILE = path.join(DATA_DIR, 'conversations.json')
const CLIENT_DIST = path.join(ROOT_DIR, 'dist')
const PORT = Number(process.env.PORT ?? 8787)

const MODEL_CATALOG = [
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    subtitle: 'Modelo principal actual de OpenAI para razonamiento, coding y trabajo profesional.',
    badge: 'Recommended',
  },
  {
    id: 'gpt-5-mini-2025-08-07',
    label: 'GPT-5 mini',
    subtitle: 'Variante rápida y más económica para chats frecuentes y menor latencia.',
    badge: 'Fast',
  },
  {
    id: 'gpt-5-codex',
    label: 'GPT-5 Codex',
    subtitle: 'Especializado en ingeniería de software, debugging y tareas de código.',
    badge: 'Code',
  },
  {
    id: 'o3-pro',
    label: 'o3-pro',
    subtitle: 'Razonamiento deliberado para planificación y problemas complejos.',
    badge: 'Reasoning',
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    subtitle: 'Buena compatibilidad heredada para equipos que aún lo usan.',
    badge: 'Stable',
  },
]

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('Falta la variable OPENAI_API_KEY.')
  }

  return new OpenAI({ apiKey })
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true })

  try {
    await fs.access(DATA_FILE)
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ conversations: [] }, null, 2))
  }
}

async function readStore() {
  await ensureDataFile()
  const raw = await fs.readFile(DATA_FILE, 'utf8')
  return JSON.parse(raw)
}

async function writeStore(store) {
  await ensureDataFile()
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2))
}

function toSummary(conversation) {
  const lastUserMessage = [...conversation.messages].reverse().find((message) => message.role === 'user')

  return {
    id: conversation.id,
    title: conversation.title,
    modelId: conversation.modelId,
    updatedAt: conversation.updatedAt,
    preview: lastUserMessage?.content.slice(0, 120) ?? '',
  }
}

async function generateChatReply(modelId, messages) {
  const client = createOpenAIClient()

  const response = await client.responses.create({
    model: modelId,
    instructions:
      'Eres un asistente útil, riguroso y directo. Responde en español salvo que el usuario pida otro idioma.',
    input: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  })

  return response.output_text?.trim() || 'No he podido generar una respuesta útil.'
}

async function generateTitle(messages) {
  const client = createOpenAIClient()
  const transcript = messages
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')

  const response = await client.responses.create({
    model: 'gpt-5.4',
    instructions:
      'Genera un título breve en español para esta conversación. Máximo 6 palabras. Sin comillas.',
    input: transcript,
  })

  return response.output_text?.trim().slice(0, 60) || 'Nueva conversación'
}

app.get('/api/models', (_request, response) => {
  response.json({ models: MODEL_CATALOG })
})

app.get('/api/conversations', async (_request, response) => {
  const store = await readStore()
  const conversations = store.conversations
    .map(toSummary)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())

  response.json({ conversations })
})

app.get('/api/conversations/:id', async (request, response) => {
  const store = await readStore()
  const conversation = store.conversations.find((item) => item.id === request.params.id)

  if (!conversation) {
    response.status(404).json({ error: 'No se encontró la conversación.' })
    return
  }

  response.json({ conversation })
})

app.post('/api/conversations', async (request, response) => {
  const store = await readStore()
  const now = new Date().toISOString()

  const conversation = {
    id: createId('conv'),
    title: 'Nueva conversación',
    modelId: request.body.modelId || MODEL_CATALOG[0].id,
    updatedAt: now,
    messages: [],
  }

  store.conversations.unshift(conversation)
  await writeStore(store)

  response.status(201).json({ conversation })
})

app.post('/api/conversations/:id/messages', async (request, response) => {
  const { content, modelId } = request.body ?? {}

  if (!content || typeof content !== 'string') {
    response.status(400).json({ error: 'El mensaje es obligatorio.' })
    return
  }

  const store = await readStore()
  const conversation = store.conversations.find((item) => item.id === request.params.id)

  if (!conversation) {
    response.status(404).json({ error: 'No se encontró la conversación.' })
    return
  }

  const now = new Date().toISOString()
  const selectedModel = typeof modelId === 'string' ? modelId : conversation.modelId
  conversation.modelId = selectedModel

  conversation.messages.push({
    id: createId('msg'),
    role: 'user',
    content: content.trim(),
    createdAt: now,
  })

  try {
    const answer = await generateChatReply(selectedModel, conversation.messages)

    conversation.messages.push({
      id: createId('msg'),
      role: 'assistant',
      content: answer,
      createdAt: new Date().toISOString(),
    })

    if (conversation.messages.length >= 2) {
      conversation.title = await generateTitle(conversation.messages)
    }
  } catch (error) {
    conversation.messages.push({
      id: createId('msg'),
      role: 'assistant',
      content:
        error instanceof Error
          ? `Error al consultar OpenAI: ${error.message}`
          : 'Error desconocido al consultar OpenAI.',
      createdAt: new Date().toISOString(),
    })
  }

  conversation.updatedAt = new Date().toISOString()
  await writeStore(store)

  const conversations = store.conversations
    .map(toSummary)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())

  response.json({ conversation, conversations })
})

app.delete('/api/conversations/:id', async (request, response) => {
  const store = await readStore()
  store.conversations = store.conversations.filter((item) => item.id !== request.params.id)
  await writeStore(store)

  const conversations = store.conversations
    .map(toSummary)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())

  response.json({ conversations })
})

app.use(express.static(CLIENT_DIST))

app.get(/.*/, async (_request, response, next) => {
  try {
    const indexHtml = await fs.readFile(path.join(CLIENT_DIST, 'index.html'), 'utf8')
    response.type('html').send(indexHtml)
  } catch (error) {
    next(error)
  }
})

app.listen(PORT, async () => {
  await ensureDataFile()
  console.log(`Server ready on http://localhost:${PORT}`)
})
