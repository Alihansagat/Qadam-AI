export function draftOrder(supplier,products,quantities){
  const name=String(supplier.name??'').trim(),handle=String(supplier.handle??'').trim().replace(/^@/,'');
  if(!name||name.length>120)throw Error('Укажите имя поставщика, до 120 символов.');
  if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(handle))throw Error('Укажите Telegram username поставщика: например, @supplier_name.');
  const lines=products.map(p=>{const q=Number(quantities[p.sku]??0);if(!Number.isInteger(q)||q<0||q>1000000)throw Error('Количество: целое число от 0 до 1 000 000.');return {sku:p.sku,name:p.name,quantity:q,cost:p.cost};}).filter(p=>p.quantity>0);
  if(!lines.length)throw Error('Выберите хотя бы один товар с количеством больше нуля.');
  const order={id:crypto.randomUUID(),supplier:{name,handle},lines,status:'draft',createdAt:new Date().toISOString(),estimate:lines.reduce((s,p)=>s+p.quantity*p.cost,0)};
  order.message=`Здравствуйте, ${name}! Хотим заказать:\n\n${lines.map(p=>`${p.name} (${p.sku}) — ${p.quantity} шт.`).join('\n')}\n\nПодтвердите, пожалуйста, наличие, итоговую стоимость, срок поставки и реквизиты для оплаты. Оплату сделаем после согласования.`;
  return order;
}
export function recordInvoice(order,{amount,due,note}){
  if(!['draft','awaiting_payment'].includes(order.status))throw Error('Для этого статуса нельзя добавить счёт.');
  const value=Number(amount);
  if(!Number.isFinite(value)||value<=0||value>1e12)throw Error('Укажите подтверждённую поставщиком сумму больше нуля.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due+'T00:00:00Z'))||new Date(due+'T00:00:00Z').toISOString().slice(0,10)!==due)throw Error('Укажите реальную дату оплаты.');
  if(String(note).length>1000)throw Error('Комментарий: не больше 1000 символов.');
  return {...order,status:'awaiting_payment',invoice:{amount:value,due,note:String(note).trim(),source:'manual'}};
}
export function transition(order,status){
  const next={draft:['cancelled'],sent:['cancelled'],awaiting_payment:['paid','cancelled'],paid:['received'],received:[],cancelled:[]};
  if(!next[order.status]?.includes(status))throw Error('Недопустимая смена статуса заказа.');
  return {...order,status};
}
