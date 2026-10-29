# GDenAI

GDenAI is a source-grounded study assistant. Students upload lecture
materials, ask questions about those materials, inspect page-level sources,
and generate quizzes from individual documents.

## License

This project is licensed under the [Apache License 2.0](LICENSE).

The project has two independently deployed parts:

- **Frontend:** a framework-free static web app in `frontend/`, deployed to
  GitHub Pages by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
- **Backend:** a FastAPI service in `backend/`, deployed separately to a
  Python host such as Render.

## Features

- Upload PDF, DOCX, and TXT study materials.
- Extract and chunk document text for retrieval.
- Ask questions using retrieval-augmented generation (RAG).
- Stream answers through Server-Sent Events (SSE).
- Display source filenames, page numbers, and snippets.
- Generate validated multiple-choice quizzes.
- Export a conversation as a plain-text file.

## Architecture and request flow

1. The frontend creates a UUID and stores it in the browser's `localStorage`
   as `gdenai_session_id`.
2. The UUID is sent to the backend in the `X-Session-Id` header on every
   document, query, chat, and quiz request.
3. On upload, the backend validates the extension and size, extracts text,
   and splits each page into 500-word chunks with a 50-word overlap.
4. FastEmbed creates a normalized vector for each chunk. FAISS stores those
   vectors in an in-memory inner-product index for the session.
5. For a question, the backend embeds the question and retrieves the most
   similar chunks above `SIMILARITY_THRESHOLD`, up to `TOP_K` results.
6. The retrieved context and recent chat history are sent to the configured
   OpenAI-compatible LLM provider.
7. `/chat` streams answer tokens, then source metadata, then a completion
   event to the browser.

The browser never receives the LLM API key. It only communicates with the
backend.

## Model choice: Qwen 3.8 27B

GDenAI is configured to use `qwen/qwen3.8-27b` through an OpenAI-compatible
provider by default. Qwen 3.8 27B was chosen primarily because of its large
context window and open-weight availability. Its ability to process large
amounts of text makes it suitable for a RAG system, where relevant passages
retrieved from students' study materials are supplied as context for
generating answers.

Its open-weight availability also provides greater flexibility in model
selection, deployment options, and customization than relying exclusively on
proprietary models. These characteristics make it a suitable candidate for
GDenAI's goal of providing context-aware academic assistance.

The model is not a guarantee of correctness. Potential limitations include:

- **Retrieval accuracy:** model performance depends on the RAG system
  retrieving the correct passages. If relevant information is missed, the
  model may not have enough context to answer accurately.
- **Hallucinations:** Qwen may generate incorrect or unsupported answers even
  when relevant study material is supplied. Users should verify answers
  against the displayed sources.
- **Long-context latency and cost:** processing larger contexts can increase
  response time and computational cost, which may affect the user experience
  for lengthy academic documents.
- **Provider behavior:** rate limits, availability, model configuration, and
  latency also depend on the selected OpenAI-compatible provider.

The backend prompt instructs the model to answer from the supplied study
documents, but source citations should be treated as verification aids, not
proof that every generated statement is correct.

## Requirements

- Python 3.10 or newer
- An API key for an OpenAI-compatible LLM provider
- A modern browser with `localStorage`, `crypto.randomUUID()`, `fetch`, and
  streaming response support
- A static web server for local frontend development

The FastEmbed embedding model is downloaded on first backend startup.

## Local development

### 1. Start the backend

From `backend/`:

```bash
python -m venv .venv
```

Activate the environment:

```bash
# macOS/Linux
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1
```

Install dependencies and create the environment file:

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
```

On macOS/Linux, use `cp .env.example .env` instead of `copy`.

Edit `backend/.env`:

```dotenv
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=your_provider_api_key
LLM_MODEL=qwen/qwen3.8-27b
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
TOP_K=5
SIMILARITY_THRESHOLD=0.25
SESSION_TTL_MINUTES=45
FRONTEND_URL=http://localhost:8080
```

Start the API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend is available at <http://localhost:8000>. Interactive API
documentation is at <http://localhost:8000/docs>, and the health check is at
<http://localhost:8000/health>.

Run backend tests from `backend/`:

```bash
pytest
```

### 2. Start the frontend

Set `ENVIRONMENT` to `local` in [`frontend/js/config.js`](frontend/js/config.js):

```js
ENVIRONMENT: 'local'
```

Then, from `frontend/`, start a static server:

```bash
python -m http.server 8080
```

Open <http://localhost:8080>.

The frontend validates uploads before sending them, caches the document
summary locally, and synchronizes it with the backend when a page loads.
Backend sessions still expire independently.

## Configuration

### Backend environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LLM_BASE_URL` | Yes | — | OpenAI-compatible provider base URL. |
| `LLM_API_KEY` | Yes | — | Provider credential; keep it secret. |
| `LLM_MODEL` | Yes | — | Chat model, for example `qwen/qwen3.8-27b`. |
| `EMBEDDING_MODEL` | No | `BAAI/bge-small-en-v1.5` | Local FastEmbed model. |
| `TOP_K` | No | `5` | Maximum retrieved chunks for chat. |
| `SIMILARITY_THRESHOLD` | No | `0.25` | Minimum retrieval similarity. |
| `SESSION_TTL_MINUTES` | No | `45` | Inactivity period before cleanup. |
| `FRONTEND_URL` | Yes | — | Comma-separated allowed CORS origins. |

