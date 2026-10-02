import test from 'node:test';import assert from 'node:assert/strict';
import {selectBrowserDriver} from '../../china/driver-choice.mjs';
test('both domestic platforms default to the owned Chrome route on macOS and Linux',()=>{
 for(const platform of ['boss','liepin'])assert.equal(selectBrowserDriver({platform,system:'darwin'}),'native');
 // The owned-window route no longer depends on Apple Events, so Linux takes it too.
 for(const platform of ['boss','liepin','linkedin'])assert.equal(selectBrowserDriver({platform,system:'linux'}),'native');
 assert.equal(selectBrowserDriver({platform:'liepin',system:'darwin',headless:true}),'playwright');
 assert.equal(selectBrowserDriver({platform:'liepin',system:'darwin',requested:'playwright'}),'playwright');
 assert.equal(selectBrowserDriver({platform:'liepin',system:'win32'}),'playwright');
 assert.throws(()=>selectBrowserDriver({platform:'liepin',system:'darwin',requested:'native',headless:true}),/visible/);
 assert.throws(()=>selectBrowserDriver({platform:'liepin',system:'win32',requested:'native'}),/macOS or Linux/);
});
