import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { init } from "@launchdarkly/node-server-sdk";
import { Observability } from "@launchdarkly/observability-node";
import { authenticate, refreshToken } from "./ego";
import { openEventStream } from "./synapse";
import { readTimestamp, writeTimestamp } from "./persistence";
import { spawnClaude, type ClaudeResult, type ClaudeHandle } from "./claude";

const ldClient = init(process.env.LD_SDK_KEY || "", {
  plugins: [
    new Observability({
      serviceName: "synapse",
      serviceVersion: process.env.npm_package_version || "dev",
      environment: "production",
      consoleMethodsToRecord: ["warn", "error"],
    }),
  ],
});
ldClient.on("ready", () => log("LaunchDarkly client ready"));
ldClient.on("failed", (err) => log("LaunchDarkly client failed:", err));

const SETTLING_DELAY_MS = parseInt(process.env.SETTLING_DELAY_MS || "0", 10);
const MIN_RUN_INTERVAL_MS = parseInt(process.env.MIN_RUN_INTERVAL_MS || "0", 10);
const EVENT_TYPES = (process.env.EVENT_TYPES || "").split(",").filter(Boolean);
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_RATE_LIMIT_DELAY_MS = 1_200_000;
const LOG_PATH = join(process.cwd(), "synapse.log");
const STATUS_PATH = join(process.cwd(), "synapse.status");
const CONVERSATION_PATH = join(process.cwd(), "conversation.json");
const WORKSPACE_NAME = process.env.WORKSPACE_NAME || "Synapse";

interface ConversationEntry {
  timestamp: number;
  type: "prompt" | "dm" | "response" | "system";
  from: string;
  message: string;
}

let conversation: ConversationEntry[] = [];

function loadConversation() {
  try {
    conversation = JSON.parse(readFileSync(CONVERSATION_PATH, "utf-8"));
  } catch {
    conversation = [];
  }
}

function addConversationEntry(entry: ConversationEntry) {
  conversation.push(entry);
  try { writeFileSync(CONVERSATION_PATH, JSON.stringify(conversation, null, 2) + "\n"); } catch {}
}

// States: "connecting" | "idle" | "running" | "error"
function setStatus(status: string) {
  try { writeFileSync(STATUS_PATH, status); } catch {}
}

