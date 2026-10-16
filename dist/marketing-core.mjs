/** Marketing metrics are platform-attributed events, never deduplicated customers.
 * Recommendations are transparent rules, not predictions or automated ad changes.
 */
export const MARKETING_HEADERS = ['date','platform','account_id','campaign_id','campaign','currency','attribution','spend','impressions','clicks','leads','purchases','revenue'];
const mktNumberKeys = MARKETING_HEADERS.slice(7);
const mktCountKeys = new Set(['impressions','clicks','leads','purchases']);
const mktPlatforms = new Set(['instagram','facebook','google','tiktok','other']);
const mktMaxRows = 5000, mktMaxBytes = 1024 * 1024, mktDay = 86400000;
const mktAttributionPattern = /^(?:(?:1|7|14|28|30|60|90)d_click(?:_(?:1|7)d_view)?|(?:1|7)d_view)$/;
const mktDateNumber = date => Date.parse(date + 'T00:00:00Z');
const mktDateShift = (date, days) => new Date(mktDateNumber(date) + days * mktDay).toISOString().slice(0,10);
const mktCampaignKey = row => JSON.stringify([row.platform,row.account_id,row.campaign_id]);
const mktCompare = (a,b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform) || a.account_id.localeCompare(b.account_id) || a.campaign_id.localeCompare(b.campaign_id);

function mktNormalizeRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Ожидалась строка с полями рекламного отчёта.');
  if (Object.keys(row).length !== MARKETING_HEADERS.length || MARKETING_HEADERS.some(key => !Object.hasOwn(row,key))) throw Error('Нужны ровно колонки: ' + MARKETING_HEADERS.join(', ') + '.');
  const result = {};
  for (const key of MARKETING_HEADERS.slice(0,7)) {
    if (typeof row[key] !== 'string') throw Error(key + ': требуется текст.');
    result[key] = row[key].trim();
    if (!result[key] || /[\u0000-\u001f\u007f]/.test(result[key])) throw Error(key + ': пустое значение или управляющие символы.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) || !Number.isFinite(mktDateNumber(result.date)) || new Date(mktDateNumber(result.date)).toISOString().slice(0,10) !== result.date) throw Error('date: нужна реальная дата YYYY-MM-DD.');
  result.platform = result.platform.toLowerCase();
  if (!mktPlatforms.has(result.platform)) throw Error('platform: instagram, facebook, google, tiktok или other.');
  if (result.account_id.length > 100 || result.campaign_id.length > 100 || result.campaign.length > 200) throw Error('Идентификаторы — до 100 символов, название кампании — до 200.');
  result.currency = result.currency.toUpperCase();
  if (result.currency !== 'KZT') throw Error('В пилоте поддерживается только KZT. Не смешивайте валюты.');
  if (!mktAttributionPattern.test(result.attribution)) throw Error('attribution: укажите окно атрибуции, например 7d_click или 7d_click_1d_view.');
  for (const key of mktNumberKeys) {
    const value = row[key];
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:[.,]\d+)?$/.test(value.trim()))) throw Error(key + ': требуется явное неотрицательное число; неизвестное значение нельзя заменять нулём.');
    const number = typeof value === 'number' ? value : Number(value.trim().replace(',','.'));
    if (!Number.isFinite(number) || number < 0 || number > 1e9 || (mktCountKeys.has(key) && !Number.isInteger(number))) throw Error(key + ': значение должно быть от 0 до 1 000 000 000' + (mktCountKeys.has(key) ? ', целое.' : '.'));
    result[key] = Object.is(number,-0) ? 0 : number;
  }
  // A click count must use the same report scope as impressions. Leads and
  // purchases may include view-through / repeat events, so are not bounded by clicks.
  if (result.clicks > result.impressions) throw Error('clicks не может превышать impressions в одной строке отчёта.');
  return result;
}

