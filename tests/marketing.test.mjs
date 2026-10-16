import test from 'node:test';
import assert from 'node:assert/strict';
import {MARKETING_HEADERS,parseMarketingCSV,validateMarketingRows,marketingDemo,marketingCSV,analyzeMarketing} from '../dist/marketing-core.mjs';

const fixture = (days=9,changes={}) => Array.from({length:days},(_,index) => ({date:new Date(Date.UTC(2026,8,1+index)).toISOString().slice(0,10),platform:'instagram',account_id:'A',campaign_id:'C',campaign:'Крем',currency:'KZT',attribution:'7d_click',spend:1000,impressions:1000,clicks:20,leads:4,purchases:2,revenue:6000,...changes}));
const rawCSV = rows => MARKETING_HEADERS.join(',')+'\n'+rows.map(row=>MARKETING_HEADERS.map(key=>row[key]??'').join(',')).join('\n');

test('marketing CSV round trips demo and supports quoted fields, BOM, semicolon decimals and reordered headers',()=>{
  const rows=marketingDemo(); assert.deepEqual(parseMarketingCSV(marketingCSV(rows)),{rows,errors:[]});
  const quoted=fixture(1,{campaign:'Крем, "ночь"'}); assert.deepEqual(parseMarketingCSV(marketingCSV(quoted)).rows,quoted);
  const keys=[...MARKETING_HEADERS].reverse(), row=fixture(1)[0]; row.spend='1000,50';
  const parsed=parseMarketingCSV('\uFEFF'+keys.join(';')+'\r\n'+keys.map(key=>row[key]).join(';')+'\r\n');
  assert.deepEqual(parsed.errors,[]); assert.equal(parsed.rows[0].spend,1000.5);
});

test('marketing validation rejects missing numbers, invalid dates, gaps, duplicates, identities and mixed currency atomically',()=>{
  for(const changes of [{spend:''},{spend:null},{spend:Infinity},{spend:-1},{spend:1e10},{purchases:0.5},{date:'2026-02-30'},{platform:'unknown'},{currency:'USD'},{attribution:'unknown'},{clicks:1001},{account_id:'  '},{campaign:'bad\nname'}]) {
    assert.throws(()=>validateMarketingRows(fixture(1,changes)),JSON.stringify(changes));
  }
  assert.throws(()=>validateMarketingRows([...fixture(),fixture()[0]]),/Повтор/);
  const gap=fixture(); gap.splice(3,1); assert.throws(()=>validateMarketingRows(gap),/пропущены/);
  const changed=fixture(); changed[2].campaign='Другая'; assert.throws(()=>validateMarketingRows(changed),/различаются/);
  const missing=fixture(); delete missing[0].revenue; assert.throws(()=>validateMarketingRows(missing),/колонки/);
  const extra=fixture(1); extra[0].unexpected=1; assert.throws(()=>validateMarketingRows(extra),/колонки/);
  const parsed=parseMarketingCSV(rawCSV(fixture(2,{spend:''}))); assert.equal(parsed.rows.length,0); assert.equal(parsed.errors[0].line,2);
});

test('marketing parser rejects malformed CSV, oversized bytes, extra headers and too many rows',()=>{
  for(const csv of ['',MARKETING_HEADERS.join(','),rawCSV(fixture(1)).replace('Крем','"Крем'),rawCSV(fixture(1)).replace('Крем','"Крем"oops'),MARKETING_HEADERS.join(',')+',extra\n'+Object.values(fixture(1)[0]).join(',')+',value','ы'.repeat(524289)]) assert.ok(parseMarketingCSV(csv).errors.length);
  assert.throws(()=>validateMarketingRows(Array.from({length:5001},()=>fixture(1)[0])),/5 000/);
  const many=Array.from({length:1001},(_,i)=>fixture(1,{campaign_id:'C'+i,spend:1e9})[0]); assert.throws(()=>validateMarketingRows(many),/сумма/);
});

test('marketing daily series is campaign-scoped, numeric zero is legitimate and undefined ratios are null',()=>{
  const rows=fixture(9,{spend:0,impressions:0,clicks:0,leads:0,purchases:0,revenue:0});
  const result=analyzeMarketing(rows);
  assert.equal(result.campaigns[0].mature.days,7);
  for(const key of ['ctr','cpc','cpa','roas']) assert.equal(result.summary[key],null);
  assert.equal(result.campaigns[0].recommendation.action,'observe');
  assert.equal(validateMarketingRows([...rows,...fixture(3,{account_id:'Other'})]).length,12);
});

test('recommendations exclude immature last days, require seven complete days and minimum purchases',()=>{
  assert.equal(analyzeMarketing(fixture(8)).campaigns[0].recommendation.action,'observe');
  const rows=fixture(); rows[7].spend=1e8; rows[8].spend=1e8;
  const campaign=analyzeMarketing(rows).campaigns[0];
  assert.equal(campaign.mature.metrics.spend,7000); assert.equal(campaign.mature.metrics.cpa,500);
  assert.equal(campaign.recommendation.action,'increase-test');
  assert.equal(analyzeMarketing(fixture(9,{purchases:1})).campaigns[0].recommendation.action,'observe');
  assert.equal(analyzeMarketing(fixture(9,{purchases:2,spend:9000})).campaigns[0].recommendation.action,'review-reduce');
  assert.equal(analyzeMarketing(fixture(9,{purchases:0,spend:6000})).campaigns[0].recommendation.action,'check-tracking');
  assert.equal(analyzeMarketing(fixture(9,{purchases:0,spend:100})).campaigns[0].recommendation.action,'observe');
});

test('mixed attribution windows and stale series cannot trigger budget changes',()=>{
  const mixed=[...fixture(),...fixture(9,{campaign_id:'D',attribution:'1d_click'})];
  const result=analyzeMarketing(mixed);
  assert.equal(result.comparable,false); assert.equal(result.platforms.length,2); assert.equal(result.attributionGroups.length,2);
  assert.ok(result.campaigns.every(row=>row.recommendation.action==='observe'));
  const stale=analyzeMarketing([...fixture(9),...fixture(11,{campaign_id:'D'})]);
  assert.equal(stale.campaigns.find(row=>row.campaign_id==='C').recommendation.action,'observe');
  assert.match(stale.warnings.join(' '),/не число уникальных клиентов/);
});

test('metrics use sums and weighted ratios; input/settings are validated and CSV formula fields are neutralized',()=>{
  const rows=fixture(); rows[0].impressions=2000; rows[0].clicks=40;
  const result=analyzeMarketing(rows);
  assert.equal(result.summary.ctr,2); assert.equal(result.summary.cpc,45); assert.equal(result.summary.cpa,500); assert.equal(result.summary.roas,6);
  for(const settings of [{targetCPA:0},{targetCPA:Infinity},{lagDays:-1},{lagDays:0.5},{minPurchases:0},{minPurchases:1.5}]) assert.throws(()=>analyzeMarketing(rows,settings));
  const output=marketingCSV(fixture(1,{campaign:'=HYPERLINK("bad")',account_id:'@SUM(1)'}));
  assert.ok(output.includes('"\'=HYPERLINK(""bad"")"')); assert.ok(output.includes('"\'@SUM(1)"'));
});
