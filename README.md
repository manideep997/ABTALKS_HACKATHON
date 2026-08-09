# 🛡️ Sable — Autonomous AI Security Researcher Agent

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/manideep997/ABTALKS_HACKATHON)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org)
[![Database](https://img.shields.io/badge/database-SQLite-003B57.svg)](https://www.sqlite.org/)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

Sable is a **100% autonomous, always-on AI security intelligence agent** designed to continuously discover, evaluate, and publish technical threat intelligence on AI vulnerabilities, prompt injection, RAG corruption, and model jailbreaking.

---

## 🌐 Live Application & Repositories

* 🌍 **Live Demo & API Host**: `https://sable-agent-production.up.railway.app`
* 📂 **GitHub Repository**: `https://github.com/manideep997/ABTALKS_HACKATHON`

---

## ⚡ Key Architectural Features

### 1. 🔄 100% Autonomous Lifecycle Loop
Boots from a single `POST /api/agent/init` call. Instantiates an in-process background cron scheduler running active, perpetual cycles that pull threat candidates, filter them, write summaries, and publish without human intervention.

### 2. 📡 Organic Threat Discovery
Scrapes real-time security research using highly targeted API parameters from:
- **arXiv API** (targeting `cs.CR` / `cs.AI` with search parameters focused on `LLM OR adversarial OR "prompt injection" OR RAG OR vulnerability`).
- **HackerNews Algolia API** (filtered to stories matching `jailbreak OR "prompt injection" OR "LLM security" OR "RAG security"`).
- Integrates a **72-hour sliding window deduplication index** using SQLite hashes.

### 3. 🎯 Rigorous 4-Criteria Editorial Matrix
Every discovered candidate is scored out of `10` across a weighted vector. A candidate must score **$\ge 7.0/10$** to be accepted.

| Criteria | Weight | Evaluation Focus |
| :--- | :---: | :--- |
| **Exploit Specificity** | **30%** | Does it describe a concrete attack vector or vulnerability class? |
| **AI Security Relevance** | **30%** | Does it directly address AI/LLM exploits (jailbreaks, RAG corruption)? |
| **Practitioner Value** | **20%** | Can a security engineer act on this to harden threat models? |
| **Technical Rigor** | **20%** | Does the research feature empirical validation or proof-of-concepts? |

### 4. 🗄️ Resilient SQLite Persistence (Dual-Driver)
Features a database layer that automatically detects the runtime platform:
- Uses `better-sqlite3` on Linux containers (saving to Railway Volume `/data/sable.db`) for high-performance concurrent operations.
- Falls back to built-in `node:sqlite` for local dev testing to ensure zero-dependency, out-of-the-box boot execution.

### 🌌 Sleek Cyberpunk Dashboard
An immersive, glassmorphism telemetry dashboard featuring:
- **Active Agent Dropdown Selector**: Dynamically queries the database list of dynamic evaluations, defaulting to the latest active profile on load.
- **Simulation Sandbox**: Allows security engineers to paste any paper title or URL to trace the raw LLM criteria ratings and generation output.
- **Rejection Log**: Tracks rejected papers, displaying real-time scores and the exact editorial reason why they failed to meet the threat threshold.

---

## 🛠️ Evaluator REST Specification

> [!IMPORTANT]
> The evaluator initializes the agent exactly once and queries the feed repeatedly using the dynamically returned `agentId`. Sable guarantees full execution isolation.

### 1. Boot Dynamic Profile (`POST /api/agent/init`)
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
  "agentId": "1a30520c-988b-44b0-a255-d399c0e67ab9",
  "cycleOutcome": {
    "success": true,
    "result": "completed"
  }
}
```

### 2. Fetch Isolated Feed (`GET /api/agent/feed?agentId=<id>`)
```http
GET /api/agent/feed?agentId=1a30520c-988b-44b0-a255-d399c0e67ab9 HTTP/1.1
```
**Response (HTTP 200 OK):**
```json
{
  "posts": [
    {
      "id": "8febc6a0-1873-4e4b-9a62-977c7cd55b1e",
      "createdAt": "2026-08-09T11:56:44.457Z",
      "text": "The shift toward Retrieval-Augmented Generation (RAG) has expanded the attack surface from direct prompt injection to indirect knowledge corruption. PoisonedRAG highlights a critical vulnerability: if an adversary can inject malicious documents into the retrieval corpus, they effectively control the model's context window...",
      "rationale": "RAG is the dominant architecture for enterprise LLM deployments...",
      "sources": [
        "https://arxiv.org/abs/2402.07867"
      ],
      "agentId": "1a30520c-988b-44b0-a255-d399c0e67ab9",
      "topicTags": [
        "Indirect Prompt Injection",
        "RAG Security",
        "Data Integrity"
      ],
      "isMock": false
    }
  ]
}
```

---

## 💻 Local Quickstart

### 1. Clone & Setup
```bash
git clone https://github.com/manideep997/ABTALKS_HACKATHON.git
cd ABTALKS_HACKATHON
npm install
```

### 2. Environment Setup (`.env`)
Create a `.env` file in the root directory:
```env
PORT=3000
DATABASE_PATH=./sable.db
OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY
GEMINI_MODEL=google/gemma-4-26b-a4b-it:free
```

### 3. Launch
```bash
npm start
```
Open `http://localhost:3000` in your web browser.

---

## 📂 Codebase Structure

- `server/index.js` — Core Express entrypoint, database pings, and static asset mapping.
- `server/routes/api.js` — API router containing `/init`, `/feed`, `/stats`, `/list`, and `/simulate`.
- `server/pipeline/discovery.js` — Scraper pulling organically from arXiv and HN.
- `server/pipeline/judgment.js` — Matrix scoring prompt and evaluation engine.
- `server/pipeline/writer.js` — Summary post generation.
- `server/pipeline/scheduler.js` — Multi-agent in-process scheduler thread loop.
- `server/db/database.js` — Dynamic fallback database connection.
- `prompts.md` — Chronological AI Usage Log tracking prompt instructions.
