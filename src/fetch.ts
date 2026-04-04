#!/usr/bin/env bun
// Usage: bun run src/fetch.ts [--since <timestamp>]
// Fetches missed events from Cortex and prints message payloads to stdout.

import { readFileSync } from "fs";
import { join } from "path";

const CORTEX_URL = process.env.CORTEX_URL;
const EGO_URL = process.env.EGO_URL;
const EGO_CLIENT_ID = process.env.EGO_CLIENT_ID;
const EGO_CLIENT_SECRET = process.env.EGO_CLIENT_SECRET;

if (!CORTEX_URL || !EGO_URL || !EGO_CLIENT_ID || !EGO_CLIENT_SECRET) {
  console.error("Missing required env vars");
  process.exit(1);
}

// Parse --since flag or read from praxis.json
let since = 0;
const sinceIdx = process.argv.indexOf("--since");
if (sinceIdx !== -1 && process.argv[sinceIdx + 1]) {
  since = parseInt(process.argv[sinceIdx + 1], 10);
} else {
  try {
    const data = JSON.parse(readFileSync(join(process.cwd(), "praxis.json"), "utf-8"));
    since = data.last_timestamp ?? 0;
  } catch {}
}

// Authenticate
const tokenRes = await fetch(`${EGO_URL}/token`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: EGO_CLIENT_ID,
    client_secret: EGO_CLIENT_SECRET,
  }),
});

if (!tokenRes.ok) {
  console.error("Auth failed:", tokenRes.status);
  process.exit(1);
}

const { access_token } = (await tokenRes.json()) as { access_token: string };

// Fetch events via SSE
const url = `${CORTEX_URL}/events?${new URLSearchParams({ since: String(since) })}`;
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${access_token}` },
});

if (!res.ok) {
  console.error("Fetch failed:", res.status, await res.text());
  process.exit(1);
}

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
let silenceTimer: ReturnType<typeof setTimeout> | null = null;

function resetSilenceTimer() {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    reader.cancel();
  }, 2000);
}

resetSilenceTimer();

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    resetSilenceTimer();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
        if (payload?.message) {
          const sender = payload.fromName || event.type;
          console.log(`${sender}: ${payload.message}`);
        }
      } catch {}
    }
  }
} catch {
  // reader cancelled by silence timer
}

if (silenceTimer) clearTimeout(silenceTimer);
