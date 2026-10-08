export const HEADERS=['date','sku','name','units','price','cost','stock','on_order','lead_days'];
export const DAY=86400000;
export const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
export const sum=a=>a.reduce((s,n)=>s+n,0);
const mean=a=>a.length?sum(a)/a.length:0;
export function parseCSV(text){
  text=text.replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/)[0]||'';
  const delimiter=first.includes(';')?';':',';
  const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error('Некорректные кавычки в CSV.');quoted=true;}
    else if(c===delimiter||c==='\n'||c==='\r'){row.push(field.trim());field='';closed=false;if(c!==delimiter){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}}
    else{if(closed&&!/\s/.test(c))throw Error('Символ после закрывающей кавычки.');field+=c;}
  }
  if(quoted)throw Error('В CSV не закрыта кавычка.');
  row.push(field.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw Error('Нужны заголовки и хотя бы одна строка данных.');
  if(rows.length>50001)throw Error('Максимум 50 000 строк на один импорт.');
  const headers=rows.shift().map(h=>h.toLowerCase());
  if(new Set(headers).size!==headers.length)throw Error('Повторяющиеся названия колонок.');
  const missing=HEADERS.filter(h=>!headers.includes(h));if(missing.length)throw Error('Не хватает колонок: '+missing.join(', '));
  const errors=[],out=[],seen=new Set(),names=new Map();
  rows.forEach((cells,i)=>{
    const fail=message=>errors.push({line:i+2,message});
    if(cells.length!==headers.length){fail('Количество полей не совпадает с заголовком.');return;}
    const r=Object.fromEntries(headers.map((h,j)=>[h,cells[j]]));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date+'T00:00:00Z'))||new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date){fail('Дата должна быть реальной датой YYYY-MM-DD.');return;}
    if(!r.sku||!r.name||r.sku.length>100||r.name.length>200){fail('Укажите SKU (до 100 символов) и название (до 200).');return;}
    for(const k of HEADERS.slice(3)){
      if(!/^\d+(?:[.,]\d+)?$/.test(r[k])){fail(k+': требуется неотрицательное число.');return;}
      r[k]=Number(r[k].replace(',','.'));
      if(!Number.isFinite(r[k])||r[k]>1e9){fail(k+': слишком большое значение.');return;}
    }
    if(!Number.isInteger(r.lead_days)||r.lead_days>90){fail('lead_days: целое число от 0 до 90.');return;}
    const key=JSON.stringify([r.sku,r.date]);
    if(seen.has(key)){fail('Дубликат SKU и даты: '+r.sku+', '+r.date);return;}seen.add(key);
    if(names.has(r.sku)&&names.get(r.sku)!==r.name){fail('У одного SKU разные названия. Сначала согласуйте название.');return;}names.set(r.sku,r.name);
    out.push(Object.fromEntries(HEADERS.map(k=>[k,r[k]])));
  });
  if(!errors.length){
    const groups=new Map();for(const r of out){if(!groups.has(r.sku))groups.set(r.sku,[]);groups.get(r.sku).push(r);}
    const ends=new Set();
    for(const [sku,series] of groups){series.sort((a,b)=>a.date.localeCompare(b.date));ends.add(series.at(-1).date);for(let i=1;i<series.length;i++){if(series[i].date!==addDays(series[i-1].date,1)){errors.push({line:null,message:sku+': пропуск дней. Добавьте строки с units=0 только для подтверждённых дней без продаж.'});break;}}}
    if(ends.size>1)errors.push({line:null,message:'Для всех товаров нужна одинаковая последняя дата, чтобы остатки можно было сравнивать.'});
  }
  return {rows:errors.length?[]:out.sort((a,b)=>a.date.localeCompare(b.date)||a.sku.localeCompare(b.sku)),errors,total:rows.length};
}
export function csv(rows){const encode=v=>{let s=String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return HEADERS.join(',')+'\n'+rows.map(r=>HEADERS.map(k=>encode(r[k])).join(',')).join('\n');}
function predict(history,horizon,method){
  const values=history.map(r=>r.units);
  return Array.from({length:horizon},(_,i)=>{
    const target=history.length+i;
    if(method==='weekly'){const index=history.length-7+(i%7);return values[index]??mean(values);}
    const sameDay=values.filter((_,j)=>j>=values.length-28&&(target-j)%7===0);
    return mean(sameDay.length?sameDay:values.slice(-7));
  });
}
export function analyze(rows,horizon=14,safetyDays=3){
  if(![7,14,30].includes(horizon)||!Number.isInteger(safetyDays)||safetyDays<0||safetyDays>30)throw Error('Неверные параметры прогноза.');
  if(!rows.length)return null;
  const end=rows.reduce((a,r)=>a>r.date?a:r.date,''),start=addDays(end,-13),previous=addDays(start,-14);
  const groups=new Map();for(const r of rows){if(!groups.has(r.sku))groups.set(r.sku,[]);groups.get(r.sku).push(r);}
  const recent=rows.filter(r=>r.date>=start),prev=rows.filter(r=>r.date>=previous&&r.date<start);
  const revenue=sum(recent.map(r=>r.units*r.price)),prevRevenue=sum(prev.map(r=>r.units*r.price));
  const products=[...groups].map(([sku,series])=>{
    series.sort((a,b)=>a.date.localeCompare(b.date));const last=series.at(-1),enough=series.length>=28;
    let method='weekday',validation=null;
    if(series.length>=42){
      const train=series.slice(0,-14),actual=series.slice(-14).map(r=>r.units);
      const candidates=['weekly','weekday'].map(m=>{const pred=predict(train,14,m),abs=sum(pred.map((v,i)=>Math.abs(v-actual[i])));return {method:m,mae:abs/14,wape:sum(actual)?abs/sum(actual)*100:null};});
      candidates.sort((a,b)=>a.mae-b.mae);method=candidates[0].method;validation={...candidates[0],candidates,days:14};
    }
    const forecast=enough?predict(series,Math.max(horizon,last.lead_days+safetyDays,1),method):[];
    const total=enough?sum(forecast.slice(0,horizon)):null;
    const target=enough?sum(forecast.slice(0,last.lead_days+safetyDays)):null;
    const suggested=enough?Math.max(0,Math.ceil(target-last.stock-last.on_order)):null;
    let accumulated=0,stockout=null;for(let i=0;i<forecast.length;i++){accumulated+=forecast[i];if(accumulated>last.stock){stockout=i;break;}}
    const sold=series.filter(r=>r.date>=start);
    return {...last,sku,history:series,days:series.length,enough,method,validation,forecast,total,suggested,target,stockout,revenue:sum(sold.map(r=>r.units*r.price)),margin:sum(sold.map(r=>r.units*(r.price-r.cost))),sold:sum(sold.map(r=>r.units)),budget:suggested===null?null:suggested*last.cost,stockValue:last.stock*last.cost};
  }).sort((a,b)=>b.revenue-a.revenue);
  const daily=Array.from({length:14},(_,i)=>{const date=addDays(start,i);return {date,revenue:sum(recent.filter(r=>r.date===date).map(r=>r.units*r.price))};});
  return {end,start,revenue,margin:sum(recent.map(r=>r.units*(r.price-r.cost))),units:sum(recent.map(r=>r.units)),change:prevRevenue&&rows.every(r=>groups.get(r.sku)[0].date<=previous)?(revenue/prevRevenue-1)*100:null,products,daily,budget:sum(products.map(p=>p.budget||0)),actions:products.filter(p=>p.suggested>0).sort((a,b)=>(a.stockout??999)-(b.stockout??999)),horizon,safetyDays};
}
export function demo(){
  const catalog=[['Q-001','Крем для лица · 50 мл',6900,3200,18,0,7,6],['Q-002','Сыворотка витамин C',8900,4300,25,8,10,4],['Q-003','Гель для умывания',4200,1900,145,0,5,8],['Q-004','SPF 50 · защита',7400,3600,14,0,8,5],['Q-005','Бальзам для губ',1900,650,220,0,4,11],['Q-006','Тоник увлажняющий',5100,2300,76,0,7,4]];
  let seed=41;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const rows=[];for(let d=0;d<90;d++)for(const [sku,name,price,cost,stock,on_order,lead_days,base] of catalog){const date=addDays('2026-07-10',d),weekend=[0,6].includes(new Date(date+'T00:00:00Z').getUTCDay());const units=Math.max(0,Math.round(base*(weekend?1.4:1)*(0.7+rand()*.6)*(1+d/450)));rows.push({date,sku,name,units,price,cost,stock:d===89?stock:250,on_order,lead_days});}return rows;
}
