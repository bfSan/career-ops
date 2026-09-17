import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSkills,canonicalize} from '../skill-extract.mjs';

test('Agent ReAct does not manufacture a frontend React requirement',()=>{
 assert.equal(extractSkills('理解 Agent 推理范式，例如 ReAct / Chain-of-Thought / Reflection').has('React'),false);
 assert.equal(canonicalize('ReAct'),'ReAct');
});
test('real React forms still work in an ad that also mentions ReAct',()=>{
 for(const word of ['React','react','REACT'])assert.equal(extractSkills(`Frontend with ${word}; Agent uses ReAct.`).has('React'),true);
 const skills=extractSkills('React Native mobile app; ReAct for agents.');
 assert.equal(skills.has('React Native'),true);
 assert.equal(skills.has('React'),false);
});
