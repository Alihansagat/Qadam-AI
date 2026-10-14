// Integer minor units keep the proposed spend within the entered limit.
export function allocateBudget(products,amount){
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>1e12)throw Error('Укажите бюджет от 0 до 1 000 000 000 000 ₸.');
  const limit=Math.floor(amount*100+1e-7);let remaining=limit;
  const needed=products.filter(p=>p.suggested>0).map(p=>{
    if(!Number.isSafeInteger(p.suggested)||!Number.isFinite(p.cost)||p.cost<0||!Number.isFinite(p.lead_days))throw Error('Проверьте количество, цену и срок поставки.');
    const unit=Math.ceil(p.cost*100-1e-7);if(!Number.isSafeInteger(unit))throw Error('Цена слишком велика.');
    return {...p,unit,priority:p.stockout===null?Infinity:p.stockout+1-p.lead_days};
  }).sort((a,b)=>a.priority-b.priority||(a.stockout??Infinity)-(b.stockout??Infinity)||String(a.sku).localeCompare(String(b.sku),'en'));
  const lines=needed.map(p=>{const quantity=p.unit>0?Math.min(p.suggested,Math.floor(remaining/p.unit)):0;const spend=quantity*p.unit;remaining-=spend;return {...p,quantity,deferred:p.suggested-quantity,spend:spend/100,unpriced:p.unit<=0};});
  return {limit:limit/100,spent:(limit-remaining)/100,remaining:remaining/100,lines,quantity:lines.reduce((s,p)=>s+p.quantity,0),deferred:lines.reduce((s,p)=>s+p.deferred,0)};
}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v)+' ₸';
let amount='',saved=null;
const signature=(r,source)=>JSON.stringify([source,r.end,r.safetyDays,r.products.map(p=>[p.sku,p.suggested,p.cost,p.stock,p.on_order,p.lead_days,p.stockout])]);
export function budgetSelection(r,source){return saved?.key===signature(r,source)?saved.plan:null;}
export function budgetPanel(app,r,source,notify){
  const panel=document.createElement('section');panel.className='panel budget-panel';
  panel.innerHTML=`<div class="panel-head"><div><h2>Закупка под ваш бюджет</h2><p class="meta">Сначала — более срочные позиции. Вы решаете, что заказывать.</p></div><span class="badge neutral">Сценарий</span></div><form id="budget-form" class="budget-form"><label for="purchase-budget">Доступная сумма, ₸<input id="purchase-budget" type="number" min="0" max="1000000000000" step="0.01" required placeholder="Например, 300000" value="${esc(amount)}"></label><button class="button primary" type="submit">Рассчитать</button></form><p class="meta">Расчёт по себестоимости из CSV, без доставки и комиссий. Он не меняет прогноз, основной план или остатки.</p><div id="budget-result" aria-live="polite"></div><details><summary>Как распределяется бюджет</summary><p class="note">Сортируем товары по сроку до исчерпания запаса минус срок поставки. При равенстве — по сроку исчерпания, затем артикулу. Берём доступное целое количество первой позиции, затем переходим к следующей. Это простое правило срочности, а не оптимизация прибыли. Товары с нулевой ценой исключаем до уточнения цены; стоимость округляем вверх до тиына. Минимальная партия и кратность упаковки пока не учитываются.</p></details>`;
  app.querySelector('.stats').after(panel);
  const draw=plan=>{panel.querySelector('#budget-result').innerHTML=`<div class="budget-metrics"><div><span>Предложено потратить</span><strong>${money(plan.spent)}</strong></div><div><span>Остаток бюджета</span><strong>${money(plan.remaining)}</strong></div><div><span>Включено / отложено, шт.</span><strong>${plan.quantity} / ${plan.deferred}</strong></div></div>${plan.lines.length?`<div class="table-wrap"><table><thead><tr><th>Товар · приоритет</th><th>Нужно</th><th>В бюджет</th><th>Отложено</th><th>Сумма</th></tr></thead><tbody>${plan.lines.map((p,i)=>`<tr><td>${i+1}. ${esc(p.name)}<small class="meta">${p.unpriced?' · уточните цену':''}</small></td><td>${p.suggested}</td><td><strong>${p.quantity}</strong></td><td>${p.deferred}</td><td>${money(p.spend)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="note">По текущему прогнозу пополнение не требуется.</p>'}<div class="toolbar"><button class="button" id="clear-budget">Сбросить сценарий</button><button class="button" id="export-budget">Скачать сценарий CSV</button><button class="button primary" id="use-budget" ${plan.quantity?'':'disabled'}>Подготовить заказ по сценарию →</button></div><p class="meta">Количество перенесётся в форму нового заказа. Перед отправкой выберите товары одного поставщика и подтвердите заказ.</p>`;
    panel.querySelector('#clear-budget').onclick=()=>{saved=null;amount='';panel.querySelector('#purchase-budget').value='';panel.querySelector('#budget-result').innerHTML='';notify('Сценарий сброшен. В форме заказа снова используется полный план.');};
    panel.querySelector('#export-budget').onclick=()=>{const quote=v=>'"'+String(v).replace(/^[=+\-@]/,"'$&").replaceAll('"','""')+'"';const text=['sku,name,needed,quantity,deferred,estimated_cost',...plan.lines.map(p=>[p.sku,p.name,p.suggested,p.quantity,p.deferred,p.spend].map(quote).join(','))].join('\n');const u=URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='qadam-budget-plan.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
    panel.querySelector('#use-budget').onclick=()=>{saved={key:signature(r,source),plan};location.hash='suppliers';};
  };
  panel.querySelector('#budget-form').onsubmit=e=>{e.preventDefault();amount=panel.querySelector('#purchase-budget').value;try{const plan=allocateBudget(r.products,Number(amount));saved={key:signature(r,source),plan};draw(plan);notify('Сценарий рассчитан. Заказ не отправлен.');}catch(error){notify(error.message);}};
  const prior=budgetSelection(r,source);if(prior)draw(prior);
}
