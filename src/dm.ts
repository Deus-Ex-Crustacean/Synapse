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

const targetId = process.argv[2];
const message = process.argv.slice(3).join(" ");

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
