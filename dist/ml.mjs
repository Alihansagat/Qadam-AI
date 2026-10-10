// A report is tied to the exact dataset; forecasts from another shop never apply.
export const ML_METHODS = {
  catboost:{name:'CatBoost',short:'CatBoost',description:'Обученная модель: учитывает прошлые продажи и день недели. Результат рассчитан заранее для этого набора данных.'},
  lightgbm:{name:'LightGBM',short:'LightGBM',description:'Обученная модель: ищет зависимости в прошлых продажах и недельном ритме. Результат рассчитан заранее для этого набора данных.'},
};
export function canonical(rows){return JSON.stringify(rows.map(r=>[r.sku,r.date,r.name,r.units,r.price,r.cost,r.stock,r.on_order,r.lead_days]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0));}
export async function fingerprint(rows){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(rows))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function splitPlan(n){const testDays=n>=70?14:0,end=n-testDays,folds=Math.min(3,Math.floor((end-28)/14));return {end,folds,origins:Array.from({length:Math.max(0,folds)},(_,i)=>end-folds*14+i*14)};}
export async function validateReport(report,rows){
  if(!report||report.schema!==1||report.fingerprint!==await fingerprint(rows))throw Error('Этот ML-отчёт создан для другого набора данных. Сначала загрузите соответствующий CSV.');
  const groups=new Map();for(const r of rows){if(!groups.has(r.sku))groups.set(r.sku,[]);groups.get(r.sku).push(r);}
  const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(x=>Number.isFinite(x)&&x>=0&&x<=1e12);
  const products=Object.create(null);
  for(const [sku,h] of groups){
    if(h.length<70)continue;
    h.sort((a,b)=>a.date.localeCompare(b.date));const p=report.products?.[sku],plan=splitPlan(h.length);
    if(!p||p.end!==h.at(-1).date||p.days!==h.length)throw Error('В отчёте не совпадают товары или даты.');
    const models={};for(const method of Object.keys(ML_METHODS)){
      const m=p.models?.[method];if(!m||!vector(m.forecast,120)||!vector(m.validation,plan.folds*14)||!vector(m.test,14))throw Error('В ML-отчёте повреждены прогнозы.');
      models[method]={forecast:m.forecast,validation:m.validation,test:m.test};
    }
    if(!Array.isArray(p.anomalies)||p.anomalies.length!==14||p.anomalies.some((a,i)=>a.date!==h[plan.end+i].date||!Number.isFinite(a.score)||typeof a.flag!=='boolean'||a.flag!==(a.score<0)))throw Error('В отчёте повреждена проверка аномалий.');
    products[sku]={end:p.end,days:p.days,models,anomalies:p.anomalies.map(a=>({date:a.date,score:a.score,flag:a.flag}))};
  }
  if(!Object.keys(products).length)throw Error('Для ML-отчёта нужно минимум 70 дней истории хотя бы одного товара.');
  return {schema:1,fingerprint:report.fingerprint,products};
}
