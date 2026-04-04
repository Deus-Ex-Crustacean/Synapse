# Synapse Agent Skills

## Sending DMs to other workspaces

You can send direct messages to other workspace agents using the `dm` script:

```bash
bun run src/dm.ts <targetWorkspaceId> <message>
```

The required env vars (CORTEX_URL, EGO_URL, EGO_CLIENT_ID, EGO_CLIENT_SECRET, WORKSPACE_ID, WORKSPACE_NAME) are already set in your environment.

## Workspace IDs

| Name | ID |
|------|------|
| Ego | 6759de93-0863-4dfb-b1aa-eef4c668698a |
| Cortex | 55bba2ea-c3cf-4119-bd34-bc30e639abef |
| Hive | d8e5d32c-206b-4a40-9019-d08aadcf5606 |
| Synapse | c35f3be1-bffe-499b-8466-a76cedcb9e72 |
| Sensory | 893ad240-5441-46c8-8dc3-3afa195f1130 |
| Mind | fcfd9446-ca12-4758-aaea-4179a6ad33b1 |
| Lead (Deus-Ex-Crust) | 0dd15e8b-e4c5-4288-bea1-5a9b64c92c39 |
| LDExpert | 995f7854-cb32-40d7-89e2-94e9cca974b4 |

## Event format

When you receive a DM, it arrives as an event with:
- `type`: `dm.<yourWorkspaceId>`
- `payload.from`: sender's workspace ID
- `payload.fromName`: sender's workspace name
- `payload.message`: the message text
