import test from 'node:test';import assert from 'node:assert/strict';import * as yaml from 'js-yaml';
import {reportToObservation,fold} from '../salary-gap.mjs';
import {validateNormalizedCompensation} from '../compensation.mjs';
const summary=()=>({company:'合成公司',role:'AI工程师',advertised_comp:'30–50K·13薪',advertised_comp_normalized:{raw:'30–50K·13薪',currency:'CNY',period:'year',min:360000,max:600000,basis:'monthly_x12',evidence:[{field:'visibleText',quote:'人民币月薪30–50K·13薪'}]}});
const report=s=>`## Machine Summary\n\n\`\`\`yaml\n${yaml.dump(s)}\`\`\`\n`;
test('salary-gap consumes annualized amounts while retaining advertised text and original fold',()=>{
 const observation=reportToObservation(report(summary()),'001','2026-09-12').observation;
 assert.equal(observation.amount,'30–50K·13薪');assert.deepEqual(observation.parsed,{min:360000,max:600000,mid:480000});assert.equal(observation.currency,'CNY');
 const actual={num:'001',date:'2026-09-12',type:'actual',amount:'480000',currency:'CNY',source:'contract',parsed:{min:480000,max:480000,mid:480000}};
 const result=fold([observation,actual],{'001':{company:'合成公司',role:'AI工程师'}},{amount:'480000',currency:'CNY'});
 assert.equal(result.applications[0].advToActPct,0);assert.equal(result.applications[0].desiredToActPct,0);
});
test('invalid normalization and monthly legacy values cannot enter annual comparisons',()=>{
 for(const change of [s=>delete s.advertised_comp_normalized.period,s=>s.advertised_comp_normalized.raw='40K',s=>s.advertised_comp_normalized.currency='USD',s=>s.advertised_comp_normalized.min=-1,s=>s.advertised_comp_normalized.min=1,s=>s.advertised_comp_normalized.evidence=[]]){
  const s=summary();change(s);assert.equal(validateNormalizedCompensation(s),null);assert.equal(reportToObservation(report(s),'001','2026-09-12').observation.parsed,null);
 }
 const s=summary();delete s.advertised_comp_normalized;assert.equal(reportToObservation(report(s),'001','2026-09-12').observation.parsed,null);
 assert.deepEqual(reportToObservation(report({company:'Old',role:'Dev',advertised_comp:'80-90k EUR'}),'002','2026-09-12').observation.parsed,{min:80000,max:90000,mid:85000});
});
test('one-sided normalized ranges have no midpoint or gap',()=>{
 const s=summary();s.advertised_comp='50K以下';Object.assign(s.advertised_comp_normalized,{raw:'50K以下',min:null,max:600000,evidence:[{field:'visibleText',quote:'人民币月薪50K以下'}]});
 const obs=reportToObservation(report(s),'001','2026-09-12').observation;
 assert.deepEqual(obs.parsed,{min:null,max:600000,mid:null});
 assert.equal(fold([obs],{'001':{company:'合成公司',role:'AI'}},null).applications[0].advertised,null);
});
