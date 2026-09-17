import { platformUrl } from './platforms.mjs';

// Let BOSS complete one ordinary code-37 check, but never retry a failed check.
// Other challenges still stop immediately. No verification is skipped or solved here.
export async function guardNavigation(page, { platform, allowChallenge = false, onBlock, automaticVerificationTimeoutMs = 8000 } = {}) {
  let blocked = null;
  let closing = null;
  let notified = false;
  let verificationSeen = false;
  let verificationPending = false;
  let verificationCommitted = false;
  let verificationTimer;
  const recent = [];
  let platformVisited = false;
  const isChallenge = value => {
    try {
      const url=new URL(value);
      if(platform==='liepin'&&url.hostname==='safe.liepin.com')return true;
      if(platform==='linkedin'&&/(^|\.)linkedin\.com$/.test(url.hostname)&&/\/(?:checkpoint|challenge)(?:\/|$)/i.test(url.pathname))return true;
      return /\/security(?:\.html|\/)|\/captcha(?:\/|$)/i.test(platformUrl(platform, value).pathname);
    }
    catch { return false; }
  };
  const stop = status => {
    blocked ||= { status };
    clearTimeout(verificationTimer);
    verificationPending = false;
    closing ||= page.close({ runBeforeUnload: false }).catch(() => {});
    if (!notified) { notified = true; onBlock?.(blocked); }
    return closing;
  };
  const beginVerification = (value, commit = false) => {
    if (platform !== 'boss') return false;
    const url = platformUrl(platform, value);
    if (url.pathname !== '/web/passport/zp/security.html' || url.searchParams.get('code') !== '37') return false;
    // The route and commit refer to the same first document. Another request is a retry.
    if (verificationPending) {
      if (!commit || verificationCommitted) return false;
      verificationCommitted = true;
      return true;
    }
    if (verificationSeen) return false;
    verificationSeen = true;
    verificationPending = true;
    verificationCommitted = commit;
    verificationTimer = setTimeout(() => { void stop('challenge'); }, automaticVerificationTimeoutMs);
    return true;
  };
  page.on('close', () => clearTimeout(verificationTimer));
  await page.route('**/*', async route => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()
        && !allowChallenge && isChallenge(request.url()) && !beginVerification(request.url())) {
      blocked ||= { status: 'challenge' };
      await route.abort().catch(() => {});
      await stop('challenge');
      return;
    }
    await route.fallback(); // Preserve existing test/host routes; never bypass them.
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    if (platformVisited && frame.url() === 'about:blank') { void stop('blank_page'); return; }
    try { platformUrl(platform, frame.url()); platformVisited = true; } catch { /* Initial blank page or external route. */ }
    // Also covers HTTP redirects and SPA URL changes not seen by route handlers.
    if (!allowChallenge && isChallenge(frame.url())) {
      if (!beginVerification(frame.url(), true)) { void stop('challenge'); return; }
    } else if (verificationPending) {
      verificationPending = false;
      clearTimeout(verificationTimer);
    }
    const now = Date.now();
    recent.push(now);
    while (recent[0] < now - 5000) recent.shift();
    if (recent.length >= 6) void stop('navigation_loop');
  });
  return { result: () => blocked, pending: () => verificationPending, stop };
}
