// One default for collection, login and explicit liveness checks.
export function selectBrowserDriver({platform,channel='chrome',headless=false,system=process.platform,requested}={}) {
  const native=['boss','liepin','linkedin'].includes(platform)&&system==='darwin'&&channel==='chrome'&&!headless;
  const selected=requested||(native?'native':'playwright');
  if(!['native','playwright'].includes(selected))throw new Error('browser-driver must be native or playwright');
  if(selected==='native'&&!native)throw new Error('Native scanning requires macOS, Chrome and a visible dedicated window');
  return selected;
}
