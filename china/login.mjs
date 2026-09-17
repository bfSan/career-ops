import {platformUrl,validateLoginUrl,extractPage} from './platforms.mjs';
import {guardNavigation} from './navigation-guard.mjs';
export {openNativeLogin,waitForNativeLogin} from './native-login.mjs';

// Read only visible state. Authentication is observed from the site's own
// account request; this module never calls an account API or reads cookies.
function inspectLoginDocument() {
  const text=(document.body?.innerText || '').trim();
  return {
    url:location.href,
    textLength:text.length,
    loading:/^(?:加载中[，,]?请稍[后候]|正在加载|请稍[后候])[。.！!…\s]*$/.test(text),
    loginRequired:/验证码登录|扫码登录|短信登录|登录(?:后)?(?:查看|解锁)/.test(text),
  };
}

export async function prepareLoginPage({page,platform,url,timeoutMs=15000,settleMs=2500,onEvent=()=>{}}) {
  validateLoginUrl(platform,url);
  const guard=await guardNavigation(page,{platform,allowChallenge:true});
  let authentication='unknown';
  const accountResponse=async response=>{
    let source;
    try {source=platformUrl(platform,response.url());}catch{return;}
    if(platform!=='boss' || source.pathname!=='/wapi/zpuser/wap/getUserInfo.json') return;
    try {
      const data=await response.json();
      if(data.code===0 || data.code===7) {
        authentication=data.code===0?'authenticated':'login_required';
        onEvent({event:'authentication',status:authentication});
      }
    }catch { /* In-flight responses may disappear during normal navigation. */ }
  };
  page.on('response',accountResponse);
  let closeListener;
  const closed=new Promise(resolve=>{
    closeListener=()=>resolve(guard.result() || {status:'cancelled'});
    page.once('close',closeListener);
  });
  const dispose=()=>{page.off('response',accountResponse);page.off('close',closeListener);};
  const inspect=async()=>{
    if(guard.result()) return guard.result();
    if(page.isClosed()) return {status:'cancelled'};
    try {
      const state=await page.evaluate(inspectLoginDocument);
      if(guard.result()) return guard.result();
      if(state.url==='about:blank') return {status:'blank_page'};
      try {validateLoginUrl(platform,state.url);}catch{return {status:'unexpected_navigation'};}
      if(!state.textLength) return {status:'blank_page'};
      if(state.loading) return {status:'page_not_ready'};
      const notice=await page.evaluate(extractPage,{platform,kind:'state'});
      return {status:'ready',challenge:notice.status==='challenge',loginRequired:state.loginRequired};
    }catch {return guard.result() || {status:page.isClosed()?'cancelled':'page_not_ready'};}
  };
  const complete=async()=>{
    const state=await inspect();
    if(state.status!=='ready') return state;
    if(state.challenge) return {status:'challenge'};
    if(state.loginRequired || authentication==='login_required') return {status:'login_required'};
    return {status:authentication==='authenticated'?'authenticated':'session_unverified'};
  };
  const result=status=>({status,closed,complete,dispose});
  let response;
  try {response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:timeoutMs});}
  catch {return result(guard.result()?.status || 'network_error');}
  if(response?.status()>=400) return result('network_error');
  const until=Date.now()+timeoutMs;
  let stableSince=null,last={status:'page_not_ready'};
  do {
    last=await inspect();
    if(guard.result() || ['cancelled','unexpected_navigation'].includes(last.status)) return result(last.status);
    if(last.status==='ready') {
      stableSince ??= Date.now();
      if(Date.now()-stableSince>=settleMs) return result('ready');
    }else stableSince=null;
    await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()<until);
  return result(last.status==='ready'?'page_not_ready':last.status);
}

export function loginOutcome(platform,status) {
  const saved=status==='authenticated';
  const unverified=status==='session_unverified';
  return {
    exitCode:saved || unverified ? 0 : 2,
    result:{platform,status:saved?'session_saved':unverified?'session_unverified':'blocked',reason:status,
      note:saved?'已确认当前会话登录；可用 scan 验证岗位读取。':unverified?'浏览器配置已保存；本站登录状态未核实，请用 scan 检验。':'没有确认登录成功；浏览器已关闭，未自动重试。'},
  };
}
