// Fixed parameters are part of the model definition, never fitted to validation/test.
// SES and damped Holt equations: https://otexts.com/fpp3/ses.html and /holt.html.
import {ML_METHODS} from './ml.mjs';
export const BASE_METHODS = {
  weekly: {name:'Как неделю назад',short:'Сезонный',description:'Повторяет продажи последней недели. Подходит для устойчивого недельного ритма.'},
  weekday: {name:'По дням недели',short:'Недельное среднее',description:'Среднее для каждого дня недели за последние четыре недели. Сглаживает отдельные скачки.'},
  moving: {name:'Среднее за 7 дней',short:'Скользящее среднее',description:'Средние продажи последней недели на каждый будущий день. Не учитывает сезонность.'},
  smoothing: {name:'Экспоненциальное сглаживание',short:'Сглаживание',description:'Придаёт больший вес недавним продажам. Коэффициент сглаживания α = 0,3; без тренда и сезонности.'},
  damped: {name:'Затухающий тренд',short:'Тренд Холта',description:'Учитывает направление изменения продаж и постепенно ослабляет тренд. α = 0,3; β = 0,1; φ = 0,9. Без сезонности.'},
};
export const METHODS={...BASE_METHODS,...ML_METHODS};
const sum=a=>a.reduce((s,n)=>s+n,0);
const mean=a=>a.length?sum(a)/a.length:0;
export function predict(history,horizon,method){
  if(!Object.hasOwn(BASE_METHODS,method)||!Number.isInteger(horizon)||horizon<1||horizon>120||!history.length)throw Error('Invalid forecast arguments');
  const values=history.map(r=>r.units);
  if(values.some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid sales history');
  let level=values[0],trend=0;
  if(method==='smoothing'||method==='damped')for(const value of values.slice(1)){
    const previous=level;
    level=.3*value+.7*(level+(method==='damped'?.9*trend:0));
    if(method==='damped')trend=.1*(level-previous)+.9*.9*trend;
  }
  let damping=0;
  return Array.from({length:horizon},(_,i)=>{
    if(method==='moving')return mean(values.slice(-7));
    if(method==='smoothing')return level;
    if(method==='damped'){damping+=.9**(i+1);return Math.max(0,level+damping*trend);}
    if(method==='weekly')return values[values.length-7+i%7]??mean(values);
    const sameDay=values.filter((_,j)=>j>=values.length-28&&(values.length+i-j)%7===0);
    return mean(sameDay.length?sameDay:values.slice(-7));
  });
}
export function metrics(actual,predicted){
  if(actual.length!==predicted.length||!actual.length)throw Error('Metric vectors must have the same nonzero length');
  const errors=predicted.map((v,i)=>v-actual[i]),absolute=sum(errors.map(Math.abs));
  return {mae:absolute/actual.length,wape:sum(actual)?absolute/sum(actual)*100:null,bias:mean(errors),rmse:Math.sqrt(mean(errors.map(v=>v*v)))};
}
export function evaluate(history,ml=null){
  if(history.length<42)return null;
  // Last 14 days are reserved for one independent evaluation if two earlier
  // validation windows and at least 28 training observations are available.
  const testDays=history.length>=70?14:0,selectionEnd=history.length-testDays;
  const folds=Math.min(3,Math.floor((selectionEnd-28)/14));
  const firstOrigin=selectionEnd-folds*14;
  const candidates=Object.keys(BASE_METHODS).map(method=>{
    const actual=[],predicted=[];
    for(let i=0;i<folds;i++){
      const origin=firstOrigin+i*14;
      predicted.push(...predict(history.slice(0,origin),14,method));
      actual.push(...history.slice(origin,origin+14).map(r=>r.units));
    }
    return {method,...metrics(actual,predicted)};
  });
  if(ml)for(const method of Object.keys(ML_METHODS))candidates.push({method,...metrics(history.slice(firstOrigin,selectionEnd).map(r=>r.units),ml.models[method].validation)});
  candidates.sort((a,b)=>a.mae-b.mae);
  const method=candidates[0].method;
  const testPrediction=testDays?(ml?.models[method]?.test??predict(history.slice(0,selectionEnd),14,method)):null;
  const test=testDays?{
    ...metrics(history.slice(selectionEnd).map(r=>r.units),testPrediction),
    method,start:history[selectionEnd].date,end:history.at(-1).date,days:14,
    actual:history.slice(selectionEnd).map(r=>r.units),predicted:testPrediction,
  }:null;
  return {...candidates[0],candidates,folds,days:folds*14,start:history[firstOrigin].date,end:history[selectionEnd-1].date,test};
}
