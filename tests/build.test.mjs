import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {openDB} from '../worker/local-db.mjs';
import {demo} from '../dist/core.mjs';
test('deployable worker serves UI assets and executes bundled storage routes',async()=>{
 execFileSync(process.execPath,['scripts/build-worker.mjs'],{cwd:new URL('../',import.meta.url)});
 const {default:worker}=await import('../dist/server/index.js');const DB=openDB(':memory:');
 try{
  const html=await worker.fetch(new Request('https://test.local/'),{DB});assert.equal(html.status,200);assert.match(await html.text(),/product.css/);
  assert.equal((await worker.fetch(new Request('https://test.local/datasets-client.mjs'),{DB})).status,200);
  const response=await worker.fetch(new Request('https://test.local/api/datasets/sales',{method:'POST',headers:{Origin:'https://test.local','Content-Type':'application/json','oai-authenticated-user-id':'test'},body:JSON.stringify({rows:demo(),name:'Bundle test',source:'upload',expectedVersion:0})}),{DB});
  assert.equal(response.status,201);assert.equal((await response.json()).dataset.rows.length,540);
 }finally{DB.close();}
});
