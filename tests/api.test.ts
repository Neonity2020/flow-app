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
