import { appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { authenticate, refreshToken } from "./ego";
import { openEventStream } from "./synapse";
import { readTimestamp, writeTimestamp } from "./persistence";
import { spawnClaude, type ClaudeResult } from "./claude";

const SETTLING_DELAY_MS = parseInt(process.env.SETTLING_DELAY_MS || "0", 10);
const EVENT_TYPES = (process.env.EVENT_TYPES || "").split(",").filter(Boolean);
const MAX_RETRY_DELAY_MS = 60_000;
const LOG_PATH = join(process.cwd(), "synapse.log");
const STATUS_PATH = join(process.cwd(), "synapse.status");

// States: "connecting" | "idle" | "running" | "error"
function setStatus(status: string) {
  try { writeFileSync(STATUS_PATH, status); } catch {}
}

function log(...args: unknown[]) {
  const line = `[synapse] [${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.error(line);
  appendFileSync(LOG_PATH, line + "\n");
}

function parseRateLimitWait(output: string): number | null {
  const match = output.match(/resets\s+(\d+)(am|pm)\s+\((.+?)\)/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const ampm = match[2].toLowerCase();
  const tz = match[3];

  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  // Build a date string for today at the reset hour in the given timezone
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const resetDate = new Date(`${todayStr}T${String(hour).padStart(2, "0")}:00:00`);

  // Convert to the target timezone by computing the offset
  const resetInTz = new Date(resetDate.toLocaleString("en-US", { timeZone: tz }));
  const resetUtc = new Date(resetDate.getTime() + (resetDate.getTime() - resetInTz.getTime()));

  let waitMs = resetUtc.getTime() - now.getTime();
  // If the reset time appears to be in the past, assume it's tomorrow
  if (waitMs < 0) waitMs += 24 * 60 * 60 * 1000;
  // Add a small buffer
  waitMs += 60_000;

  log(`Rate limit detected — reset at ${hour}:00 ${ampm} (${tz}), waiting ${Math.round(waitMs / 60000)}m`);
  return waitMs;
}

interface Event {
  id: string;
  source: string;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

let batch: Event[] = [];
let settlingTimer: ReturnType<typeof setTimeout> | null = null;
let claudeRunning = false;
let jwt: string;
let lastProcessedTimestamp = 0;

async function processBatch() {
  if (batch.length === 0 || claudeRunning) return;

  claudeRunning = true;
  setStatus("running");
  const currentBatch = batch;
  batch = [];
  const eventTypes = currentBatch.map(e => e.type).join(", ");
  log(`Processing batch of ${currentBatch.length} event(s): ${eventTypes}`);

  const payload = JSON.stringify({ events: currentBatch });
  let retryDelay = 1000;

  while (true) {
    log("Spawning Claude...");
    const startTime = Date.now();
    const result = await spawnClaude(payload);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (result.exitCode === 0) {
      log(`Claude finished successfully in ${elapsed}s`);
      break;
    }

    const waitMs = parseRateLimitWait(result.output) ?? retryDelay;
    log(`Claude exited with code ${result.exitCode} after ${elapsed}s — retrying in ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  // Only persist timestamp after successful processing
  const maxTimestamp = currentBatch.reduce((max, e) => Math.max(max, e.timestamp), 0);
  if (maxTimestamp > lastProcessedTimestamp) {
    lastProcessedTimestamp = maxTimestamp;
    writeTimestamp(maxTimestamp);
  }

  claudeRunning = false;
  setStatus("idle");

  if (batch.length > 0) {
    await processBatch();
  }
}

function scheduleProcess() {
  if (settlingTimer) clearTimeout(settlingTimer);
  if (SETTLING_DELAY_MS > 0) {
    settlingTimer = setTimeout(processBatch, SETTLING_DELAY_MS);
  } else {
    processBatch();
  }
}

function printEventMessage(event: Event) {
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
  if (!payload?.message) return;

  if (payload.fromName) {
    process.stdout.write(`▶ ${payload.fromName}: ${payload.message}\n`);
  } else if (event.type.startsWith("message.")) {
    process.stdout.write(`▶ You: ${payload.message}\n`);
  }
}

function onEvent(event: Event) {
  log(`Event received: ${event.type} (${event.id})`);
  printEventMessage(event);
  batch.push(event);
  scheduleProcess();
}

async function start() {
  const lastTimestamp = readTimestamp();
  lastProcessedTimestamp = lastTimestamp;
  setStatus("connecting");
  log("Authenticating with Ego...");
  jwt = await authenticate();
  log("Authenticated. Connecting to Cortex SSE...");

  let reconnectDelay = 1000;

  async function connect() {
    try {
      setStatus("connecting");
      reconnectDelay = 1000;
      await openEventStream({
        jwt,
        eventTypes: EVENT_TYPES,
        since: lastProcessedTimestamp,
        onEvent,
        onConnected: () => setStatus("idle"),
        onAuthError: async () => {
          log("Got 401 — refreshing token and reconnecting");
          jwt = await refreshToken();
          connect();
        },
      });
    } catch (err) {
      setStatus("error");
      log("SSE connection error:", err);
      log(`Reconnecting in ${reconnectDelay}ms...`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RETRY_DELAY_MS);
    }
  }

  await connect();
}

start().catch((err) => {
  log("Fatal:", err);
  process.exit(1);
});
