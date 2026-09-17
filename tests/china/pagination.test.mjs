import test from 'node:test';import assert from 'node:assert/strict';import * as pagination from '../../china/pagination.mjs';
const first='https://www.liepin.com/zhaopin/?city=020&dq=020&key=agent';
// URL shape observed on the real Next Page control; tracking values are synthetic.
const second='https://www.liepin.com/zhaopin/?city=020&dq=020&pubTime=&currentPage=1&pageSize=40&key=agent&suggestTag=&workYearCode=&compId=&compName=&compTag=&industry=&salaryCode=&jobKind=&compScale=&compKind=&compStage=&eduLevel=&ckId=fixture&skId=fixture&fkId=fixture&scene=page&sfrom=search_job_pc&suggestId=';
test('Liepin currentPage and observed tracking/empty defaults preserve the actual search identity',()=>{
 assert.equal(pagination.searchIdentity('liepin',first),pagination.searchIdentity('liepin',second));
 assert.equal(pagination.validateNextUrl('liepin',first,first,second),second);
 assert.notEqual(pagination.searchPageIdentity('liepin',first),pagination.searchPageIdentity('liepin',second));
 assert.equal(pagination.searchPageIdentity('liepin',first),pagination.searchPageIdentity('liepin',second.replace('currentPage=1','currentPage=0')));
});
test('normalization keeps nonempty filters, page size and unknown parameters significant',()=>{
 for(const [name,value] of [['dq','070020'],['city','070020'],['key','sales'],['pubTime','7'],['workYearCode','010'],['salaryCode','030'],['compId','123'],['eduLevel','040'],['pageSize','80'],['unknownFilter','']]){
  const u=new URL(second);u.searchParams.set(name,value);assert.throws(()=>pagination.validateNextUrl('liepin',first,first,u.href),/pagination_identity_mismatch/);
 }
 for(const value of ['0','-1','abc'])assert.throws(()=>pagination.validateNextUrl('liepin',first,first,second.replace('currentPage=1','currentPage='+value)),/pagination_identity_mismatch/);
});