function mktValidateCollection(rows, lines) {
  const errors = [], normalized = [], seen = new Set(), groups = new Map();
  if (!Array.isArray(rows) || !rows.length || rows.length > mktMaxRows) return {rows:[],errors:[{message:'Нужно от 1 до 5 000 строк рекламных данных.'}]};
  for (let index = 0; index < rows.length; index++) {
    try {
      const row = mktNormalizeRow(rows[index]), key = mktCampaignKey(row), unique = JSON.stringify([row.date,key]);
      if (seen.has(unique)) throw Error('Повтор даты и кампании: ' + row.date + ', ' + row.campaign_id + '.');
      seen.add(unique);
      let group = groups.get(key);
      if (!group) { group = {first:row,rows:[]}; groups.set(key,group); }
      if (['campaign','currency','attribution'].some(field => group.first[field] !== row[field])) throw Error('У одной кампании различаются название, валюта или окно атрибуции. Согласуйте их перед импортом.');
      group.rows.push(row);
      normalized.push(row);
    } catch (error) { errors.push({line:lines?.[index],message:error.message}); }
  }
  if (errors.length) return {rows:[],errors};
  for (const {first,rows:series} of groups.values()) {
    series.sort(mktCompare);
    if (series.some((row,index) => index && mktDateNumber(row.date) - mktDateNumber(series[index-1].date) !== mktDay)) errors.push({message:first.campaign + ': пропущены дни. Добавьте нулевые строки только для подтверждённых дней без активности.'});
  }
  for (const key of mktNumberKeys) {
    const total = normalized.reduce((sum,row) => sum + row[key],0);
    if (!Number.isFinite(total) || total > 1e12) errors.push({message:key + ': сумма превышает допустимые 1 000 000 000 000.'});
  }
  return {rows:errors.length ? [] : normalized.sort(mktCompare),errors};
}

/** Sanitizes all rows, checks continuity/identity, and throws on any error. */
export function validateMarketingRows(rows) {
  const result = mktValidateCollection(rows);
  if (result.errors.length) throw Error(result.errors[0].message);
  return result.rows;
}

function mktReadCSV(text) {
  const records = [], lines = [];
  const firstLine = text.split(/[\r\n]/,1)[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  let fields = [], field = '', quoted = false, closed = false, line = 1, recordLine = 1;
  const record = () => {
    fields.push(field.trim());
    if (fields.some(Boolean)) { records.push(fields); lines.push(recordLine); }
    fields = []; field = ''; closed = false;
    if (records.length > mktMaxRows + 1) throw Error('Максимум 5 000 строк на один импорт.');
  };
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (quoted) {
      if (c === '"') { if (text[index+1] === '"') { field += '"'; index++; } else { quoted = false; closed = true; } }
      else { field += c; if (c === '\n' || (c === '\r' && text[index+1] !== '\n')) line++; }
      continue;
    }
    if (c === '"') { if (field || closed) throw Error('Некорректные кавычки в CSV, строка ' + line + '.'); quoted = true; }
    else if (c === delimiter) { fields.push(field.trim()); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') { record(); if (c === '\r' && text[index+1] === '\n') index++; line++; recordLine = line; }
    else if (closed) { if (!/\s/.test(c)) throw Error('Символ после закрывающей кавычки, строка ' + line + '.'); }
    else field += c;
  }
  if (quoted) throw Error('В CSV не закрыта кавычка.');
  record();
  return {records,lines};
}

/** Always returns {rows,errors}; invalid files never return partially accepted rows. */
export function parseMarketingCSV(text) {
  try {
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > mktMaxBytes) throw Error('CSV должен быть текстом размером не больше 1 МБ.');
    const {records,lines} = mktReadCSV(text.replace(/^\uFEFF/,''));
    if (records.length < 2) throw Error('Нужны заголовки и хотя бы одна строка рекламных данных.');
    const headers = records.shift().map(header => header.toLowerCase()); lines.shift();
    if (headers.length !== MARKETING_HEADERS.length || new Set(headers).size !== headers.length || MARKETING_HEADERS.some(key => !headers.includes(key))) throw Error('Нужны ровно колонки: ' + MARKETING_HEADERS.join(', ') + '.');
    const errors = [];
    const rows = records.map((cells,index) => {
      if (cells.length !== headers.length) errors.push({line:lines[index],message:'Количество полей не совпадает с заголовком.'});
      return Object.fromEntries(headers.map((header,i) => [header,cells[i]]));
    });
    if (errors.length) return {rows:[],errors};
    return mktValidateCollection(rows,lines);
  } catch (error) { return {rows:[],errors:[{message:error.message}]}; }
}

