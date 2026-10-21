// Serialized into the MV3 worker. One persistent batch owns one newly-created BOSS tab.
export function createBossVisibleWorker({chrome, policy, now=()=>Date.now(), random=()=>Math.random()}) {
  const HOME='https://www.zhipin.com/web/geek/jobs';
  const KEY='careerOpsBossVisibleBatchV2';
  const LAST='careerOpsBossVisibleLastActionAtV2';
  const VERSION='2.0.1';
  let serial=Promise.resolve();
  const enqueue=fn=>{const result=serial.then(fn);serial=result.catch(()=>{});return result;};
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const iso=()=>new Date(now()).toISOString();
  const get=keys=>chrome.storage.local.get(keys);
  const set=value=>chrome.storage.local.set(value);
  const load=async()=>(await get([KEY]))[KEY]||null;
  const persist=async value=>{await set({[KEY]:value});return value;};
  const advance=(value,patch)=>({...value,...patch,revision:(value.revision||0)+1,updatedAt:iso()});
  function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.zhipin.com','zhipin.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port?u:null;}catch{return null;}}
  const listing=value=>{const u=safeUrl(value);return u&&/^\/web\/geek\/jobs\/?$/.test(u.pathname)?u:null;};
  const job=value=>{const u=safeUrl(value);return u&&/^\/job_detail\/[\w-]+\.html$/.test(u.pathname)?`https://www.zhipin.com${u.pathname}`:null;};
  const gated=value=>{const u=safeUrl(value);return !u||/captcha|security|passport|login/i.test(u.pathname)||u.hostname==='safe.zhipin.com';};
  const documentId=sender=>sender?.documentId||`tab:${sender?.tab?.id}:frame:${sender?.frameId??0}`;
  const isControl=sender=>sender?.url===chrome.runtime.getURL('control.html')&&(sender.frameId==null||sender.frameId===0);
  const isOwner=(batch,sender)=>batch?.status==='running'&&sender?.tab?.id===batch.ownerTabId&&(sender.frameId==null||sender.frameId===0);
  async function stop(value,reason){if(value?.status!=='running')return value;const stopped=advance(value,{status:'stopped',stage:'stopped',stopReason:String(reason||'停止'),endedAt:iso(),pendingAction:null});return persist(stopped);}
  async function assertLive(value,sender,message){if(!isOwner(value,sender))throw new Error('非BOSS owner主文档');if(message.batchId!==value.id||message.revision!==value.revision||message.stage!==value.stage)throw new Error('BOSS旧批次或阶段锁冲突');if(value.documentId!==documentId(sender))throw new Error('BOSS旧页面文档');const tab=await chrome.tabs.get(value.ownerTabId);if(!tab||tab.url!==message.href||gated(message.href))throw new Error('BOSS owner URL变化或进入门槛');return tab;}
  const remaining=async()=>{const value=(await get([LAST]))[LAST];return value===undefined?0:Math.max(0,Number(value)+policy.intervalMs-now());};
  async function handle(message={},sender={}) {
    let value=await load();
    if(message.type==='CONTROL_STATE')return isControl(sender)?{ok:true,batch:clone(value)}:{ok:false,message:'仅BOSS控制页可读'};
    if(message.type==='START'){
      if(!isControl(sender))return{ok:false,message:'仅BOSS控制页可开始'};
      policy.config(message);
      if(value?.status==='running')return{ok:false,message:'已有BOSS批次运行',batch:clone(value)};
      const wait=await remaining();if(wait)return{ok:false,waitMs:wait,batch:clone(value)};
      const at=iso(),id=`boss-${now().toString(36)}-${random().toString(36).slice(2,8)}`;
      value={id,ownerTabId:null,city:message.city,keyword:message.keyword,extensionVersion:VERSION,status:'running',stage:'opening',revision:1,documentId:null,stageSince:at,startedAt:at,endedAt:null,stopReason:null,evidence:null,jobs:[],records:[],actions:[{kind:'open-home',href:HOME,at}],pendingAction:null};
      await set({[KEY]:value,[LAST]:now()});
      try{const tab=await chrome.tabs.create({url:HOME,active:true});value=advance(value,{ownerTabId:tab.id});await persist(value);}catch(error){value=await stop(value,`打开BOSS owner标签失败：${error.message}`);}
      return{ok:value.status==='running',batch:clone(value)};
    }
    if(message.type==='CONTROL_STOP')return isControl(sender)?{ok:true,batch:clone(await stop(value,message.reason||'控制页停止'))}:{ok:false,message:'仅控制页可停止'};
    if(message.type==='EXPORT'||message.type==='AUTO_EXPORT'){
      if(!isControl(sender)||value?.status!=='done'||value.stopReason)return{ok:false,message:'BOSS批次未成功完成'};
      if(message.type==='AUTO_EXPORT'&&value.exportedBatchId===value.id)return{ok:false,already:true,batch:clone(value)};
      const receipt=policy.receipt(value,iso());policy.validateReceipt(receipt);
      value=advance(value,{exportPreparedBatchId:value.id,...(message.type==='AUTO_EXPORT'?{exportedBatchId:value.id}:{})});await persist(value);
      return{ok:true,receipt:clone(receipt),batch:clone(value)};
    }
    if(message.type==='EXPORT_DISPATCHED'){
      if(!isControl(sender)||!value||value.status!=='done'||value.exportPreparedBatchId!==value.id||message.batchId!==value.id)return{ok:false,message:'BOSS导出确认无效'};
      if(['closed','already_closed'].includes(value.ownerCleanup?.status))return{ok:true,batch:clone(value)};
      const cleanup={tabId:value.ownerTabId,at:iso(),status:'failed'};let tab;try{tab=await chrome.tabs.get(value.ownerTabId);}catch{}
      if(!tab)cleanup.status='already_closed';
      else if(tab.url!==value.evidence?.href&&job(tab.url)!==job(value.records.at(-1)?.url)){cleanup.status='skipped';cleanup.reason='BOSS owner标签已改作其他页面';}
      else try{await chrome.tabs.remove(value.ownerTabId);cleanup.status='closed';}catch(error){cleanup.reason=error.message;}
      value=advance(value,{exportDispatchedBatchId:value.id,ownerCleanup:cleanup});await persist(value);return{ok:true,batch:clone(value)};
    }
    if(message.type==='HELLO'){
      if(!isOwner(value,sender))return{ok:false,owner:false,message:'非BOSS owner标签'};
      const tab=await chrome.tabs.get(value.ownerTabId);if(!tab||tab.url!==message.href)return{ok:false,owner:false,message:'BOSS owner URL不一致'};
      if(gated(tab.url))return{ok:false,owner:true,batch:clone(await stop(value,'BOSS进入验证、登录或不受信任页面'))};
      const doc=documentId(sender);const navigationStages=['opening','search-await','city-menu-await','city-await','panel-await'];
      if(value.documentId&&value.documentId!==doc&&!navigationStages.includes(value.stage))return{ok:false,owner:true,batch:clone(await stop(value,'BOSS非预期文档变化'))};
      if(value.documentId!==doc){value=advance(value,{documentId:doc});await persist(value);}return{ok:true,owner:true,batch:clone(value)};
    }
    if(!isOwner(value,sender))return{ok:false,owner:false,message:'非BOSS owner标签'};
    try{await assertLive(value,sender,message);}catch(error){return{ok:false,stale:true,message:error.message};}
    if(message.type==='HALT')return{ok:true,batch:clone(await stop(value,message.reason))};
    if(message.type==='CHECK_ACTION'){
      if(!value.pendingAction||value.pendingAction.token!==message.token||value.pendingAction.documentId!==documentId(sender)||value.pendingAction.dispatched)return{ok:false,message:'BOSS动作许可无效'};
      value=advance(value,{pendingAction:{...value.pendingAction,dispatched:true}});await persist(value);return{ok:true,batch:clone(value)};
    }
    if(message.type==='OBSERVE'){
      const snapshot=message.snapshot||{};
      if(snapshot.blank||snapshot.gate!=='ok')return{ok:false,halted:true,message:'BOSS页面门槛或空白',batch:clone(await stop(value,snapshot.gate||'blank'))};
      let patch;
      if(value.stage==='opening'){
        const u=listing(snapshot.href);if(!u||u.searchParams.get('query'))throw new Error('BOSS开始页不是无关键词搜索页');patch=snapshot.searchInput&&snapshot.searchButton?{stage:'keyword-ready'}:{stage:'opening'};
      }else if(value.stage==='search-await'){
        if(!snapshot.query)return{ok:true,waiting:true,batch:clone(value)};
        if(snapshot.query!==value.keyword||snapshot.inputValue!==value.keyword)throw new Error('BOSS关键词证据不匹配');patch={stage:'city-ready'};
      }else if(value.stage==='city-menu-await'){
        patch=snapshot.exactCityOption?{stage:'city-select-ready'}:snapshot.cityLetterTab?{stage:'city-letter-ready'}:{stage:'city-menu-await'};
      }else if(value.stage==='city-letter-await'){
        patch=snapshot.exactCityOption?{stage:'city-select-ready'}:{stage:'city-letter-await'};
      }else if(value.stage==='city-await'){
        if(!snapshot.selectedCity)return{ok:true,waiting:true,batch:clone(value)};
        const evidence=policy.listingEvidence({...snapshot,at:iso()},value);patch={evidence,stage:'listing-ready'};
      }else if(value.stage==='listing-ready'){
        if(!Array.isArray(snapshot.jobs)||!snapshot.jobs.length)throw new Error('BOSS列表没有可见岗位');
        const jobs=snapshot.jobs.slice(0,2).map(item=>({...item,url:job(item.url)}));
        if(jobs.some(item=>!item.url||!item.title||!policy.belongs(item.location,value.city)))throw new Error('BOSS岗位身份或地点不符合批次');
        patch={jobs,stage:'panel-probe'};
      }else if(value.stage==='panel-probe'||value.stage==='panel-await'){
        const lastAction=value.actions.at(-1),lastRecord=value.records.at(-1);
        const waitAction=lastAction?Math.max(0,Date.parse(lastAction.at)+policy.intervalMs-now()):0;
        const waitRecord=lastRecord?Math.max(0,Date.parse(lastRecord.observedAt)+policy.intervalMs-now()):0;
        if(waitAction||waitRecord)return{ok:false,waiting:true,waitMs:Math.max(waitAction,waitRecord),batch:clone(value)};
        if(!snapshot.record){
          if(value.stage==='panel-await')return{ok:true,waiting:true,batch:clone(value)};
          value=advance(value,{stage:'job-ready',stageSince:iso()});await persist(value);return{ok:true,batch:clone(value)};
        }
        const panelEvidence=snapshot.record.searchContext?.panelEvidence;
        const listingFallback=panelEvidence?.location===''&&snapshot.record.locationSource==='listing_card';
        if(!panelEvidence||panelEvidence.at!==snapshot.record.observedAt||panelEvidence.jobUrl!==snapshot.record.url||panelEvidence.title!==snapshot.record.title||(!listingFallback&&panelEvidence.location!==snapshot.record.location))throw new Error('BOSS panelEvidence不完整或与记录不一致');
        policy.validateRecord(snapshot.record,{...value,selectedJobs:value.jobs});
        const captureMode=value.stage==='panel-probe'?'current_panel':'clicked_panel';
        const record={...snapshot.record,searchContext:{...snapshot.record.searchContext,batchId:value.id,city:value.city,keyword:value.keyword,listingHref:value.evidence.href,captureMode,panelEvidence}};
        const records=[...value.records,record];patch=records.length===value.jobs.length?{records,status:'done',stage:'done',endedAt:iso()}:{records,stage:'panel-probe'};
      }else return{ok:true,waiting:true,batch:clone(value)};
      value=advance(value,{...patch,pendingAction:null,stageSince:patch.stage!==value.stage?iso():value.stageSince});await persist(value);return{ok:true,batch:clone(value)};
    }
    if(message.type==='RESERVE'){
      const allowed={
        'keyword-input':{from:'keyword-ready',to:'keyword-filled'},search:{from:'keyword-filled',to:'search-await'},
        'city-open':{from:'city-ready',to:'city-menu-await'},'city-letter':{from:'city-letter-ready',to:'city-letter-await'},'city-select':{from:'city-select-ready',to:'city-await'},
        'job-click':{from:'job-ready',to:'panel-await'},
      };
      const rule=allowed[message.kind];if(!rule||value.stage!==rule.from)throw new Error('BOSS阶段禁止此动作');const snapshot=message.snapshot||{};
      if(message.kind==='keyword-input'&&(!listing(message.href)||!snapshot.searchInput))throw new Error('BOSS搜索输入控件缺失');
      if(message.kind==='search'&&(snapshot.inputValue!==value.keyword||!snapshot.searchButton))throw new Error('BOSS搜索证据缺失');
      if(message.kind==='city-open'&&(snapshot.query!==value.keyword||!snapshot.cityControl))throw new Error('BOSS城市入口缺失');
      if(message.kind==='city-letter'&&!snapshot.cityLetterTab)throw new Error('BOSS目标城市字母分组缺失');
      if(message.kind==='city-select'&&(!snapshot.exactCityOption))throw new Error('BOSS目标城市选项缺失或已选');
      if(message.kind==='job-click'&&(!value.evidence||message.href!==value.evidence.href||job(message.jobUrl)!==job(value.jobs[value.records.length]?.url)||job(snapshot.card?.url)!==job(message.jobUrl)))throw new Error('BOSS岗位点击身份不匹配');
      const wait=await remaining();if(wait)return{ok:false,waitMs:wait,batch:clone(value)};
      const at=iso(),token=`${value.id}:${value.revision+1}`;const action={kind:message.kind,href:message.href,at,...(message.jobUrl?{jobUrl:message.jobUrl}:{})};
      value=advance(value,{stage:rule.to,stageSince:at,actions:[...value.actions,action],pendingAction:{token,kind:message.kind,documentId:documentId(sender),dispatched:false}});await set({[KEY]:value,[LAST]:now()});return{ok:true,token,batch:clone(value)};
    }
    return{ok:false,message:'未知BOSS消息'};
  }
  const dispatch=(message,sender)=>enqueue(async()=>{
    try { return await handle(message,sender); }
    catch(error) {
      const current=await load();
      if(isOwner(current,sender))return {ok:false,halted:true,message:error.message,batch:clone(await stop(current,error.message))};
      throw error;
    }
  });
  function install(){
    chrome.runtime.onMessage.addListener((message,sender,reply)=>{dispatch(message,sender).then(reply,error=>reply({ok:false,message:error.message}));return true;});
    chrome.tabs.onRemoved.addListener(tabId=>{void enqueue(async()=>{const value=await load();if(value?.status==='running'&&value.ownerTabId===tabId)await stop(value,'BOSS owner标签关闭');});});
    chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(!change.url)return;void enqueue(async()=>{const value=await load();if(value?.status!=='running'||value.ownerTabId!==tabId)return;const href=change.url||tab?.url;if(gated(href)||!safeUrl(href))await stop(value,'BOSS owner导航到验证、登录或非站点页面');else if(!listing(href)&&!job(href))await stop(value,'BOSS owner非预期导航');});});
  }
  return{dispatch,install,idle:()=>serial,keys:{batch:KEY,lastAction:LAST}};
}
