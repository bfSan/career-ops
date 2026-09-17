import test from 'node:test';import assert from 'node:assert/strict';
import {selectBrowserDriver} from '../../china/driver-choice.mjs';
test('both domestic platforms default to the ordinary native Chrome route on macOS',()=>{
 for(const platform of ['boss','liepin'])assert.equal(selectBrowserDriver({platform,system:'darwin'}),'native');
 assert.equal(selectBrowserDriver({platform:'liepin',system:'linux'}),'playwright');
 assert.equal(selectBrowserDriver({platform:'liepin',system:'darwin',headless:true}),'playwright');
 assert.equal(selectBrowserDriver({platform:'liepin',system:'darwin',requested:'playwright'}),'playwright');
 assert.throws(()=>selectBrowserDriver({platform:'liepin',system:'darwin',requested:'native',headless:true}),/visible/);
});
