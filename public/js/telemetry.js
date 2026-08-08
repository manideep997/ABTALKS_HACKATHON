/* telemetry.js — API client for Sable dashboard */
'use strict';

const API_BASE = '/api/agent';

const Telemetry = {
  async getFeed() {
    const r = await fetch(`${API_BASE}/feed`);
    return r.json();
  },
  async getRejections() {
    const r = await fetch(`${API_BASE}/rejections`);
    return r.json();
  },
  async getStats() {
    const r = await fetch(`${API_BASE}/stats`);
    return r.json();
  },
  async simulate({ title, snippet, url }) {
    const r = await fetch(`${API_BASE}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, snippet, url }),
    });
    return r.json();
  },
  async initAgent() {
    const r = await fetch(`${API_BASE}/init`, { method: 'POST' });
    return r.json();
  },
  async triggerTick() {
    const r = await fetch(`${API_BASE}/tick`, { method: 'POST' });
    return r.json();
  },
};
