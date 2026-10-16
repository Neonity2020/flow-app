import { runCodex } from "../src/server/codex";
const controller = new AbortController();
const result = JSON.parse(
  await runCodex(
    'Return exactly content="Flow bridge ready", operations="[]", spec="". Do not use tools.',
    controller.signal,
    () => {},
  ),
);
if (result.content !== "Flow bridge ready")
  throw new Error("Unexpected smoke reply");
console.log(
  "Codex initialize → initialized → thread/start → turn/start → completed: PASS",
);
