import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {demo,analyze} from '../dist/core.mjs';
import {fingerprint,validateReport} from '../dist/ml.mjs';
const report=JSON.parse(await readFile(new URL('../dist/models/demo-ml.json',import.meta.url),'utf8'));
test('fingerprint ignores row order but rejects different sales or inventory',async()=>{
  const rows=demo();assert.equal(await fingerprint(rows),await fingerprint([...rows].reverse()));
  const other=rows.map(r=>({...r}));other[0].units++;await assert.rejects(validateReport(report,other),/другого набора/);
  other[0].units--;other[0].stock++;await assert.rejects(validateReport(report,other),/другого набора/);
});
test('real report adds two models and integrates manual forecasts with procurement',async()=>{
  const rows=demo(),ml=await validateReport(report,rows),r=analyze(rows,30,30,{ml,methods:new Map([['Q-001','catboost']])});
  const p=r.products.find(p=>p.sku==='Q-001');assert.equal(p.validation.candidates.length,7);assert.equal(p.method,'catboost');
  assert.deepEqual(p.forecast,report.products['Q-001'].models.catboost.forecast.slice(0,37));
  assert.equal(p.total,p.forecast.slice(0,30).reduce((a,b)=>a+b,0));assert.equal(p.suggested,Math.max(0,Math.ceil(p.target-p.stock-p.on_order)));
  assert.equal(analyze(rows).products[0].validation.candidates.length,5);
});
test('bad vectors and mismatched anomaly dates are rejected',async()=>{
  for(const mutate of [r=>r.products['Q-001'].models.catboost.forecast.pop(),r=>r.products['Q-001'].models.lightgbm.test[0]=-1,r=>r.products['Q-001'].anomalies[0].date='2020-01-01']){
    const bad=structuredClone(report);mutate(bad);await assert.rejects(validateReport(bad,demo()));
  }
});
