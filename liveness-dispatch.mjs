import {jobIdentity} from './china/platforms.mjs';
export function domesticPlatform(url) {
  try {const host=new URL(url).hostname;
    return ['www.zhipin.com','zhipin.com'].includes(host)?'boss':['www.liepin.com','liepin.com'].includes(host)?'liepin':null;
  }catch{return null;}
}
export async function enabledDomesticProviders({codeRoot,dataRoot}) {
  const {loadPlugins}=await import('./plugins/_engine.mjs');
  const enabled=new Set();
  for(const platform of ['boss','liepin']){
    const loaded=await loadPlugins('provider',{root:codeRoot,dataRoot,dryRun:true,pluginId:`career-${platform}`});
    if(loaded.length)enabled.add(platform);
  }
  return enabled;
}
export async function checkPosting(url,{dataRoot,domesticEnabled=false,fallback,driverFactory,domesticChecker}={}) {
  const checkedAt=new Date().toISOString(),platform=domesticPlatform(url);
  if(!platform)return {...await fallback(url),checkedAt};
  try {jobIdentity(platform,url);}catch{return {result:'uncertain',reason:'invalid_domestic_url',code:'invalid_url',checkedAt};}
  const enabled=domesticEnabled===true||domesticEnabled instanceof Set&&domesticEnabled.has(platform);
  if(!enabled)return {result:'uncertain',reason:'source_disabled',checkedAt};
  try {
    const {checkDomesticPosting}=await import('./china/liveness.mjs');
    return await checkDomesticPosting(url,{dataRoot,driverFactory,domesticChecker});
  }catch{return {result:'uncertain',reason:'adapter_error',checkedAt};}
}

// Both consumers borrow these checkers; only this batch owns their cleanup.
export function createDomesticCheckerPool({dataRoot,domesticEnabled,driverFactory,sleepImpl}={}) {
  const checkers=new Map();
  return {
    async forUrl(url){
      const platform=domesticPlatform(url);
      if(!platform||!(domesticEnabled===true||domesticEnabled instanceof Set&&domesticEnabled.has(platform)))return undefined;
      if(!checkers.has(platform)){
        const {createDomesticChecker}=await import('./china/liveness.mjs');
        checkers.set(platform,createDomesticChecker({dataRoot,platform,driverFactory,sleepImpl}));
      }
      return checkers.get(platform);
    },
    async close(){await Promise.allSettled([...checkers.values()].map(checker=>checker.close()));},
  };
}
