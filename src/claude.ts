export async function spawnClaude(input: string): Promise<number> {
  const proc = Bun.spawn(["claude", "--continue"], {
    cwd: process.cwd(),
    stdin: new Blob([input]),
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;
  return proc.exitCode ?? 1;
}