/** Quotes every value and neutralizes spreadsheet formula prefixes. */
export function marketingCSV(rows) {
  const valid = validateMarketingRows(rows);
  const encode = value => {
    let text = String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return MARKETING_HEADERS.join(',') + '\n' + valid.map(row => MARKETING_HEADERS.map(key => encode(row[key])).join(',')).join('\n');
}

function mktMetrics(rows) {
  const totals = Object.fromEntries(mktNumberKeys.map(key => [key,rows.reduce((sum,row) => sum + row[key],0)]));
  const ratio = (a,b) => b > 0 && Number.isFinite(a / b) ? a / b : null;
  return {...totals,ctr:totals.impressions > 0 ? totals.clicks / totals.impressions * 100 : null,cpc:ratio(totals.spend,totals.clicks),cpa:ratio(totals.spend,totals.purchases),roas:ratio(totals.revenue,totals.spend)};
}

function mktRecommendation(mature, settings, comparable, stale) {
  const {days,metrics} = mature, {targetCPA,minPurchases} = settings;
  const result = (action,label,reason) => ({action,label,reason});
  if (stale) return result('observe','Обновить данные','Кампания заканчивается раньше общего периода. Обновите отчёт перед решением о бюджете.');
  if (days < 7) return result('observe','Накопить данные','Нужно минимум 7 полных дней после исключения задержки атрибуции. Сейчас: ' + days + '.');
  if (metrics.purchases === 0 && metrics.spend >= targetCPA * minPurchases) return result('check-tracking','Проверить покупки','Есть расходы, но нет приписанных покупок. Проверьте передачу событий и путь клиента; это не основание автоматически отключать рекламу.');
  if (!comparable) return result('observe','Согласовать атрибуцию','В файле разные окна атрибуции. Для рекомендаций по бюджету загрузите сопоставимый отчёт с одним окном.');
  if (metrics.purchases < minPurchases) return result('observe','Накопить покупки','Для бюджетного решения нужно минимум ' + minPurchases + ' приписанных покупок за полные дни. Сейчас: ' + metrics.purchases + '.');
  if (metrics.cpa < targetCPA * 0.8) return result('increase-test','Проверить увеличение','Стоимость приписанной покупки ниже 80% целевой. Можно протестировать небольшой рост бюджета и проверить, сохранится ли результат.');
  if (metrics.cpa > targetCPA * 1.3) return result('review-reduce','Рассмотреть сокращение','Стоимость приписанной покупки выше 130% целевой. Проверьте маржу, события и креативы перед сокращением бюджета.');
  return result('observe','Наблюдать','Стоимость приписанной покупки близка к целевой. Данных для изменения бюджета по этому правилу нет.');
}

/**
 * Output: start/end/matureEnd; settings; summary (all-period metrics);
 * campaigns[] with metrics, mature:{start,end,days,metrics}, recommendation;
 * platforms[] partitioned by platform AND attribution; attributionGroups[];
 * warnings[]. ctr is percent; cpc/cpa are KZT; roas is a ratio; undefined
 * denominators yield null. Global mixed-attribution budget recommendations
 * are suppressed. No winner, unique customer count or causal claim is inferred.
 */
export function analyzeMarketing(rows, {targetCPA=3000,minPurchases=10,lagDays=2}={}) {
  if (!Number.isFinite(targetCPA) || targetCPA <= 0 || targetCPA > 1e9 || !Number.isInteger(minPurchases) || minPurchases < 1 || minPurchases > 1e6 || !Number.isInteger(lagDays) || lagDays < 0 || lagDays > 90) throw Error('Проверьте целевую стоимость покупки, минимум покупок и задержку атрибуции.');
  const valid = validateMarketingRows(rows), start = valid[0].date, end = valid.at(-1).date, matureEnd = mktDateShift(end,-lagDays);
  const settings = {targetCPA,minPurchases,lagDays}, groupMap = new Map(), attributionMap = new Map(), platformMap = new Map();
  for (const row of valid) {
    const key = mktCampaignKey(row), platformKey = JSON.stringify([row.platform,row.attribution]);
    for (const [map,groupKey] of [[groupMap,key],[attributionMap,row.attribution],[platformMap,platformKey]]) {
      if (!map.has(groupKey)) map.set(groupKey,[]);
      map.get(groupKey).push(row);
    }
  }
  const comparable = attributionMap.size === 1;
  const campaigns = [...groupMap].map(([key,series]) => {
    const first = series[0], last = series.at(-1), matureRows = series.filter(row => row.date <= matureEnd);
    const mature = {start:matureRows[0]?.date ?? null,end:matureRows.at(-1)?.date ?? null,days:matureRows.length,metrics:mktMetrics(matureRows)};
    return {key,platform:first.platform,account_id:first.account_id,campaign_id:first.campaign_id,campaign:first.campaign,currency:first.currency,attribution:first.attribution,start:first.date,end:last.date,days:series.length,metrics:mktMetrics(series),mature,recommendation:mktRecommendation(mature,settings,comparable,last.date !== end)};
  }).sort((a,b) => b.metrics.spend - a.metrics.spend || a.key.localeCompare(b.key));
  const platforms = [...platformMap].map(([key,series]) => ({key,platform:series[0].platform,attribution:series[0].attribution,start:series[0].date,end:series.at(-1).date,campaignCount:new Set(series.map(mktCampaignKey)).size,metrics:mktMetrics(series)}));
  const attributionGroups = [...attributionMap].map(([attribution,series]) => ({attribution,campaignCount:new Set(series.map(mktCampaignKey)).size,metrics:mktMetrics(series)}));
  const warnings = ['Покупки приписаны рекламными платформами. Один человек или заказ может учитываться в нескольких платформах; это не число уникальных клиентов.','Все даты должны использовать один часовой пояс и полные календарные дни. Часовой пояс не указан в CSV: проверьте настройки рекламных отчётов перед сравнением.','Рекомендации основаны на правилах и наблюдениях, не доказывают влияние рекламы и не изменяют бюджеты автоматически.','ROAS сравнивает приписанную выручку с рекламными расходами; себестоимость, доставка, возвраты и комиссии здесь не вычтены.'];
  if (!comparable) warnings.push('Разные окна атрибуции: платформы показаны отдельно, рекомендации по изменению бюджета приостановлены.');
  if (campaigns.some(campaign => campaign.end !== end)) warnings.push('Кампании заканчиваются в разные даты. Для отставших кампаний рекомендации приостановлены.');
  if (new Set(campaigns.map(campaign => campaign.start)).size > 1) warnings.push('Начальные даты кампаний различаются: итоговые суммы охватывают разные периоды.');
  return {start,end,matureEnd,currency:'KZT',settings,comparable,summary:mktMetrics(valid),campaigns,platforms,attributionGroups,warnings};
}

export function marketingDemo() {
  const campaigns = [
    {platform:'instagram',account_id:'demo-meta',campaign_id:'ig-care',campaign:'Instagram · уход',spend:5400,impressions:6500,clicks:180,leads:12,purchases:4,revenue:31600},
    {platform:'google',account_id:'demo-google',campaign_id:'search-care',campaign:'Google · поиск',spend:9000,impressions:4100,clicks:100,leads:5,purchases:2,revenue:15800},
    {platform:'tiktok',account_id:'demo-tiktok',campaign_id:'video-care',campaign:'TikTok · видео',spend:3200,impressions:12000,clicks:170,leads:4,purchases:0,revenue:0},
    {platform:'facebook',account_id:'demo-meta',campaign_id:'fb-care',campaign:'Facebook · каталог',spend:6000,impressions:4500,clicks:80,leads:6,purchases:2,revenue:15800}
  ];
  const rows = [];
  for (let day = 0; day < 16; day++) for (const campaign of campaigns) {
    const factor = day % 7 === 5 || day % 7 === 6 ? 1.2 : 1;
    rows.push({date:mktDateShift('2026-09-22',day),...campaign,currency:'KZT',attribution:'7d_click',spend:campaign.spend * factor,impressions:Math.round(campaign.impressions * factor),clicks:Math.round(campaign.clicks * factor),leads:campaign.leads,purchases:campaign.purchases,revenue:campaign.revenue});
  }
  return validateMarketingRows(rows);
}
