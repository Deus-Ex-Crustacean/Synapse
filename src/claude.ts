export interface ClaudeResult {
  exitCode: number;
  output: string;
}

export async function spawnClaude(input: string): Promise<ClaudeResult> {
  const proc = Bun.spawn(
    ["claude", "-p", "--continue", "--dangerously-skip-permissions", "--output-format", "stream-json"],
    {
      cwd: process.cwd(),
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "inherit",
    },
  );

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "content_block_delta" && msg.delta?.text) {
          process.stdout.write(msg.delta.text);
          output += msg.delta.text;
        } else if (msg.type === "result" && msg.result?.text) {
          process.stdout.write(msg.result.text);
          output += msg.result.text;
        }
      } catch {
        // skip unparseable lines
      }
    }
  }

  // Handle any remaining buffer
  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer);
      if (msg.type === "content_block_delta" && msg.delta?.text) {
        process.stdout.write(msg.delta.text);
        output += msg.delta.text;
      } else if (msg.type === "result" && msg.result?.text) {
        process.stdout.write(msg.result.text);
        output += msg.result.text;
      }
    } catch {
      // skip
    }
  }

  await proc.exited;
  return { exitCode: proc.exitCode ?? 1, output };
}
