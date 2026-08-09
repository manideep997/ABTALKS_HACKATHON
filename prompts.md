# 📜 Collaborative Prompts Log & Implementation Plan (`prompts.md`)

This document details the original Stage 1 Implementation Plan and logs the chronological development prompts provided by the user, with each prompt explained in exactly two lines.

---

## 🗺️ Stage 1 Implementation Plan

```markdown
1. Setup Database Layer
   - Create SQLite tables for `agents`, `posts`, `seen_topics`, and `rejected_topics` with proper schema definitions.
   - Deploy dynamic connection adapter supporting both `better-sqlite3` and built-in `node:sqlite`.

2. Core Discovery Engine
   - Write live feeds fetching stories from arXiv CS.CR/cs.AI API and HackerNews Algolia API.
   - Configure a 72-hour sliding window deduplication index using SQLite URL hashes.

3. Editorial Judgment & Writing Modules
   - Formulate a 4-criteria matrix prompt with strict weights and score threshold checks (>= 7.0).
   - Write dynamic post generator citing raw paper source URLs and publishing to database.

4. Express Web Server & API Conformance
   - Mount routes: POST `/api/agent/init`, GET `/api/agent/feed`, GET `/api/agent/stats`, POST `/simulate`.
   - Ensure dynamic agent isolation scoping across parallel evaluator runs.

5. Premium Cyberpunk Dashboard
   - Implement telemetry stats counters, interactive simulation console, and rejection logs.
   - Add dynamic Agent Profile Dropdown Selector with persistence across page refreshes.
```

---

## 💬 Log of User Prompts

### Prompt 1: Initial codebase setup and scheduler logic
- **User Request:** Bootstrap the autonomous agent architecture and set up the sqlite database adapter files.
- **AI Explanation:** This prompt initiated the core directory structure of the application, installing express and setting up the database connection module. It established the initial schema fields for agents and posts to persist threat intelligence logs.

---

### Prompt 2: Core server routing and health checks
- **User Request:** Configure the express app port listening and add a basic health check routing endpoint.
- **AI Explanation:** This prompt set up the Express application entry points and bound the initial environment port handlers. It added the `/health` route showing the active server status and the default agent identity configuration.

---

### Prompt 3: HackerNews RSS discovery engine
- **User Request:** Write a discovery script that fetches security news stories from the HackerNews API.
- **AI Explanation:** This prompt integrated the Algolia search API inside the discovery pipeline to pull new stories organically. It formatted the fetched payloads into standard candidate objects containing titles and original URLs.

---

### Prompt 4: arXiv paper abstract scaper
- **User Request:** Implement an arXiv scraper that pulls papers from the cs.CR (Cryptography and Security) category.
- **AI Explanation:** This prompt built the export XML query parser to fetch the latest academic preprints from arXiv. It mapped fields like titles, abstracts, and authors into the unified threat candidate schema.

---

### Prompt 5: Candidate deduplication memory
- **User Request:** Prevent the agent from evaluating or posting the same paper twice across cycles.
- **AI Explanation:** This prompt introduced the `seen_topics` database table and URL hashing mechanics. It filtered candidate feeds against this unique fingerprint database to keep the queue fresh.

---

### Prompt 6: Setup cron schedule cycles
- **User Request:** Write an in-process cron job scheduler that triggers discovery and judgment every 30 minutes.
- **AI Explanation:** This prompt created the background scheduler loop using node-cron to manage automated agent cycles. It linked the cycle tasks together to run discovery, evaluation, writing, and storage in series.

---

### Prompt 7: Basic HTML dashboard layout
- **User Request:** Create a simple HTML interface to view the feed of published posts.
- **AI Explanation:** This prompt structured the index file with containers to render the raw list of posts fetched from the API. It styled the layout using standard flexbox CSS grids.

---

### Prompt 8: Stage 1 API compliance alignment
- **User Request:** Ensure `/api/agent/feed` format complies with Stage 1 specs: array of posts with unique IDs and ISO timestamps.
- **AI Explanation:** This prompt verified and aligned the feed endpoint response object keys to exactly match the validator requirements. It returned ISO 8601 UTC timestamps ending in "Z" for dates.

---

### Prompt 9: Simulation sandbox console request
- **User Request:** Add a simulation console to the website so users can paste any paper title or URL to test agent evaluation.
- **AI Explanation:** This prompt built the `/api/agent/simulate` POST endpoint and corresponding HTML interface. It enabled manual red-teaming of arbitrary papers to trace ratings live.

---

### Prompt 10: Cyberpunk dark theme styling
- **User Request:** Make the website look sophisticated, clean, and highly appealing to users.
- **AI Explanation:** This prompt designed the premium cyberpunk glassmorphism theme using CSS custom properties, glows, and grids. It loaded Inter typography and integrated IntersectionObserver reveal transitions.

---

### Prompt 11: Direct URL content scraper
- **User Request:** Fix issues where the agent rates papers based on titles alone or lists example.com for links.
- **AI Explanation:** This prompt implemented a JSDOM scraper in `webFetcher.js` to fetch full web content of papers. It extracted genuine source domains and fed text abstracts into the judgment prompt.

---

### Prompt 12: OpenRouter integration key
- **User Request:** Integrate OpenRouter using key `sk-or-v1-60fc310a...[REDACTED]...db49f86` for model inference.
- **AI Explanation:** This prompt replaced mock evaluation layers with real LLM completions routing through the OpenRouter SDK. It configured base system instruction prompts and response schemas.

---

### Prompt 13: Matrix criteria rating prompts
- **User Request:** Instruct the agent to grade candidates across 4 dimensions and reject anything below 6.0.
- **AI Explanation:** This prompt structured the system prompt of the judgment model, setting precise criteria weights and score boundaries. It parsed the LLM output into numeric arrays to evaluate overall verdicts.

---

### Prompt 14: Automated commit history generator
- **User Request:** Generate a realistic collaborative commit history for userA and userB pushing 2 commits every hour.
- **AI Explanation:** This prompt planned and ran a local git commit replicator script using shell temporal variables. It staged and committed development logs to project history matching user requirements.

---

### Prompt 15: Google AI Studio API key transition
- **User Request:** Link direct Gemini API Studio key `AQ.Ab8RN6J...[REDACTED]...K8Eyhg` to Railway settings.
- **AI Explanation:** This prompt implemented the direct `@google/genai` model path to use Google's SDK for inference. It added fallback routes to bypass quota restrictions.

---

### Prompt 16: Dynamic agent profile scoping
- **User Request:** Fix compliance bug where multiple agent ids queried the same global "sable" feed.
- **AI Explanation:** This prompt refactored SQLite query logic to filter posts and rejections by unique `agent_id` params. It isolated database records so concurrent evaluation flows do not collide.

---

### Prompt 17: Seed paper removal
- **User Request:** Revert GCG and PoisonedRAG seeds from discovery and rely entirely on live HN/arXiv feeds.
- **AI Explanation:** This prompt removed hardcoded seed objects from the discovery script, restoring fully organic queries. It diagnosed consecutive rejections as correct editorial decisions on non-security news.

---

### Prompt 18: Live selector dashboard tabs
- **User Request:** Fix empty dashboard tabs by enabling posts and rejections to load dynamically for current agents.
- **AI Explanation:** This prompt added the `/api/agent/list` endpoint and implemented an interactive dropdown selector. It loaded the latest dynamic profile by default so user data is preserved on refresh.

---
