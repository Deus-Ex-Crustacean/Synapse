#!/usr/bin/env bun
// Usage: dm <targetWorkspaceId> <message>
// Sends a DM event to another workspace via Cortex
// Requires EGO_URL, EGO_CLIENT_ID, EGO_CLIENT_SECRET, CORTEX_URL env vars

const CORTEX_URL = process.env.CORTEX_URL;
const EGO_URL = process.env.EGO_URL;
const EGO_CLIENT_ID = process.env.EGO_CLIENT_ID;
const EGO_CLIENT_SECRET = process.env.EGO_CLIENT_SECRET;
const WORKSPACE_ID = process.env.WORKSPACE_ID;
const WORKSPACE_NAME = process.env.WORKSPACE_NAME;

if (!CORTEX_URL || !EGO_URL || !EGO_CLIENT_ID || !EGO_CLIENT_SECRET) {
  console.error("Missing required env vars");
  process.exit(1);
}

const WORKSPACE_NAMES: Record<string, string> = {
  "6759de93-0863-4dfb-b1aa-eef4c668698a": "Ego",
  "55bba2ea-c3cf-4119-bd34-bc30e639abef": "Cortex",
  "d8e5d32c-206b-4a40-9019-d08aadcf5606": "Hive",
  "c35f3be1-bffe-499b-8466-a76cedcb9e72": "Synapse",
  "893ad240-5441-46c8-8dc3-3afa195f1130": "Sensory",
  "fcfd9446-ca12-4758-aaea-4179a6ad33b1": "Mind",
  "0dd15e8b-e4c5-4288-bea1-5a9b64c92c39": "Deus-Ex-Crust",
  "995f7854-cb32-40d7-89e2-94e9cca974b4": "LDExpert",
};

const targetId = process.argv[2];
const message = process.argv.slice(3).join(" ");
const targetName = WORKSPACE_NAMES[targetId] || targetId;

if (!targetId || !message) {
  console.error("Usage: dm <targetWorkspaceId> <message>");
  process.exit(1);
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

// Publish DM event
const res = await fetch(`${CORTEX_URL}/publish`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    type: `dm.${targetId}`,
    from: WORKSPACE_ID,
    fromName: WORKSPACE_NAME || EGO_CLIENT_ID,
    message,
  }),
});

if (!res.ok) {
  console.error("Publish failed:", res.status, await res.text());
  process.exit(1);
}

process.stdout.write(`◀ [DM to ${targetId}] ${message}\n`);
console.error(`DM sent to ${targetId}`);

// Write to conversation.json
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
const CONVERSATION_PATH = join(process.cwd(), "conversation.json");
let conversation: unknown[] = [];
try { conversation = JSON.parse(readFileSync(CONVERSATION_PATH, "utf-8")); } catch {}
conversation.push({
  timestamp: Date.now(),
  type: "dm",
  from: WORKSPACE_NAME || EGO_CLIENT_ID,
  message: `To ${targetName}: ${message}`,
});
try { writeFileSync(CONVERSATION_PATH, JSON.stringify(conversation, null, 2) + "\n"); } catch {}
