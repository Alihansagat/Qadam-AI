// Progressive disclosure keeps explanations accessible without crowding results.
function fold(element,title){
  if(!element)return;
  const details=document.createElement('details'),summary=document.createElement('summary');
  details.className='disclosure';summary.textContent=title;element.before(details);details.append(summary,element);return details;
}
export function simplify(app,view){
  const h1=app.querySelector('h1'),subtitle=app.querySelector('.subtitle');
  const copy={overview:['Обзор продаж','Главное за последние 14 дней.'],forecast:['Прогноз спроса','Сколько товара может понадобиться.'],actions:['План закупок','Количество, бюджет и приоритет.'],import:['Ваши данные','Один товар за день · один магазин · валюта ₸.']};
  h1.textContent=copy[view][0];subtitle.textContent=copy[view][1];
  if(view==='overview'){
    const grid=app.querySelector('.grid-main'),leaders=grid.children[1];
    const details=fold(leaders,'Лидеры продаж');details.classList.add('panel','leaders');
    grid.after(details);leaders.classList.remove('panel');leaders.querySelector('.panel-head').remove();
    const catalog=app.querySelector('.catalog-toolbar').closest('.panel');catalog.classList.add('catalog-section');
    const children=[...catalog.children].filter(x=>!x.classList.contains('panel-head'));
    const content=document.createElement('div');catalog.append(content);content.append(...children);fold(content,'Посмотреть ассортимент');
    app.querySelector('.grid-main .meta').textContent='Выручка, ₸';
  }
  if(view==='forecast'){
    const methods=app.querySelector('.evaluation-grid');
    const details=fold(methods,'Подробнее: сравнение методов и точность');details.classList.add('panel');
    app.querySelector('.legend .hint')?.remove();
    app.querySelector('.method-note').textContent=app.querySelector('.method-note').textContent.replace(' Выбранный метод также используется в плане закупок этого товара.',' Этот метод используется и для закупок.');
    const limit=app.querySelector('.test-panel details .note');
    limit.textContent='Акции, изменение цены и спрос при дефиците не учитываются. ML-модели обучены отдельно; остальные методы используют фиксированные параметры. Интервалы неопределённости пока не рассчитываются. Исторический тест не гарантирует будущую точность.';
  }
  if(view==='actions'){
    const settings=app.querySelector('.panel');
    const explanation=document.createElement('div');explanation.append(...[...settings.children].filter(x=>!x.classList.contains('toolbar')));settings.append(explanation);fold(explanation,'Как рассчитан план');
    for(const card of app.querySelectorAll('.action-card'))fold(card.querySelector('.note'),'Почему столько');
  }
  if(view==='import'){
    app.querySelector('.steps').remove();
    const schema=app.querySelector('.schema'),demo=schema.querySelector('#demo');
    schema.after(demo);demo.classList.add('reset-demo');schema.querySelector('.panel-head').remove();
    const content=document.createElement('div');content.append(...schema.childNodes);schema.append(content);fold(content,'Формат CSV и требования к данным');
    app.querySelector('.upload-box h2').textContent='Загрузите продажи';
    app.querySelector('.upload-box .note').textContent='CSV · UTF-8 · до 10 МБ';
  }
}
