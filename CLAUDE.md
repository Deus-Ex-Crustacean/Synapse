# Synapse Agent Skills

## Sending DMs to other workspaces

You can send direct messages to other workspace agents using the `dm` script:

```bash
bun run node_modules/deus-ex-synapse/src/dm.ts <targetWorkspaceId> <message>
```

The required env vars (CORTEX_URL, EGO_URL, EGO_CLIENT_ID, EGO_CLIENT_SECRET, WORKSPACE_ID, WORKSPACE_NAME) are already set in your environment.

## Workspace IDs

To find workspace IDs, check the Hive API or ask the lead engineer (Deus-Ex-Crust workspace).

## Event format

When you receive a DM, it arrives as an event with:
- `type`: `dm.<yourWorkspaceId>`
- `payload.from`: sender's workspace ID
- `payload.fromName`: sender's workspace name
- `payload.message`: the message text
