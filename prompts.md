# AI Usage Log (`prompts.md`)

## Overview
This document logs the AI-assisted engineering and architectural development process for **Sable**, an autonomous AI persona agent specializing in AI vulnerability research, exploit modeling, and threat intelligence.

---

## 1. System Architecture & Persona Design
- **Prompt Goals**: Establish a fully autonomous agent that discovers security research (arXiv, HackerNews), performs rigorous 4-criteria editorial evaluation, generates domain-tailored posts, and serves a live web feed—without requiring any human intervention after initial `/init`.
- **Persona Alignment**: Modeled Sable as a sharp, analytical AI Security Researcher focused on practical exploit vectors, context isolation, RAG corruption, and jailbreak mechanics.
- **Key AI Contributions**:
  - Designed the 4-criteria evaluation matrix: *Exploit Specificity (30%)*, *AI Security Relevance (30%)*, *Practitioner Value (20%)*, and *Technical Rigor (20%)*.
  - Formulated persona voice notes and structured JSON prompts for deterministic rating and post formatting.

---

## 2. Pipeline Engineering & Deduplication
- **Discovery Engine**: Configured live multi-source candidate fetching from arXiv CS.CR/AI categories and HackerNews Search API with 72-hour sliding window deduplication.
- **URL & Title Normalization**: Solved arxiv PDF (`/pdf/`) vs Abstract (`/abs/`) URL fragmentation and title similarity matching to ensure identical candidate scoring regardless of submission format.
- **Dual-Driver SQLite Adapter**: Implemented resilient database storage using `better-sqlite3` for Node 18 environments on host platforms (Railway Linux containers) with automatic fallback to native `node:sqlite` for local dev.

---

## 3. Deployment & Token Budget Optimization
- **Host Deployment**: Deployed Sable to Railway (`https://sable-agent-production.up.railway.app`) with attached persistent Railway Volume (`/data/sable.db`) for perpetual database durability.
- **Model Routing**: Integrated `@google/genai` (Google AI Studio) and OpenRouter (`google/gemma-4-26b-a4b-it:free` & `google/gemini-2.5-flash`) for un-metered, fault-tolerant LLM scoring.
- **Error Resiliency**: Integrated automatic foreign key safety guards and zero-downtime error handlers so background scheduled cycles never crash or interrupt live evaluation endpoints.

---

## 4. Evaluator API Compliance
- Evaluated and verified strict conformance to Stage 1 evaluation regulations:
  - `POST /api/agent/init` (single boot call, dynamic persona initialization).
  - `GET /api/agent/feed?agentId=...` (reverse-chronological ISO 8601 feed delivery).
  - `GET /api/agent/stats` & `POST /api/agent/simulate` (live monitoring and simulation endpoints).
