// One default for collection, login and explicit liveness checks.
// macOS keeps the original Apple Events/ScriptingBridge route that was used for
// the successful live collection. Linux uses the separate CDP implementation;
// Windows keeps the Playwright path because it is unmeasured.
export function selectBrowserDriver({platform,channel='chrome',headless=false,system=process.platform,requested}={}) {
  const native=['boss','liepin','linkedin'].includes(platform)&&['darwin','linux'].includes(system)&&channel==='chrome'&&!headless;
  const selected=requested||(native?'native':'playwright');
  if(!['native','playwright'].includes(selected))throw new Error('browser-driver must be native or playwright');
  if(selected==='native'&&!native)throw new Error('Native scanning requires macOS or Linux, Chrome and a visible dedicated window');
  return selected;
}
