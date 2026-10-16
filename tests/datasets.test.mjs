import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../worker/api.mjs';
import {openDB} from '../worker/local-db.mjs';
import {demo} from '../dist/core.mjs';
import {marketingDemo} from '../dist/marketing-core.mjs';
const origin='https://qadam.test';
const req=(path,body,owner='a')=>new Request(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner}:{})},body:body?JSON.stringify(body):undefined});
const input=(rows=demo(),expectedVersion=0)=>({rows,expectedVersion,name:'Sales',source:'upload'});
const invoke=async(db,path,body,owner)=>{const r=await api(req(path,body,owner),{DB:db});return {status:r.status,...await r.json()};};
test('sales and marketing persist independently, deduplicate and remain isolated between owners',async()=>{
 const db=openDB(':memory:');try{
  const a=await invoke(db,'/api/datasets/sales',input());assert.equal(a.status,201);assert.equal(a.dataset.rowCount,540);
  const duplicate=await invoke(db,'/api/datasets/sales',input());assert.equal(duplicate.duplicate,true);assert.equal(duplicate.version,1);
  assert.equal((await invoke(db,'/api/datasets/sales')).dataset.rows.length,540);
  assert.equal((await invoke(db,'/api/datasets/sales',undefined,'b')).dataset,null);
  assert.equal((await invoke(db,'/api/datasets/sales/'+a.dataset.id,undefined,'b')).status,404);
  assert.equal((await invoke(db,'/api/datasets/sales',undefined,null)).status,401);
  assert.equal((await invoke(db,'/api/datasets/marketing',input(marketingDemo()))).status,201);
  assert.equal((await invoke(db,'/api/datasets/sales/history')).history.length,1);
 }finally{db.close();}
});
test('failed validation and stale writes preserve current dataset; restore advances head without duplicating history',async()=>{
 const db=openDB(':memory:');try{
  const first=await invoke(db,'/api/datasets/sales',input());
  const rows=demo().map(r=>({...r,stock:r.stock+1}));
  assert.equal((await invoke(db,'/api/datasets/sales',input(rows))).status,409);
  assert.equal((await invoke(db,'/api/datasets/sales',input([{...rows[0],units:-1}],1))).status,400);
  assert.equal((await invoke(db,'/api/datasets/sales')).dataset.id,first.dataset.id);
  assert.equal((await invoke(db,'/api/datasets/sales',input(rows,1))).version,2);
  const restored=await invoke(db,'/api/datasets/sales',input(demo(),2));assert.equal(restored.version,3);assert.equal(restored.dataset.id,first.dataset.id);
  const history=await invoke(db,'/api/datasets/sales/history');assert.equal(history.history.length,2);assert.equal(history.history.filter(r=>r.current).length,1);
 }finally{db.close();}
});
test('concurrent updates cannot replace a winning writer or leave hidden snapshots',async()=>{
 const db=openDB(':memory:');try{
  const responses=await Promise.all([1,2].map(n=>invoke(db,'/api/datasets/sales',input(demo().map(r=>({...r,stock:r.stock+n}))))));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal((await invoke(db,'/api/datasets/sales/history')).history.length,1);
 }finally{db.close();}
});
test('payload and row limits are enforced server-side',async()=>{
 const db=openDB(':memory:');try{
  assert.equal((await invoke(db,'/api/datasets/sales',input(Array(5001).fill(demo()[0])))).status,400);
  assert.equal((await invoke(db,'/api/datasets/sales',{...input(),name:'x'.repeat(1024*1024)})).status,413);
 }finally{db.close();}
});
