import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PRAXIS_PATH = join(process.cwd(), "praxis.json");

export function readTimestamp(): number {
  try {
    const data = JSON.parse(readFileSync(PRAXIS_PATH, "utf-8"));
    return data.last_timestamp ?? 0;
  } catch {
    return 0;
  }
}

export function writeTimestamp(timestamp: number): void {
  writeFileSync(PRAXIS_PATH, JSON.stringify({ last_timestamp: timestamp }, null, 2) + "\n");
}
