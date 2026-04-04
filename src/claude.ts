export interface ClaudeResult {
  exitCode: number;
  output: string;
}

export async function spawnClaude(input: string): Promise<ClaudeResult> {
  const proc = Bun.spawn(
    ["claude", "-p", "--continue", "--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json"],
    {
      cwd: process.cwd(),
      stdin: input ? new Blob([input]) : undefined,
      stdout: "pipe",
      stderr: "inherit",
    },
  );

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let lineBuffer = "";

  function emitText(text: string) {
    output += text;
    lineBuffer += text;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop()!;
    for (const line of lines) {
      process.stdout.write(`◀ ${line}\n`);
    }
  }

  function flush() {
    if (lineBuffer) {
      process.stdout.write(`◀ ${lineBuffer}\n`);
      lineBuffer = "";
    }
  }

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
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) emitText(block.text);
          }
        } else if (msg.type === "content_block_delta" && msg.delta?.text) {
          emitText(msg.delta.text);
        } else if (msg.type === "result" && msg.result) {
          // result.result is the final text — only emit if we haven't already
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
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) emitText(block.text);
        }
      } else if (msg.type === "content_block_delta" && msg.delta?.text) {
        emitText(msg.delta.text);
      } else if (msg.type === "result" && msg.result) {
        // final result — text already emitted via assistant messages
      }
    } catch {
      // skip
    }
  }

  flush();

  await proc.exited;
  return { exitCode: proc.exitCode ?? 1, output };
}
