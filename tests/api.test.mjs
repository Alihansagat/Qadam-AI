import test from 'node:test';
import assert from 'node:assert/strict';
import {api,syncTelegram} from '../worker/api.mjs';
import {openDB} from '../worker/local-db.mjs';
const url='https://qadam.test';
const req=(path,body,owner='owner')=>new Request(url+path,{method:body?'POST':'GET',headers:{Origin:url,...(owner?{'oai-authenticated-user-id':owner}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
const draft={supplier:{name:'Test',handle:'sagatooov'},lines:[{sku:'A',name:'Cream',quantity:2,cost:50}],source:'upload'};
test('orders are persisted and isolated by owner; writes reject other origins',async()=>{
  const DB=openDB(':memory:'),env={DB};
  const created=await api(req('/api/orders',draft),env);assert.equal(created.status,201);
  assert.equal((await(await api(req('/api/orders'),env)).json()).orders.length,1);
  assert.equal((await(await api(req('/api/orders',undefined,'another'),env)).json()).orders.length,0);
  assert.equal((await api(req('/api/orders',undefined,null),env)).status,401);
  const bad=req('/api/orders',draft);bad.headers.set('Origin','https://bad.test');assert.equal((await api(bad,env)).status,403);DB.close();
});
test('demo sending is prohibited and actual sending is confirmation-gated and at most once',async()=>{
  const DB=openDB(':memory:'),env={DB,TELEGRAM_BOT_TOKEN:'test'},original=globalThis.fetch;let sent=0;
  globalThis.fetch=async(input,options)=>{if(String(input).endsWith('/getChat'))return Response.json({ok:true,result:{username:'sagatooov'}});sent++;return Response.json({ok:true,result:{message_id:42}});};
  try{
    await DB.prepare('INSERT INTO qadam_telegram_contacts(chat_id,username) VALUES(?,?)').bind('123','sagatooov').run();
    const demo=await(await api(req('/api/orders',{...draft,source:'demo'}),env)).json();
    assert.equal((await api(req('/api/orders/'+demo.id,{action:'send',version:0,confirm:true}),env)).status,400);assert.equal(sent,0);
    const o=await(await api(req('/api/orders',draft),env)).json();
    assert.equal((await api(req('/api/orders/'+o.id,{action:'send',version:0}),env)).status,400);assert.equal(sent,0);
    const r=await(await api(req('/api/orders/'+o.id,{action:'send',version:0,confirm:true}),env)).json();assert.equal(r.status,'sent');assert.equal(sent,1);
    assert.equal((await api(req('/api/orders/'+o.id,{action:'send',version:r.version,confirm:true}),env)).status,400);assert.equal(sent,1);
  }finally{globalThis.fetch=original;DB.close();}
});
test('uncertain Telegram delivery is never automatically retried',async()=>{
  const DB=openDB(':memory:'),env={DB,TELEGRAM_BOT_TOKEN:'test'},original=globalThis.fetch;
  globalThis.fetch=async input=>{if(String(input).endsWith('/getChat'))return Response.json({ok:true,result:{username:'sagatooov'}});throw Error('timeout');};
  try{
    await DB.prepare('INSERT INTO qadam_telegram_contacts(chat_id,username) VALUES(?,?)').bind('123','sagatooov').run();
    const o=await(await api(req('/api/orders',draft),env)).json();await api(req('/api/orders/'+o.id,{action:'send',version:0,confirm:true}),env);
    const stored=(await(await api(req('/api/orders'),env)).json()).orders[0];assert.equal(stored.status,'delivery_unknown');
  }finally{globalThis.fetch=original;DB.close();}
});
test('only matching supplier replies can set invoices and notify owner',async()=>{
  const DB=openDB(':memory:'),env={DB,TELEGRAM_BOT_TOKEN:'test',OWNER_TELEGRAM_CHAT_ID:'owner-chat'},original=globalThis.fetch;let notified=[];
  try{
    const o=await(await api(req('/api/orders',draft),env)).json();Object.assign(o,{status:'sent',supplierChatId:'123',telegramMessageId:42});
    await DB.prepare('UPDATE qadam_orders SET data=? WHERE id=?').bind(JSON.stringify(o),o.id).run();
    globalThis.fetch=async(input,options)=>{
      if(String(input).endsWith('/getUpdates'))return Response.json({ok:true,result:[{update_id:1,message:{chat:{id:999,type:'private'},from:{id:999},text:'/invoice 9999 2026-10-20',reply_to_message:{message_id:42}}},{update_id:2,message:{chat:{id:123,type:'private'},from:{id:123},text:'/invoice 100 2026-10-20 invoice',reply_to_message:{message_id:42}}}]});
      notified.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:50}});
    };
    await syncTelegram(env);const stored=(await(await api(req('/api/orders'),env)).json()).orders[0];assert.equal(stored.invoice.amount,100);assert.equal(stored.invoice.source,'telegram');assert.equal(notified.length,1);assert.equal(notified[0].chat_id,'owner-chat');
  }finally{globalThis.fetch=original;DB.close();}
});
