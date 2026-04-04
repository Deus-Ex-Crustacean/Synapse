const EGO_URL = process.env.EGO_URL || "";
const EGO_CLIENT_ID = process.env.EGO_CLIENT_ID || "";
const EGO_CLIENT_SECRET = process.env.EGO_CLIENT_SECRET || "";

if (!EGO_URL || !EGO_CLIENT_ID || !EGO_CLIENT_SECRET) {
  throw new Error("EGO_URL, EGO_CLIENT_ID, and EGO_CLIENT_SECRET environment variables are required");
}

let currentJwt: string;

async function fetchToken(): Promise<string> {
  const res = await fetch(`${EGO_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: EGO_CLIENT_ID,
      client_secret: EGO_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ego auth failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string };
  currentJwt = data.access_token;
  return currentJwt;
}

export async function authenticate(): Promise<string> {
  return fetchToken();
}

export async function refreshToken(): Promise<string> {
  return fetchToken();
}

export function getJwt(): string {
  return currentJwt;
}
