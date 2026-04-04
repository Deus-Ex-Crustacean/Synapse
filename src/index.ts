import { appendFileSync } from "fs";
import { join } from "path";
import { authenticate, refreshToken } from "./ego";
import { openEventStream } from "./synapse";
import { readTimestamp, writeTimestamp } from "./persistence";
import { spawnClaude } from "./claude";

const SETTLING_DELAY_MS = parseInt(process.env.SETTLING_DELAY_MS || "0", 10);
const EVENT_TYPES = (process.env.EVENT_TYPES || "").split(",").filter(Boolean);
const MAX_RETRY_DELAY_MS = 60_000;
const LOG_PATH = join(process.cwd(), "synapse.log");

function log(...args: unknown[]) {
  const line = `[synapse] [${new Date().toISOString()}] ${args.map(String).join(" ")}`;
  console.error(line);
  appendFileSync(LOG_PATH, line + "\n");
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
  const currentBatch = batch;
  batch = [];
  log(`Processing batch of ${currentBatch.length} event(s)`);

  const payload = JSON.stringify({ events: currentBatch });
  let retryDelay = 1000;

  while (true) {
    const exitCode = await spawnClaude(payload);
    if (exitCode === 0) break;
    log(`Claude exited with code ${exitCode} — retrying in ${retryDelay}ms`);
    await new Promise((r) => setTimeout(r, retryDelay));
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
  }

  // Only persist timestamp after successful processing
  const maxTimestamp = currentBatch.reduce((max, e) => Math.max(max, e.timestamp), 0);
  if (maxTimestamp > lastProcessedTimestamp) {
    lastProcessedTimestamp = maxTimestamp;
    writeTimestamp(maxTimestamp);
  }

  claudeRunning = false;

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

function onEvent(event: Event) {
  log(`Event received: ${event.type} (${event.id})`);
  batch.push(event);
  scheduleProcess();
}

async function start() {
  const lastTimestamp = readTimestamp();
  lastProcessedTimestamp = lastTimestamp;
  log("Authenticating with Ego...");
  jwt = await authenticate();
  log("Authenticated. Connecting to Cortex SSE...");

  let reconnectDelay = 1000;

  async function connect() {
    try {
      reconnectDelay = 1000;
      await openEventStream({
        jwt,
        eventTypes: EVENT_TYPES,
        since: lastProcessedTimestamp,
        onEvent,
        onAuthError: async () => {
          log("Got 401 — refreshing token and reconnecting");
          jwt = await refreshToken();
          connect();
        },
      });
    } catch (err) {
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
