// Liepin detail pages must be reached through their observed listing anchor,
// retaining the href's session query and the browser's normal navigation.
// Both /job/<id>.shtml and /a/<id>.shtml are legitimate, distinct identities.
// These functions are serialized into the page, so keep them self-contained.

/** Locate only; clicking is a separate evaluation because navigation destroys
 * the old execution context before a result can be marshalled back. */
export function findCard({platform, url} = {}) {
  if(platform!=='liepin')return {status:'not_found'};
  const keyOf=value=>{
    if(typeof value!=='string'||!value)return null;
    try{
      const u=new URL(value,'https://www.liepin.com/');
      if(u.protocol!=='https:'||!['liepin.com','www.liepin.com'].includes(u.hostname)||u.port||u.username||u.password)return null;
      return /^\/(?:job|a)\/\d+\.shtml$/.test(u.pathname)?u.pathname:null;
    }catch{return null;}
  };
  const key=keyOf(url);
  if(!key)return {status:'not_found'};
  const visible=el=>!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);
  const anchors=[...document.querySelectorAll('a[href*="/job/"],a[href*="/a/"]')];
  const matches=anchors.filter(a=>keyOf(a.getAttribute('href'))===key&&visible(a));
  if(!matches.length)return anchors.some(a=>keyOf(a.getAttribute('href'))===key)?{status:'closed'}:{status:'not_found'};
  if(matches.length>1)return {status:'ambiguous',candidates:matches.length};
  return {status:'found',index:anchors.indexOf(matches[0]),url:`https://www.liepin.com${key}`};
}

/** Revalidate the indexed anchor immediately before clicking. Never click a
 * replacement card after a DOM reorder, a hidden card, or a foreign destination.
 * Run fire-and-forget: the caller observes arrival rather than replaying clicks. */
export function clickCard({index,url} = {}) {
  if(!Number.isInteger(index)||index<0||typeof url!=='string')return;
  const keyOf=value=>{
    if(typeof value!=='string'||!value)return null;
    try{
      const u=new URL(value,'https://www.liepin.com/');
      if(u.protocol!=='https:'||!['liepin.com','www.liepin.com'].includes(u.hostname)||u.port||u.username||u.password)return null;
      return /^\/(?:job|a)\/\d+\.shtml$/.test(u.pathname)?u.pathname:null;
    }catch{return null;}
  };
  const key=keyOf(url);
  if(!key)return;
  const anchors=[...document.querySelectorAll('a[href*="/job/"],a[href*="/a/"]')];
  const anchor=anchors[index],visible=el=>!!el&&!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);
  if(!visible(anchor)||keyOf(anchor.getAttribute('href'))!==key)return;
  if(anchors.filter(a=>visible(a)&&keyOf(a.getAttribute('href'))===key).length!==1)return;
  // The driver owns exactly one tab; prevent target=_blank from opening another.
  if(anchor.getAttribute('target'))anchor.removeAttribute('target');
  anchor.click();
}