function readStatus(): string {
  try { return readFileSync(STATUS_PATH, "utf-8").trim(); } catch { return ""; }
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

const WORKSPACE_ID = process.env.WORKSPACE_ID || "";

let batch: Event[] = [];
let settlingTimer: ReturnType<typeof setTimeout> | null = null;
let claudeRunning = false;
let currentClaudeHandle: ClaudeHandle | null = null;
let backoffResolve: (() => void) | null = null;
let jwt: string;
let lastProcessedTimestamp = 0;
let lastRunEndTime = 0;

async function processBatch() {
  if (batch.length === 0 || claudeRunning) return;

  claudeRunning = true;
  setStatus("running");
  const currentBatch = batch;
  batch = [];
  const eventTypes = currentBatch.map(e => e.type).join(", ");
  log(`Processing batch of ${currentBatch.length} event(s): ${eventTypes}`);
  const statusMsg = currentBatch.length === 1 ? "Thinking..." : `Processing ${currentBatch.length} messages...`;
  addConversationEntry({ timestamp: Date.now(), type: "system", from: "system", message: statusMsg });

  const payload = JSON.stringify({ events: currentBatch });
  let retryDelay = 1000;

  while (true) {
    log("Spawning Claude...");
    const startTime = Date.now();
    const handle = spawnClaude(payload);
    currentClaudeHandle = handle;
    const result = await handle.result;
    currentClaudeHandle = null;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (result.exitCode === 0) {
      log(`Claude finished successfully in ${elapsed}s`);
      if (result.output.trim()) {
        addConversationEntry({ timestamp: Date.now(), type: "response", from: WORKSPACE_NAME, message: result.output.trim() });
      }
      addConversationEntry({ timestamp: Date.now(), type: "system", from: "system", message: `Completed in ${elapsed}s` });
      break;
    }

    const rateLimitWait = parseRateLimitWait(result.output);
    const waitMs = rateLimitWait ?? retryDelay;
    const maxDelay = rateLimitWait ? MAX_RATE_LIMIT_DELAY_MS : MAX_RETRY_DELAY_MS;
    log(`Claude exited with code ${result.exitCode} after ${elapsed}s — retrying in ${Math.round(waitMs / 1000)}s`);
    await new Promise<void>((r) => {
      backoffResolve = r;
      setTimeout(() => { backoffResolve = null; r(); }, waitMs);
    });
    retryDelay = Math.min(retryDelay * 2, maxDelay);
  }

  // Only persist timestamp after successful processing
  const maxTimestamp = currentBatch.reduce((max, e) => Math.max(max, e.timestamp), 0);
  if (maxTimestamp > lastProcessedTimestamp) {
    lastProcessedTimestamp = maxTimestamp;
    writeTimestamp(maxTimestamp);
  }

  lastRunEndTime = Date.now();
  claudeRunning = false;
  setStatus("idle");

  if (batch.length > 0) {
    if (MIN_RUN_INTERVAL_MS > 0) {
      const sinceLast = Date.now() - lastRunEndTime;
      const remaining = MIN_RUN_INTERVAL_MS - sinceLast;
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
    }
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
  if (!event.type.startsWith("dm.")) return;
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
  if (!payload?.message || !payload?.fromName) return;
  process.stdout.write(`▶ ${payload.fromName}: ${payload.message}\n`);
}

function logConversationEvent(event: Event) {
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
  if (!payload?.message) return;
  if (event.type.startsWith("prompt.")) {
    addConversationEntry({ timestamp: event.timestamp, type: "prompt", from: "user", message: payload.message as string });
  } else if (event.type.startsWith("dm.")) {
    addConversationEntry({ timestamp: event.timestamp, type: "dm", from: (payload.fromName as string) || "unknown", message: payload.message as string });
  }
}

async function handleEmergency(event: Event) {
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
  const message = (payload?.message as string) || "Unknown emergency";
  log(`EMERGENCY INTERRUPT: ${message}`);
  addConversationEntry({ timestamp: Date.now(), type: "system", from: "system", message: `Emergency: ${message}` });

  // Kill current Claude process if running
  if (currentClaudeHandle) {
    log("Killing current Claude process for emergency");
    currentClaudeHandle.kill();
    currentClaudeHandle = null;
  }

  if (settlingTimer) { clearTimeout(settlingTimer); settlingTimer = null; }

  // Get recent log context
  let recentLog = "";
  try {
    const logContent = readFileSync(LOG_PATH, "utf-8");
    recentLog = logContent.split("\n").slice(-50).join("\n");
  } catch {}

  const emergencyPrompt = `EMERGENCY INTERRUPT from user: ${message}\n\nRecent log:\n${recentLog}\n\nDrop what you were doing and address this emergency immediately.`;

  claudeRunning = true;
  setStatus("running");
  const handle = spawnClaude(emergencyPrompt);
  currentClaudeHandle = handle;
  const result = await handle.result;
  currentClaudeHandle = null;

  if (result.output.trim()) {
    addConversationEntry({ timestamp: Date.now(), type: "response", from: WORKSPACE_NAME, message: result.output.trim() });
  }

  claudeRunning = false;
  setStatus("idle");

  if (batch.length > 0) {
    await processBatch();
  }
}

function onEvent(event: Event) {
  log(`Event received: ${event.type} (${event.id})`);

  if (event.type.startsWith("emergency.")) {
    handleEmergency(event);
    return;
  }

  printEventMessage(event);
  logConversationEvent(event);
  batch.push(event);

  // Cancel backoff timer if we're waiting to retry — new event means fresh context
  if (backoffResolve) {
    log("New event arrived — cancelling backoff and retrying immediately");
    backoffResolve();
    backoffResolve = null;
  }

  scheduleProcess();
}

async function start() {
  loadConversation();
  const previousStatus = readStatus();
  if (previousStatus === "running") {
    log("Previous instance was killed mid-execution — resuming Claude in background");
    addConversationEntry({ timestamp: Date.now(), type: "system", from: "system", message: "Resuming interrupted execution" });
    // Resume in background — don't block SSE connection
    (async () => {
      setStatus("running");
      claudeRunning = true;
      let recentLog = "";
      try {
        const logContent = readFileSync(LOG_PATH, "utf-8");
        recentLog = logContent.split("\n").slice(-100).join("\n");
      } catch {}
      const resumePrompt = recentLog
        ? `You were interrupted mid-execution. Here is your recent log:\n\n${recentLog}\n\nIMPORTANT: You were in the middle of a task when you were killed. Do NOT just check state and stop. Do NOT announce you are back. Look at the log above, identify what task you were working on, and CONTINUE doing it. If you were sending DMs, send them. If you were writing code, write it. If you were waiting on something, check on it. Resume the actual work.`
        : "You were interrupted mid-execution. IMPORTANT: You were in the middle of a task when you were killed. Do NOT just check state and stop. Do NOT announce you are back. Identify what task you were working on and CONTINUE doing it. Resume the actual work.";
      const handle = spawnClaude(resumePrompt);
      currentClaudeHandle = handle;
      const result = await handle.result;
      currentClaudeHandle = null;
      if (result.exitCode === 0) {
        log("Resume completed successfully");
        if (result.output.trim()) {
          addConversationEntry({ timestamp: Date.now(), type: "response", from: WORKSPACE_NAME, message: result.output.trim() });
        }
      } else {
        log(`Resume exited with code ${result.exitCode}`);
        addConversationEntry({ timestamp: Date.now(), type: "system", from: "system", message: `Resume failed with exit code ${result.exitCode}` });
      }
      lastRunEndTime = Date.now();
      claudeRunning = false;
      setStatus("idle");
      log(`Resume done. ${batch.length} event(s) queued during resume.`);
      if (batch.length > 0) {
        await processBatch();
      }
    })();
  }

  const lastTimestamp = readTimestamp();
  lastProcessedTimestamp = lastTimestamp;
  setStatus("connecting");
  addConversationEntry({ timestamp: Date.now(), type: "system", from: "system", message: "Starting up and connecting to Cortex" });
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
