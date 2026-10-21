export function bossEnvelope() {
  const at = n => new Date(Date.UTC(2026,9,20,0,0,n)).toISOString();
  const href = 'https://www.zhipin.com/web/geek/jobs?query=AI%20Agent&city=101190100';
  const job = {url:'https://www.zhipin.com/job_detail/offline-1.html', title:'AI Agent工程师', location:'南京·雨花台区'};
  const record = {...job, platform:'boss', company:'离线测试', complete:true, captureMethod:'browser_extension', observedAt:at(90),
    description:'负责生产级 AI Agent 平台开发、部署、工具调用、测试评估、可观测性建设与故障恢复，完成完整服务上线并持续优化系统可靠性。',
    searchContext:{batchId:'boss-offline',city:'南京',keyword:'AI Agent',listingHref:href,captureMode:'clicked_panel',
      panelEvidence:{jobUrl:job.url,title:job.title,location:job.location,at:at(90)}}};
  return {schemaVersion:2, kind:'boss_visible_batch', batch:{id:'boss-offline',ownerTabId:7,extensionVersion:'2.0.0',city:'南京',keyword:'AI Agent',
    status:'done',stopReason:null,startedAt:at(0),endedAt:at(90),exportedAt:at(91),recordCount:1,maxJobs:2,minIntervalMs:15000,
    selectedJobs:[job],listingEvidence:{href,inputValue:'AI Agent',selectedCity:'南京',cityParam:'101190100',at:at(61)},
    actions:[{kind:'open-home',href:'https://www.zhipin.com/web/geek/jobs',at:at(0)},
      {kind:'keyword-input',href:'https://www.zhipin.com/web/geek/jobs',at:at(15)},
      {kind:'search',href:'https://www.zhipin.com/web/geek/jobs',at:at(30)},
      {kind:'city-open',href,at:at(45)},{kind:'city-select',href,at:at(60)},
      {kind:'job-click',href,jobUrl:job.url,at:at(75)}]},records:[record]};
}
