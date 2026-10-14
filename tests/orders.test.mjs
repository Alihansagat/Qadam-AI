import test from 'node:test';
import assert from 'node:assert/strict';
import {draftOrder,recordInvoice,transition} from '../dist/orders.mjs';
const supplier={name:'Оптовик',handle:'@supplier_test'},products=[{sku:'A',name:'Крем',cost:100},{sku:'B',name:'Гель',cost:80}];
test('draft includes only chosen goods and never marks message sent',()=>{const o=draftOrder(supplier,products,{A:3,B:0});assert.equal(o.status,'draft');assert.equal(o.estimate,300);assert.equal(o.lines.length,1);assert.ok(o.message.includes('3 шт.'));assert.throws(()=>draftOrder(supplier,products,{A:-1}));assert.throws(()=>draftOrder(supplier,products,{A:0}));});
test('invoice requires valid amount and date; payment and receipt are explicit',()=>{const o=draftOrder(supplier,products,{A:3});assert.throws(()=>transition(o,'paid'));assert.throws(()=>recordInvoice(o,{amount:0,due:'2026-10-15',note:''}));assert.throws(()=>recordInvoice(o,{amount:300,due:'2026-02-30',note:''}));const invoiced=recordInvoice(o,{amount:320,due:'2026-10-15',note:'Согласовано'});assert.equal(invoiced.invoice.source,'manual');assert.equal(transition(transition(invoiced,'paid'),'received').status,'received');assert.equal(o.status,'draft');});
