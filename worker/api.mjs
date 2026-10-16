import {handleDatasets} from './datasets.mjs';
import {draftOrder,recordInvoice,transition} from '../dist/orders.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=message=>{throw Error(message);};
const ownerId=r=>r.headers.get('oai-authenticated-user-id');
async function body(r){const raw=await r.text();if(raw.length>50000)fail('Запрос слишком большой.');return JSON.parse(raw);}
async function telegram(env,method,data){
  if(!env.TELEGRAM_BOT_TOKEN)fail('Telegram ещё не подключён.');
  let response;
  try{response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});}catch{throw Error('Статус доставки неизвестен. Проверьте чат; автоматически повторять отправку нельзя.');}
  const result=await response.json();
  if(!result.ok){const e=new Error(result.error_code===403?'Получатель заблокировал бота или ещё не открыл чат.':'Telegram отклонил запрос. Проверьте подключение получателя.');e.definite=true;throw e;}
  return result.result;
}
const decode=row=>({...JSON.parse(row.data),version:row.version});
async function save(db,order,owner,previousVersion){
  const data=JSON.stringify({...order,version:undefined});
  const r=await db.prepare('UPDATE qadam_orders SET data=?,version=version+1 WHERE id=? AND owner=? AND version=?').bind(data,order.id,owner,previousVersion).run();
  if(r.meta.changes!==1)fail('Заказ уже изменён. Обновите список.');
  return {...order,version:previousVersion+1};
}
export async function syncTelegram(env){
  if(!env.TELEGRAM_BOT_TOKEN)return {connected:false};
  const db=env.DB,now=Date.now();
  await db.prepare("INSERT OR IGNORE INTO qadam_meta(key,value) VALUES('lease','0')").run();
  const lock=await db.prepare("UPDATE qadam_meta SET value=? WHERE key='lease' AND CAST(value AS INTEGER)<?").bind(String(now+120000),now).run();
  if(!lock.meta.changes)return {busy:true};
  try{
    const offset=Number((await db.prepare("SELECT value FROM qadam_meta WHERE key='offset'").first())?.value??0);
    const updates=await telegram(env,'getUpdates',{offset,timeout:0,limit:30,allowed_updates:['message']});
    for(const update of updates){
      const m=update.message;
      if(m?.chat?.type==='private'&&m.from&&!m.from.is_bot){
        const chatId=String(m.chat.id),username=(m.from.username??'').toLowerCase();
        if(/^\/start(?:\s|$)/.test(m.text??'')){
          await db.prepare('INSERT INTO qadam_telegram_contacts(chat_id,username) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username').bind(chatId,username).run();
          await telegram(env,'sendMessage',{chat_id:chatId,text:'Qadam AI · Закупки\nЧат подключён. Заказы отправляются только после подтверждения в Qadam. Для выставления счёта ответьте на заказ командой /invoice СУММА YYYY-MM-DD, затем при необходимости добавьте комментарий. Бот не проводит оплату.'});
        }
        if(m.reply_to_message&&/^\/invoice\s/.test(m.text??'')){
          const candidates=await db.prepare('SELECT * FROM qadam_orders').all();
          const row=candidates.results.find(r=>{const o=JSON.parse(r.data);return o.supplierChatId===chatId&&o.telegramMessageId===m.reply_to_message.message_id&&['sent','awaiting_payment'].includes(o.status);});
          if(row){
            const match=m.text.match(/^\/invoice\s+(\d+(?:[.,]\d{1,2})?)\s+(\d{4}-\d{2}-\d{2})(?:\s+([\s\S]*))?$/);
            if(match){
              let invoiceOrder;
              try{
                let o=decode(row);o=recordInvoice({...o,status:'draft'},{amount:match[1].replace(',','.'),due:match[2],note:match[3]??''});o.invoice.source='telegram';o.notificationPending=true;
                invoiceOrder=o;
              }catch{ /* Invalid invoice leaves order unchanged. */ }
              if(invoiceOrder)await save(db,invoiceOrder,row.owner,row.version);
            }
          }
        }
      }
      await db.prepare("INSERT INTO qadam_meta(key,value) VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(update.update_id+1)).run();
    }
    // Retry notifications, never automatically retry purchase messages.
    const rows=(await db.prepare('SELECT * FROM qadam_orders').all()).results;
    let notified=0;
    for(const row of rows){const o=decode(row);if(!o.notificationPending||!env.OWNER_TELEGRAM_CHAT_ID)continue;
      await telegram(env,'sendMessage',{chat_id:env.OWNER_TELEGRAM_CHAT_ID,text:`Счёт от ${o.supplier.name}\nЗаказ ${o.id.slice(0,8)}\nК оплате: ${o.invoice.amount} ₸\nСрок: ${o.invoice.due}\n${o.invoice.note}\n\nПроверьте счёт и оплатите самостоятельно. Бот не проверяет банковские реквизиты и не списывает деньги.`});
      await save(db,{...o,notificationPending:false},row.owner,row.version);notified++;
    }
    const status={connected:true,updates:updates.length,notified,syncedAt:new Date().toISOString()};
    await db.prepare("INSERT INTO qadam_meta(key,value) VALUES('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(status)).run();
    return status;
  }finally{await db.prepare("UPDATE qadam_meta SET value='0' WHERE key='lease' AND value=?").bind(String(now+120000)).run();}
}
export async function api(request,env){
  const url=new URL(request.url),path=url.pathname,owner=ownerId(request);
  if(!env.DB)return json({error:'Серверное хранилище ещё не подключено.'},503);
  // The shared sync route is available to Sites service callers only through
  // the owner-private Site's authentication boundary. Never make this Site public.
  if(path==='/api/telegram/sync'&&request.method==='POST'){
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Недопустимый источник.'},403);
    try{return json(await syncTelegram(env));}catch{return json({error:'Не удалось обновить Telegram. Попробуйте позже.'},502);}
  }
  if(path==='/api/telegram/status'&&request.method==='GET'){const row=await env.DB.prepare("SELECT value FROM qadam_meta WHERE key='last_sync'").first();return json(row?JSON.parse(row.value):{connected:!!env.TELEGRAM_BOT_TOKEN,syncedAt:null});}
  if(!owner)return json({error:'Войдите в Qadam.'},401);
  if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({error:'Недопустимый источник.'},403);
  try{
    if(path.startsWith('/api/datasets/'))return await handleDatasets(request,env,owner);
    if(path==='/api/orders'&&request.method==='GET'){
      const rows=(await env.DB.prepare('SELECT * FROM qadam_orders WHERE owner=?').bind(owner).all()).results;
      return json({orders:rows.map(decode).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),connected:!!env.TELEGRAM_BOT_TOKEN});
    }
    if(path==='/api/orders'&&request.method==='POST'){
      const input=await body(request);
      if(!Array.isArray(input.lines)||input.lines.length>100||!['demo','upload'].includes(input.source))fail('Некорректный заказ.');
      for(const p of input.lines)if(typeof p.sku!=='string'||typeof p.name!=='string'||p.sku.length>100||p.name.length>200||!Number.isFinite(p.cost)||p.cost<0||p.cost>1e9)fail('Некорректный товар.');
      const o=draftOrder(input.supplier,input.lines,Object.fromEntries(input.lines.map(p=>[p.sku,p.quantity])));o.source=input.source;
      await env.DB.prepare('INSERT INTO qadam_orders(id,owner,data) VALUES(?,?,?)').bind(o.id,owner,JSON.stringify(o)).run();return json({...o,version:0},201);
    }
    const match=path.match(/^\/api\/orders\/([a-f0-9-]{36})$/);
    if(match&&request.method==='POST'){
      const input=await body(request),row=await env.DB.prepare('SELECT * FROM qadam_orders WHERE id=? AND owner=?').bind(match[1],owner).first();
      if(!row)return json({error:'Заказ не найден.'},404);
      let o=decode(row);if(o.version!==input.version)fail('Заказ уже изменён. Обновите список.');
      if(input.action==='send'){
        if(o.status!=='draft')fail('Этот заказ уже отправлялся. Повторная отправка запрещена.');
        if(o.source==='demo')fail('Учебные заказы нельзя отправлять. Загрузите реальные продажи.');
        if(input.confirm!==true)fail('Подтвердите отправку заказа.');
        const contacts=(await env.DB.prepare('SELECT * FROM qadam_telegram_contacts WHERE username=?').bind(o.supplier.handle.toLowerCase()).all()).results;
        if(contacts.length!==1)fail('Получатель должен открыть @qadam_ai_supply_bot и нажать Старт. Затем обновите Telegram.');
        const chat=await telegram(env,'getChat',{chat_id:contacts[0].chat_id});
        if(chat.username?.toLowerCase()!==o.supplier.handle.toLowerCase())fail('Username получателя изменился. Проверьте контакт.');
        o=await save(env.DB,{...o,status:'sending',supplierChatId:contacts[0].chat_id},owner,o.version);
        try{
          const message=await telegram(env,'sendMessage',{chat_id:o.supplierChatId,text:`Заказ Qadam #${o.id.slice(0,8)}\n\n${o.message}\n\nДля счёта ответьте на это сообщение: /invoice СУММА YYYY-MM-DD комментарий`});
          return json(await save(env.DB,{...o,status:'sent',telegramMessageId:message.message_id},owner,o.version));
        }catch(e){await save(env.DB,{...o,status:e.definite?'draft':'delivery_unknown'},owner,o.version);throw e;}
      }
      if(input.action==='invoice'){o=recordInvoice({...o,status:o.status==='sent'?'draft':o.status},input.invoice);o.notificationPending=true;}
      else{o=transition(o,input.action);if(['paid','received','cancelled'].includes(o.status))o.notificationPending=false;}
      return json(await save(env.DB,o,owner,row.version));
    }
    return json({error:'Не найдено.'},404);
  }catch(e){return json({error:e instanceof SyntaxError?'Некорректный запрос.':e.message},400);}
}
