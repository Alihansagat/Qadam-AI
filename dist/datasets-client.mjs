const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(path,body){
  let r;try{r=await fetch('./api/datasets/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});}catch{throw Error('Нет связи с хранилищем. Проверьте интернет и повторите. Предыдущие данные сохранены.');}
  let d;try{d=await r.json();}catch{throw Error('Хранилище недоступно. Обновите страницу и повторите.');}
  if(!r.ok)throw Object.assign(new Error(d.error||'Не удалось загрузить данные.'),{status:r.status});return d;
}
export const latestDataset=kind=>request(kind);
export const saveDataset=(kind,rows,name,source,expectedVersion)=>request(kind,{rows,name,source,expectedVersion});
export function datasetHistory(host,kind,restore,notify){
  const section=document.createElement('section');section.className='panel dataset-history';section.innerHTML='<details><summary>История загрузок · восстановить предыдущие данные</summary><div class="history-content" aria-live="polite">Загружаем историю…</div></details>';host.append(section);
  const content=section.querySelector('.history-content');
  const load=()=>request(kind+'/history').then(({history})=>{if(!section.isConnected)return;content.innerHTML=history.length?history.map(d=>`<div class="history-row"><div><strong>${escape(d.name)}</strong><span class="meta">${escape(d.start)} — ${escape(d.end)} · ${d.rowCount} строк · ${new Date(d.createdAt).toLocaleString('ru-RU')}</span></div><button class="button" data-restore="${d.id}" ${d.current?'disabled':''}>${d.current?'Текущие данные':'Восстановить'}</button></div>`).join(''):'<p class="note">Сохранённые загрузки появятся здесь. Демо не заменяет ваши данные.</p>';
    content.querySelectorAll('[data-restore]').forEach(button=>button.onclick=async()=>{if(!confirm('Восстановить этот набор? Текущая версия останется в истории.'))return;button.disabled=true;try{const {dataset}=await request(kind+'/'+button.dataset.restore);await restore(dataset);notify('Данные восстановлены.');}catch(e){notify(e.message);button.disabled=false;}});
  }).catch(e=>{if(!section.isConnected)return;content.textContent=e.message;const b=document.createElement('button');b.className='button';b.textContent='Повторить';b.onclick=load;content.append(b);});void load();
}
