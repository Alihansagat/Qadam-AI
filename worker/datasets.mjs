import {HEADERS,parseCSV} from '../dist/core.mjs';
import {validateMarketingRows} from '../dist/marketing-core.mjs';

const datasetJSON=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const datasetError=(message,status=400,code='invalid_dataset')=>Object.assign(new Error(message),{status,code});
const datasetLimit=100;
const datasetMetadata=row=>({id:row.id,name:row.name,source:row.source,createdAt:row.created_at,fingerprint:row.fingerprint,version:row.version,rowCount:row.row_count,start:row.start_date,end:row.end_date});
const datasetDecode=(row,version=row.version)=>({...datasetMetadata(row),version,rows:JSON.parse(row.data)});
const datasetHead=(db,owner,kind)=>db.prepare('SELECT dataset_id,version FROM qadam_dataset_heads WHERE owner=? AND kind=?').bind(owner,kind).first();
const datasetFind=(db,owner,kind,id)=>db.prepare('SELECT * FROM qadam_datasets WHERE owner=? AND kind=? AND id=?').bind(owner,kind,id).first();

function datasetSalesRows(rows){
  if(!Array.isArray(rows)||!rows.length||rows.length>5000)throw datasetError('Загрузите от 1 до 5 000 строк продаж.');
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==HEADERS.length||Object.keys(row).some(key=>!HEADERS.includes(key))||HEADERS.some(key=>!['string','number'].includes(typeof row[key])))throw datasetError('В продажах нужны все девять колонок стандартного шаблона.');
  }
  // Round-trip through the same validator as the import UI, without the CSV
  // export's spreadsheet-only formula escaping changing product identifiers.
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  const parsed=parseCSV(HEADERS.join(',')+'\n'+rows.map(row=>HEADERS.map(key=>quote(row[key])).join(',')).join('\n'));
  if(parsed.errors.length)throw datasetError(parsed.errors.slice(0,3).map(error=>error.message).join(' '));
  return parsed.rows;
}
async function datasetInput(request,kind){
  const reader=request.body?.getReader(),chunks=[];let size=0;
  if(reader){
    while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
      if(size>1024*1024){await reader.cancel();throw datasetError('Один набор данных должен быть не больше 1 МБ.',413,'payload_too_large');}
      chunks.push(chunk.value);
    }
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const raw=new TextDecoder().decode(bytes);
  let input;try{input=JSON.parse(raw);}catch{throw datasetError('Некорректный запрос.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw datasetError('Некорректный запрос.');
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw datasetError('Сначала загрузите текущую версию данных.',428,'version_required');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>160)throw datasetError('Укажите название загрузки до 160 символов.');
  if(!['upload','demo'].includes(input.source))throw datasetError('Укажите источник данных.');
  let rows;
  try{rows=kind==='sales'?datasetSalesRows(input.rows):validateMarketingRows(input.rows);}catch(error){throw datasetError(error.message);}
  const data=JSON.stringify(rows);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const dates=rows.map(row=>row.date).sort();
  return {rows,data,fingerprint,name:input.name.trim(),source:input.source,expectedVersion:input.expectedVersion,start:dates[0],end:dates.at(-1)};
}

export async function handleDatasets(request,env,owner){
  const path=new URL(request.url).pathname;
  const match=path.match(/^\/api\/datasets\/(sales|marketing)(?:\/(history|[a-f0-9-]{36}))?$/);
  if(!match)return datasetJSON({error:'Не найдено.'},404);
  if(!owner)return datasetJSON({error:'Войдите в Qadam.'},401);
  const [,kind,suffix]=match,db=env.DB;
  try{
    if(request.method==='GET'){
      const head=await datasetHead(db,owner,kind),version=head?.version??0;
      if(suffix==='history'){
        const result=await db.prepare('SELECT id,name,source,created_at,fingerprint,version,row_count,start_date,end_date FROM qadam_datasets WHERE owner=? AND kind=? ORDER BY version DESC').bind(owner,kind).all();
        return datasetJSON({history:result.results.map(row=>({...datasetMetadata(row),current:row.id===head?.dataset_id})),version});
      }
      const id=suffix??head?.dataset_id;
      if(!id)return datasetJSON({dataset:null,version});
      const row=await datasetFind(db,owner,kind,id);
      if(!row)return datasetJSON({error:'Набор данных не найден.'},404);
      return datasetJSON({dataset:datasetDecode(row,suffix?row.version:version),version});
    }
    if(request.method!=='POST'||suffix)return datasetJSON({error:'Метод не поддерживается.'},405);
    const input=await datasetInput(request,kind);
    const head=await datasetHead(db,owner,kind);
    const existing=await db.prepare('SELECT * FROM qadam_datasets WHERE owner=? AND kind=? AND fingerprint=?').bind(owner,kind,input.fingerprint).first();
    if(existing&&existing.id===head?.dataset_id)return datasetJSON({dataset:datasetDecode(existing,head.version),version:head.version,duplicate:true,restored:false});
    if((head?.version??0)!==input.expectedVersion)throw datasetError('Данные уже обновлены в другом окне. Обновите страницу перед сохранением.',409,'version_conflict');
    const id=existing?.id??crypto.randomUUID(),version=input.expectedVersion+1,createdAt=new Date().toISOString();
    // D1 batch executes atomically. Inserting the immutable snapshot and moving
    // the head both depend on the same expected version, so a losing writer
    // cannot leave a hidden history entry or replace another tab's upload.
    const results=await db.batch([
      db.prepare('INSERT OR IGNORE INTO qadam_dataset_heads(owner,kind,version) VALUES(?,?,0)').bind(owner,kind),
      db.prepare(`INSERT OR IGNORE INTO qadam_datasets(id,owner,kind,fingerprint,name,source,created_at,version,row_count,start_date,end_date,data)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM qadam_dataset_heads WHERE owner=? AND kind=? AND version=?)
        AND (SELECT COUNT(*) FROM qadam_datasets WHERE owner=? AND kind=?)<?`).bind(id,owner,kind,input.fingerprint,input.name,input.source,createdAt,version,input.rows.length,input.start,input.end,input.data,owner,kind,input.expectedVersion,owner,kind,datasetLimit),
      db.prepare(`UPDATE qadam_dataset_heads SET dataset_id=(SELECT id FROM qadam_datasets WHERE owner=? AND kind=? AND fingerprint=?),version=version+1
        WHERE owner=? AND kind=? AND version=? AND EXISTS(SELECT 1 FROM qadam_datasets WHERE owner=? AND kind=? AND fingerprint=?)`).bind(owner,kind,input.fingerprint,owner,kind,input.expectedVersion,owner,kind,input.fingerprint)
    ]);
    if(results[2].meta.changes!==1){
      const latest=await datasetHead(db,owner,kind),current=latest?.dataset_id?await datasetFind(db,owner,kind,latest.dataset_id):null;
      if(current?.fingerprint===input.fingerprint)return datasetJSON({dataset:datasetDecode(current,latest.version),version:latest.version,duplicate:true,restored:false});
      if(latest?.version!==input.expectedVersion)throw datasetError('Данные уже обновлены в другом окне. Обновите страницу перед сохранением.',409,'version_conflict');
      throw datasetError('Сохранено 100 наборов этого типа. История не удалена. Обратитесь к владельцу сервиса для увеличения лимита.',409,'history_limit');
    }
    const saved=existing??{id,owner,kind,fingerprint:input.fingerprint,name:input.name,source:input.source,created_at:createdAt,version,row_count:input.rows.length,start_date:input.start,end_date:input.end,data:input.data};
    return datasetJSON({dataset:datasetDecode(saved,version),version,duplicate:!!existing,restored:!!existing},existing?200:201);
  }catch(error){
    const known=Number.isInteger(error.status);
    return datasetJSON({error:known?error.message:'Не удалось сохранить данные. Попробуйте ещё раз.',code:error.code??(known?'invalid_dataset':'storage_error')},error.status??(known?400:500));
  }
}
