import {test} from 'node:test';import assert from 'node:assert/strict';
import {applySalaryDefaults,applyChannelDefault} from '../../china/market-defaults.mjs';
const policy={currency:'CNY',period:'month',channel:'hr'};
test('configured domestic defaults parse K range and pay months but preserve explicit daily/USD units',()=>{
 let c=applySalaryDefaults({raw:'40-70K·15薪',evidence:[]},policy);assert.equal(c.min,40000);assert.equal(c.max,70000);assert.equal(c.currency,'CNY');assert.equal(c.paymentsPerYear,15);
 c=applySalaryDefaults({raw:'200-300元/天',period:'day',currency:'CNY',evidence:[]},policy);assert.equal(c.period,'day');assert.equal(c.min,200);
 c=applySalaryDefaults({raw:'USD 40-70K/year',currency:'USD',period:'year',evidence:[]},policy);assert.equal(c.currency,'USD');assert.equal(c.period,'year');
});
test('an explicit non-monthly unit is never overwritten by the monthly default',()=>{
 // The pool contained "80-250元/时". The default filled in period=month, which
 // turned an hourly rate into a 165 CNY/month salary and dragged the low end of
 // every salary distribution with it. A unit the shared parser cannot express
 // must stay unknown instead of being relabelled as monthly.
 for(const raw of ['80-250元/时','80-250元/小时','200元/周','500元/次','300元/人天']){
  const c=applySalaryDefaults({raw,evidence:[]},policy);
  assert.equal(c.period,null,raw);assert.equal(c.status,'unknown',raw);assert.equal(c.min,null,raw);
 }
 // Units the parser does express keep being defaulted in as before.
 let c=applySalaryDefaults({raw:'200-300元/天',evidence:[]},policy);
 assert.equal(c.period,'day');assert.equal(c.min,200);
 c=applySalaryDefaults({raw:'40-70K·15薪',evidence:[]},policy);
 assert.equal(c.period,'month');assert.equal(c.min,40000);
});
test('only unknown channels get a labelled HR default, never overwrite known headhunters',()=>{
 assert.equal(applyChannelDefault({value:'unknown'},policy).value,'hr');assert.equal(applyChannelDefault({value:'unknown'},policy).status,'assumed');assert.equal(applyChannelDefault({value:'headhunter'},policy).value,'headhunter');
});
