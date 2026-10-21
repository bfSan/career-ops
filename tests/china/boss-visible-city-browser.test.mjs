// Synthetic DOM only. No BOSS requests and no connection to the user's Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createBossVisibleDom} from '../../china/boss-visible-runtime.mjs';
import {createBossBatchPolicy} from '../../china/boss-batch-policy.mjs';

for (const [city,group] of [['南京','KLMN'],['福州','FGHJ']]) {
  test(`serialized BOSS DOM selects ${city} only inside the city dialog`,async()=>{
    const browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
    try {
      const context=await browser.newContext();
      await context.route('**/*',route=>route.abort());
      const page=await context.newPage();
      await page.setContent(`<div class="city-label">南京</div><div class="job-detail-container"><span>${city}</span><span>${city}</span></div>
        <section id="cities"><h3>请选择城市</h3><nav><span>热门城市</span><span>ABCDE</span><span id="F">F G H J</span><span id="N">KLMN</span><span>PQRST</span><span>WXYZ</span></nav><div id="options"><a>上海</a><a>杭州</a></div></section>`);
      await page.evaluate(({domSource,policySource,city,group})=>{
        const factory=(0,eval)('('+domSource+')'),policy=(0,eval)('('+policySource+')')();
        window.clicked=[];
        document.querySelector(group==='FGHJ'?'#F':'#N').onclick=()=>{
          window.clicked.push(group);const a=document.createElement('a');a.innerText=city;a.onclick=()=>window.clicked.push(city);document.querySelector('#options').append(a);
        };
        window.batch={id:'offline',city,keyword:'AI Agent',records:[],jobs:[],stage:'city-menu-await'};
        window.dom=factory({window,document,location:{href:'https://www.zhipin.com/web/geek/jobs?query=AI%20Agent&city=101190100'},extractPage:()=>({status:'ok',jobs:[]}),policy});
      },{domSource:createBossVisibleDom.toString(),policySource:createBossBatchPolicy.toString(),city,group});
      const before=await page.evaluate(()=>window.dom.snapshot(window.batch));
      assert.equal(before.exactCityOption,false,'background job locations are not menu options');
      assert.equal(before.cityLetterTab,true,'background duplicate city labels must not suppress the letter tab');
      await page.evaluate(()=>window.dom.prepare('city-letter',window.batch).perform());
      assert.equal((await page.evaluate(()=>window.dom.snapshot(window.batch))).exactCityOption,true);
      await page.evaluate(()=>window.dom.prepare('city-select',window.batch).perform());
      assert.deepEqual(await page.evaluate(()=>window.clicked),[group,city]);
      // Separate identical options are ambiguous; do not silently take the first.
      await page.evaluate(city=>{const a=document.createElement('a');a.innerText=city;document.querySelector('#options').append(a);},city);
      assert.equal((await page.evaluate(()=>window.dom.snapshot(window.batch))).exactCityOption,false);
      await assert.rejects(page.evaluate(()=>window.dom.prepare('city-select',window.batch).perform()));
      await context.close();
    } finally {await browser.close();}
  });
}
