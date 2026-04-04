const CORTEX_URL = process.env.CORTEX_URL || "";
if (!CORTEX_URL) {
  throw new Error("CORTEX_URL environment variable is required");
}

interface Event {
  id: string;
  source: string;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

interface StreamOptions {
  jwt: string;
  eventTypes: string[];
  since: number;
  onEvent: (event: Event) => void;
  onAuthError: () => void;
}

export async function openEventStream(opts: StreamOptions): Promise<void> {
  const { jwt, eventTypes, since, onEvent, onAuthError } = opts;

  const subscribeRes = await fetch(`${CORTEX_URL}/subscribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_types: eventTypes }),
  });

  if (subscribeRes.status === 401) {
    onAuthError();
    return;
  }

  if (!subscribeRes.ok) {
    throw new Error(`Subscribe failed: ${subscribeRes.status} ${await subscribeRes.text()}`);
  }

  const url = `${CORTEX_URL}/events?${new URLSearchParams({ since: String(since) })}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (res.status === 401) {
    onAuthError();
    return;
  }

  if (!res.ok) {
    throw new Error(`SSE connect failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        onEvent(event);
      } catch {
        console.error("Failed to parse SSE event:", data);
      }
    }
  }
}
