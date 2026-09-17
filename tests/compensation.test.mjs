import test from 'node:test';import assert from 'node:assert/strict';
import {parseCompensation,toAnnualSalary} from '../compensation.mjs';
import {buildSalaryFilter} from '../scan.mjs';
const parse=(raw,period='month',currency='CNY')=>parseCompensation({raw,period,currency,evidence:[{field:'visibleText',quote:`人民币${period==='year'?'年薪':period==='day'?'日薪':'月薪'}${raw}`} ]});
test('monthly range uses 12 months for comparison and preserves advertised 13 payments separately',()=>{
 const c=parse('30–50K·13薪');assert.equal(c.raw,'30–50K·13薪');assert.equal(c.min,30000);assert.equal(c.max,50000);
 assert.deepEqual(toAnnualSalary(c),{min:360000,max:600000,currency:'CNY'});
 assert.deepEqual(c.advertisedAnnualCash,{min:390000,max:650000,currency:'CNY'});assert.equal(c.guaranteedPayments,null);
 assert.equal(buildSalaryFilter({min:300000,currency:'CNY'})(toAnnualSalary(c)),true);
 assert.equal(buildSalaryFilter({min:300000,currency:'CNY'})(toAnnualSalary(parse('10–15K'))),false);
});
test('explicit monthly/annual amounts, one-sided ranges and variable components',()=>{
 assert.deepEqual(toAnnualSalary(parse('2–3万元/月')),{min:240000,max:360000,currency:'CNY'});
 assert.deepEqual(toAnnualSalary(parse('40–60万/年','year')),{min:400000,max:600000,currency:'CNY'});
 assert.deepEqual(toAnnualSalary(parse('50K以下')),{max:600000,currency:'CNY'});
 assert.deepEqual(toAnnualSalary(parse('30K以上')),{min:360000,currency:'CNY'});
 assert.equal(parse('综合薪资30–50K（含浮动）').componentsUnknown,true);
});
test('unverifiable units, currency, encoded values and contradictory ranges remain incomparable',()=>{
 for(const c of [parse('面议'),parse('300–500元/天','day'),parse('30–50K',null),parse('30–50K','month',null),parse('50–30K'),parse('30–50K/月或40–60万/年'),parse('\uE0340–50K'),parse('30–50K/年','month'),parseCompensation({raw:'30–50K',period:'month',currency:'CNY',evidence:[]})]) assert.equal(toAnnualSalary(c),undefined,JSON.stringify(c));
});
test('conflicting period evidence and annualization overflow stay incomparable',()=>{
 const c=parseCompensation({raw:'30-50K',currency:'CNY',period:'month',evidence:[{field:'visibleText',quote:'人民币年薪30-50K'}]});
 assert.equal(toAnnualSalary(c),undefined);
 const huge=parseCompensation({raw:'1'+'0'.repeat(308),currency:'CNY',period:'month',evidence:[{field:'visibleText',quote:'人民币月薪'}]});
 assert.equal(toAnnualSalary(huge),undefined);assert.equal(huge.annualizedMonthly,null);
});
test('a rate expressed per hour, week or visit is never read as a monthly or yearly salary',()=>{
 // Frozen BOSS observations contain "80-250元/时" stored as period=month. The
 // parser and the annualizer must both refuse it, so a stale snapshot cannot
 // leak an hourly rate into a monthly distribution as 165 CNY/month.
 for(const raw of ['80-250元/时','80-250元/小时','200-300元/周','500元/次','300元/人天','80-250元/hour']){
  const c=parseCompensation({raw,currency:'CNY',period:'month',evidence:[{field:'visibleText',quote:raw}]});
  assert.equal(c.status,'unknown',raw);assert.equal(c.min,null,raw);
  assert.equal(toAnnualSalary(c),undefined,raw);
 }
 // A frozen fact that still claims period=month stays incomparable downstream.
 assert.equal(toAnnualSalary({raw:'80-250元/时',currency:'CNY',period:'month',min:80,max:250,status:'parsed'}),undefined);
 // Expressible periods and payment counts are untouched.
 assert.equal(parseCompensation({raw:'200-300元/天',currency:'CNY',period:'day',evidence:[{field:'visibleText',quote:'200-300元/天'}]}).status,'parsed');
 assert.equal(parse('40-70K·15薪').min,40000);
});
test('advertised 30 payments retain the salary range without an arbitrary 24-payment ceiling',()=>{
 const c=parse('100-200K·30薪');assert.equal(c.min,100000);assert.equal(c.max,200000);assert.equal(c.paymentsPerYear,30);assert.equal(c.guaranteedPayments,null);assert.deepEqual(toAnnualSalary(c),{min:1200000,max:2400000,currency:'CNY'});
});
