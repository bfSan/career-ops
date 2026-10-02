// One default for collection, login and explicit liveness checks.
// The owned-window route drove Chrome through Apple Events on macOS. It now
// drives the same owned window through a minimal CDP bridge, so the route also
// works on Linux. Windows keeps the Playwright path because it is unmeasured.
export function selectBrowserDriver({platform,channel='chrome',headless=false,system=process.platform,requested}={}) {
  const native=['boss','liepin','linkedin'].includes(platform)&&['darwin','linux'].includes(system)&&channel==='chrome'&&!headless;
  const selected=requested||(native?'native':'playwright');
  if(!['native','playwright'].includes(selected))throw new Error('browser-driver must be native or playwright');
  if(selected==='native'&&!native)throw new Error('Native scanning requires macOS or Linux, Chrome and a visible dedicated window');
  return selected;
}
