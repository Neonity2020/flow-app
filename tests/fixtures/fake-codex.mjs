#!/usr/bin/env node
// Offline protocol double. Never calls the real CLI or a network service.
import {
  readFileSync,
  appendFileSync,
  existsSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { createInterface } from "node:readline";

if (process.argv[2] === "login" && process.argv[3] === "status") {
  process.stdout.write("Logged in (offline test double)\n");
  process.exit(0);
}

const config = JSON.parse(
  readFileSync(process.env.FLOW_TEST_CODEX_CONFIG, "utf8"),
);
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
let stage = 0;
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize" && stage === 0) {
    stage = 1;
    send({ id: message.id, result: {} });
  } else if (message.method === "initialized" && stage === 1) {
    stage = 2;
  } else if (message.method === "thread/start" && stage === 2) {
    stage = 3;
    const p = message.params;
    if (
      !p.ephemeral ||
      p.approvalPolicy !== "never" ||
      p.sandbox !== "read-only" ||
      realpathSync(p.cwd) !== process.cwd() ||
      readdirSync(p.cwd).length
    ) {
      throw new Error("Unsafe thread configuration");
    }
    send({ id: message.id, result: { thread: { id: "fake-thread" } } });
  } else if (message.method === "turn/start" && stage === 3) {
    stage = 4;
    const previous = existsSync(config.calls)
      ? readFileSync(config.calls, "utf8").trim().split("\n").length
      : 0;
    appendFileSync(
      config.calls,
      JSON.stringify({
        pid: process.pid,
        cwd: process.cwd(),
        prompt: message.params.input[0].text,
      }) + "\n",
    );
    send({ id: message.id, result: { turn: { id: "fake-turn" } } });
    const complete = () => {
      if (config.failure) {
        send({
          method: "turn/completed",
          params: {
            turn: {
              status: "failed",
              error: { message: "Injected connection failure" },
            },
          },
        });
        return;
      }
      const text =
        config.replies[Math.min(previous, config.replies.length - 1)];
      send({ method: "item/agentMessage/delta", params: { delta: text } });
      send({
        method: "item/completed",
        params: { item: { type: "agentMessage", text } },
      });
      send({
        method: "turn/completed",
        params: { turn: { status: "completed" } },
      });
    };
    if (config.release) {
      const timer = setInterval(() => {
        if (existsSync(config.release)) {
          clearInterval(timer);
          complete();
        }
      }, 10);
    } else complete();
  } else throw new Error(`Unexpected protocol message: ${message.method}`);
});
