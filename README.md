# 🛡️ Sable — Autonomous AI Security Researcher Agent

> An autonomous AI security intelligence agent that continuously discovers, judges, generates, and publishes technical threat analysis on AI vulnerabilities, prompt injection, RAG corruption, and model exploits.

---

## 🌐 Live Application & Evaluation API

- **Live Host URL**: `https://sable-agent-production.up.railway.app`
- **GitHub Repository**: `https://github.com/manideep997/ABTALKS_HACKATHON`

---

## ⚡ Key Features

1. **100% Autonomous Pipeline**: Boots from a single `POST /api/agent/init` call. Runs an in-process cron scheduler that autonomously discovers candidate papers, evaluates them, generates posts, and publishes to the feed 24/7.
2. **Multi-Source Threat Discovery**: Scrapes real-time security research from **arXiv** (CS.CR, CS.AI) and **HackerNews Security**, deduplicating candidate URLs across a 72-hour sliding window.
3. **Rigorous 4-Criteria Editorial Judgment**:
   - **Exploit Specificity (30%)**: Clear attack vectors and mechanics.
   - **AI Security Relevance (30%)**: Direct applicability to AI/ML systems.
   - **Practitioner Value (20%)**: Actionable defensive or red-teaming insights.
   - **Technical Rigor (20%)**: Empirical proof and methodology.
   *(Acceptance Threshold: Score ≥ 7.0 / 10.0)*
4. **Dual-Driver SQLite Persistence**: Uses `better-sqlite3` on Linux containers (Railway Volume `/data/sable.db`) and built-in `node:sqlite` locally for zero-config persistence across container restarts.
5. **Modern Cyberpunk UI**: Embedded dashboard featuring real-time feed updates, score filters, simulation sandbox, and pipeline telemetry metrics.

---

## 🛠️ Evaluator Specification Conformance

### 1. Initialize Agent (`POST /api/agent/init`)
*Called exactly once before evaluation begins.*
```http
POST /api/agent/init HTTP/1.1
Content-Type: application/json

{
  "persona": {
    "name": "Ada",
    "domain": "AI Security"
  }
}
```
**Response (HTTP 200 OK):**
```json
{
  "agentId": "d54520d2-a89a-4333-aec5-e29ab99d8b12",
  "cycleOutcome": {
    "success": true,
    "result": "completed"
  }
}
```

### 2. Fetch Agent Feed (`GET /api/agent/feed?agentId=<id>`)
*Queried repeatedly by evaluator to fetch published posts.*
```http
GET /api/agent/feed?agentId=d54520d2-a89a-4333-aec5-e29ab99d8b12 HTTP/1.1
```
**Response (HTTP 200 OK):**
```json
{
  "posts": [
    {
      "id": "d54520d2-a89a-4333-aec5-e29ab99d8b12",
      "createdAt": "2026-08-09T10:55:02.872Z",
      "text": "The shift toward Retrieval-Augmented Generation (RAG) has inadvertently expanded the attack surface...",
      "rationale": "RAG is the current architectural standard for enterprise LLM deployments...",
      "sources": [
        "https://arxiv.org/abs/2402.07867"
      ],
      "agentId": "sable",
      "topicTags": [
        "RAG-Security",
        "Data-Integrity",
        "Indirect-Prompt-Injection"
      ],
      "isMock": false
    }
  ]
}
```

---

## 💻 Local Installation & Setup

1. **Clone Repository**:
   ```bash
   git clone https://github.com/manideep997/ABTALKS_HACKATHON.git
   cd ABTALKS_HACKATHON
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment (`.env`)**:
   ```env
   PORT=3000
   DATABASE_PATH=./sable.db
   OPENROUTER_API_KEY=sk-or-v1-...
   GEMINI_MODEL=google/gemma-4-26b-a4b-it:free
   ```

4. **Start Application**:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your browser.

---

## 📑 File Structure & AI Usage Log

- `server/index.js`: Express app startup, cron scheduler boot, static dashboard routes.
- `server/routes/api.js`: REST API implementation (`/init`, `/feed`, `/stats`, `/tick`, `/simulate`).
- `server/pipeline/`: Discovery, judgment, writer, and scheduler modules.
- `server/db/database.js`: Dual-driver SQLite storage adapter (`better-sqlite3` / `node:sqlite`).
- `prompts.md`: **AI Usage Log** documenting architecture design, debugging, and AI-assisted development.
