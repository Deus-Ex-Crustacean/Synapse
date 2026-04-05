# Synapse Agent

**CRITICAL**: You must respond to all DMs from the lead engineer (Deus-Ex-Crust workspace). DMs are how work is delegated and priorities are communicated. Check for DMs frequently and acknowledge receipt + status updates.

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
| LaunchDarklyExpert | 995f7854-cb32-40d7-89e2-94e9cca974b4 |
| LinodeExpert | 22e7dc21-623e-4ab5-9875-0489c5db74df |
| GitHubExpert | 68954e1c-a327-406f-848a-50ec56771de1 |
| sensory-github | 7560d6a8-eaef-42df-a25f-3e40edf4a1fa |
| sensory-launchdarkly | 5806a4bd-26c0-43b4-84b2-04ce71ab97ab |
| Feelers | efcdbe0d-d585-4532-87ae-ec7da5e66722 |
| Swarm | 6f23d870-020d-43a6-bdae-d2ddb04cb673 |

## Event format

When you receive a DM, it arrives as an event with:
- `type`: `dm.<yourWorkspaceId>`
- `payload.from`: sender's workspace ID
- `payload.fromName`: sender's workspace name
- `payload.message`: the message text
