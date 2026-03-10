# Studio Chat

Aplicación de chat con varios modelos de OpenAI, historial persistente en disco y renombrado automático de conversaciones con IA.

## Requisitos

- Node.js 20+
- `OPENAI_API_KEY` en un archivo `.env` o exportada en el entorno

## Desarrollo

```bash
npm install
cp .env.example .env
npm run dev
```

Esto arranca:

- frontend Vite en `http://localhost:5173`
- API Express en `http://localhost:8787`

## Producción local

```bash
npm run build
npm start
```

## Funcionalidad

- selector de modelos recientes y relevantes de OpenAI
- historial local en `data/conversations.json`
- títulos generados automáticamente según el contenido de la conversación
- interfaz responsive con sidebar, búsqueda y estado de carga
