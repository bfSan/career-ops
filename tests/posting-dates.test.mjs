import test from 'node:test';import assert from 'node:assert/strict';
import {parsePostingDate,toPostedAt,displayPostingDate} from '../posting-dates.mjs';
import {buildPostedDateFilter,buildPostingAgeFilter,formatPipelineOffer,formatScanHistoryRow} from '../scan.mjs';
const parse=(raw,kind='published',timezone='Asia/Shanghai')=>parsePostingDate({kind,raw,observedAt:'2026-09-11T16:30:00.000Z',timezone,evidence:{field:'visibleText',quote:raw}});
test('date facts use observation timezone and preserve date semantics',()=>{
 const day=parse('今天发布');assert.equal(day.value,'2026-09-12');assert.equal(toPostedAt(day),Date.parse('2026-09-11T16:00:00Z'));
 assert.equal(parse('3天前发布').value,'2026-09-09');assert.equal(parse('发布日期：2026年9月12日').value,'2026-09-12');
 assert.equal(parse('2026-09-30','valid_through').value,'2026-09-30');
 for(const fact of [parse('今天更新','updated'),parse('今日活跃','recruiter_active'),parse('09-12发布'),parse('2026-09-12发布','published',null),parse('3天前','unknown')])assert.equal(toPostedAt(fact),undefined);
 assert.equal(parse('2026-02-30发布').value,null);
});
test('original date/age filters and writers respect day precision while legacy UTC remains unchanged',()=>{
 const day=parse('今天发布'),postedAt=toPostedAt(day),filter=buildPostedDateFilter('2026-09-12','2026-09-12');
 assert.equal(filter(postedAt,day),true);assert.equal(filter(postedAt),false);
 assert.equal(buildPostingAgeFilter(1,Date.parse('2026-09-12T20:00:00Z'))(postedAt,day),true);
 assert.equal(buildPostingAgeFilter(1,Date.parse('2026-09-13T16:00:00Z'))(postedAt,day),false);
 const job={url:'https://example.com/job',company:'甲',title:'AI',postedAt,dates:[day]};
 assert.equal(displayPostingDate(job),'2026-09-12');assert.match(formatPipelineOffer(job),/posted: 2026-09-12/);
 assert.equal(formatScanHistoryRow(job,'2026-09-12').split('\t')[8],'2026-09-12');
 const forged={...day,value:'2026-09-20'};assert.equal(filter(postedAt,forged),false);
});
test('invalid calendar dates inside timestamps never normalize into another posting day',()=>{
 for(const raw of ['发布于2026-02-30T00:00:00Z','发布于2026-09-12T25:00:00Z']){
  const fact=parsePostingDate({kind:'published',raw,observedAt:'2026-09-12T00:00:00Z',timezone:'Asia/Shanghai',evidence:{field:'visibleText',quote:raw}});
  assert.equal(fact.value,null);assert.equal(toPostedAt(fact),undefined);
 }
});

test('a capped relative label never fabricates an exact day',()=>{
 // Liepin renders a single visible update label for every posting older than
 // ~90 days. In the real pool those postings carry metadata upDate values from
 // 0 to 1735 days old while the label reads "90天前更新" for all of them, so the
 // number is a display cap, not a measurement. Converting it into a day would
 // claim that 113 postings were all refreshed inside the same six days.
 const capped=parse('90天前更新','updated');
 assert.equal(capped.value,null);
 assert.equal(capped.precision,'unknown');
 assert.equal(capped.raw,'90天前更新');
 assert.equal(toPostedAt(capped),undefined);
 // Below the cap the label is a real measurement and keeps working.
 assert.equal(parse('3天前更新','updated').value,'2026-09-09');
 assert.equal(parse('89天前更新','updated').value,'2026-06-15');
});
