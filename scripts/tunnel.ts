import "dotenv/config";
import { spawn } from "node:child_process";
const token = process.env.NGROK_AUTHTOKEN?.trim();
if (!token) {
  console.error(
    "Add NGROK_AUTHTOKEN to the local .env file, then run npm run tunnel.",
  );
  process.exit(1);
}
const port = process.env.PORT || "3000";
const child = spawn("ngrok", ["http", port], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});
// Redact the token even if ngrok includes an invalid credential in an error message.
for (const [stream, target] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
] as const) {
  let pending = "";
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines)
      target.write(line.split(token).join("[REDACTED]") + "\n");
  });
  stream?.on("end", () => {
    if (pending) target.write(pending.split(token).join("[REDACTED]"));
  });
}
child.on("error", () => {
  console.error("Could not start ngrok. Install the ngrok client first.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
