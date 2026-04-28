# Nova - Your Private AI Answer Engine

A modern, Perplexity-inspired answer engine with deep research capabilities, source tracking, and conversation memory.

## Quick Start

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
node index.js

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

## Environment Variables

**Backend (.env)**
```
DATABASE_URL=postgresql://...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GEMINI_API_KEY=...
TAVILY_API_KEY=...
```

**Frontend (.env.local)**
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_BACKEND_URL=http://localhost:3001
```

## Features

### Core
- Real-time streaming answers
- Source citations with credibility scoring
- Conversation memory
- Dark mode UI (Perplexity-inspired)

### Advanced
- **Research Trail**: Log all queries with metadata
- **Deep Research Mode**: Auto-augment prompts
- **Focus Mode**: Distraction-free fullscreen (Ctrl/Cmd+K)
- **Saved Prompts**: Reusable query library
- **Voice Readout**: Text-to-speech answers
- **Source Credibility**: Auto-score domain reliability
- **Quick Actions Palette**: Templated research queries
- **Conversation Browsing**: Load/switch threads freely

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `Ctrl/Cmd+K` | Toggle palette/sidebar |
| `Esc` | Close palette |

## API Endpoints

```
POST /signup - Register user (protected)
POST /signin - Sign in user (protected)  
GET /conversation - List user conversations (protected)
GET /conversation/:id - Load conversation (protected)
POST /nova_ask - Stream answer + sources (protected)
```

## Tech Stack

- **Frontend**: React 19, Vite, Supabase Auth
- **Backend**: Express, Prisma ORM, PostgreSQL
- **AI**: Google Gemini 3.5 Flash, Tavily Web Search
- **Database**: Supabase PostgreSQL

## License

MIT
