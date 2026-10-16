import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const directory=mkdtempSync(join(tmpdir(),'flow-api-'));process.env.FLOW_DATA_DIR=directory
const {handle}=await import('../src/server/api');const {db}=await import('../src/server/store')
after(()=>{db.close();rmSync(directory,{recursive:true,force:true})})
const request=(path:string,body?:unknown,origin='http://127.0.0.1:3000')=>new Request(`http://127.0.0.1:3000/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)})
test('API rejects cross-origin mutation and accepts loopback project operations',async()=>{
 assert.equal((await handle(request('projects',{id:'p',name:'test'},'https://evil.example'))).status,403)
 assert.equal((await handle(request('projects',{id:'p',name:'test'}))).status,200)
 const p=await (await handle(request('projects/p'))).json();assert.equal(p.project.name,'test')
 assert.equal((await handle(new Request('http://evil.example/api/projects'))).status,403)
})
test('attachments are validated by bytes, isolated by project, and linked by ID',async()=>{
 await handle(request('projects',{id:'a',name:'images'}));await handle(request('projects',{id:'b',name:'other'}))
 const data=new FormData();data.append('file',new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')],'pixel.png',{type:'image/png'}))
 const r=await handle(new Request('http://127.0.0.1:3000/api/projects/a/attachments',{method:'POST',body:data}));assert.equal(r.status,200)
 const {id}=await r.json();assert.equal((await handle(request(`projects/a/attachments/${id}`))).status,200);assert.equal((await handle(request(`projects/b/attachments/${id}`))).status,404)
 const bad=new FormData();bad.append('file',new File(['<script>alert(1)</script>'],'fake.png',{type:'image/png'}))
 assert.equal((await handle(new Request('http://127.0.0.1:3000/api/projects/a/attachments',{method:'POST',body:bad}))).status,400)
})

test("completed SSE replays persisted events after Last-Event-ID and enforces project isolation", async () => {
  const store = await import("../src/server/store");
  store.createProject("events", "events-project");
  store.createProject("other events", "events-other");
  store.beginRun("events-project", "replay-run", "chat", "hi");
  store.addEvent("replay-run", "message.delta", { text: "first" });
  store.addEvent("replay-run", "message.delta", { text: "second" });
  store.finishRun("events-project", "replay-run", "completed");
  const path = "projects/events-project/events?runId=replay-run";
  const response = await handle(
    new Request(`http://127.0.0.1:3000/api/${path}&after=0`, {
      headers: { "Last-Event-ID": "2" },
    }),
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") || "",
    /text\/event-stream/,
  );
  const text = await response.text();
  const events = text
    .trim()
    .split("\n\n")
    .map((block) => JSON.parse(block.split("\ndata: ")[1]));
  assert.deepEqual(
    events.map((e) => [e.sequence, e.type]),
    [
      [3, "message.delta"],
      [4, "run.completed"],
    ],
  );
  assert.equal(events[0].payload.text, "second");
  assert.equal(
    (await handle(request("projects/events-other/events?runId=replay-run")))
      .status,
    404,
  );
  assert.equal((await handle(request(`${path}&after=-1`))).status, 400);
  const caughtUp = await handle(request(`${path}&after=4`));
  assert.equal(await caughtUp.text(), "");
});