### Frontend configuration

In [`frontend/js/config.js`](frontend/js/config.js):

```js
USE_MOCK_DATA: false,
ENVIRONMENT: 'live',
API_URLS: {
    LOCAL: 'http://localhost:8000',
    LIVE: 'https://gdenai.onrender.com'
}
```

Set `ENVIRONMENT` to `local` during local development and `live` for the
deployed frontend. Update `API_URLS.LIVE` if the backend uses another
hostname. Never put API keys in frontend files.

`USE_MOCK_DATA: true` is available for a UI-only demo; it does not test
document extraction, retrieval, LLM calls, or CORS.

## API overview

All document, query, chat, and quiz requests require:

```http
X-Session-Id: <client-generated-uuid>
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Returns `{"status":"ok"}`. |
| `POST` | `/documents` | Upload one file as multipart field `file`. |
| `GET` | `/documents` | List documents in the current session. |
| `DELETE` | `/documents/{document_id}` | Delete one document. |
| `DELETE` | `/session` | Delete the current session. |
| `POST` | `/query` | Return a non-streaming answer and sources. |
| `POST` | `/chat` | Stream an answer and sources using SSE. |
| `POST` | `/quiz` | Generate questions for one document. |

Limits:

- PDF, DOCX, and TXT files only
- Maximum 10 MiB per file
- Maximum 5 documents per session
- Quiz requests contain 1–20 questions

The `/chat` endpoint emits:

```text
data: {"type":"token","text":"..."}
data: {"type":"sources","sources":[...]}
data: {"type":"done"}
```

## Deployment

### Frontend: GitHub Pages

The included workflow deploys `frontend/` on every push to `main`.

1. In `frontend/js/config.js`, set `ENVIRONMENT: 'live'`.
2. Set `API_URLS.LIVE` to the public backend URL.
3. In GitHub, enable **Settings → Pages → GitHub Actions**.
4. Push to `main` and wait for the **Deploy Frontend to GitHub Pages**
   workflow.
5. Set the backend `FRONTEND_URL` to the exact Pages origin, for example
   `https://<owner>.github.io` or
   `https://<owner>.github.io/<repository>`.

GitHub Pages serves the static files directly and does not run a build step.

### Backend: Render or another Python host

Create a web service using `backend/` as its root:

- **Build command:** `pip install -r requirements.txt`
- **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Configure the required LLM variables and set `FRONTEND_URL` to the deployed
frontend origin. Confirm deployment with `GET /health`.

The backend must use HTTPS in production and expose `$PORT`. If frontend and
backend are on different origins, the CORS origin must match exactly,
including the scheme and port where applicable. Multiple origins may be
provided as a comma-separated value.

## Important operational limitations

The current backend stores sessions, extracted text, embeddings, and FAISS
indexes only in process memory:

- A session expires after `SESSION_TTL_MINUTES` of inactivity.
- A process restart or redeployment removes all uploaded materials.
- Multiple backend instances do not share sessions.
- Memory usage increases with the number and size of uploaded documents.

For durable production use, add persistent document storage, a shared vector
database, and a shared session store before enabling multiple instances.

## Repository structure

```text
gdenai/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI routes, RAG, streaming, and quiz logic
│   │   ├── config.py        # Environment-backed settings
│   │   ├── dependencies.py  # Session header validation
│   │   ├── documents.py     # File extraction and chunking
│   │   ├── prompts.py       # Chat and quiz prompts
│   │   ├── schemas.py       # Request and response models
│   │   └── store.py         # In-memory sessions and FAISS indexes
│   ├── tests/test_api.py
│   ├── .env.example
│   └── requirements.txt
├── frontend/
│   ├── index.html           # Overview page
│   ├── documents.html       # Material management
│   ├── chat.html            # Streaming chat interface
│   ├── css/style.css
│   └── js/                  # Configuration, API, state, UI, and validation
└── .github/workflows/
    └── deploy.yml           # GitHub Pages deployment
```

## Troubleshooting

- **CORS errors:** verify `FRONTEND_URL` exactly matches the browser origin
  and restart the backend after changing it.
- **No documents after reload:** the backend session may have expired or
  restarted; upload the materials again.
- **Unsupported or empty document:** confirm the file is PDF, DOCX, or TXT and
  contains extractable text.
- **Answer is not found:** retrieval may not have selected the relevant
  passage; try a more specific question or adjust retrieval settings.
- **Live requests go to localhost:** confirm `ENVIRONMENT` is `live` and
  inspect `API_URLS.LIVE`.
- **SSE appears stalled:** configure the reverse proxy to allow streaming
  responses.
