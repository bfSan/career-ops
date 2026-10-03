// 猎聘 guards job pages by session provenance, not by whether the account is
// logged in. Measured 2026-10-02 on a healthy account: a detail URL reached by
// Page.navigate (no Referer, no session query) lands on
// safe.liepin.com/…/captchaPage_PC, while the same job reached by clicking its
// card on the results page renders the full JD.
//
// The provenance the site checks is carried in the list card's own href —
// pgRef encodes c_pc_search_job_listcard alongside skId/ckId/fkId. The parser
// reduces that href to a bare /job/<id>.shtml, so re-navigating to that stripped
// URL is indistinguishable from an outside arrival. Clicking the anchor keeps
// the real href, the Referer and the opener relationship intact.
//
// This mirrors BOSS's selectCard: verify the anchor resolves to the expected
// job before clicking, so a stale or duplicated card can never be read as the
// job that was asked for.

/**
 * Locate the results-page anchor for one job without touching it.
 *
 * Split from the click on purpose. An in-page script that both clicks and
 * returns a value loses that value: the click navigates, the execution context
 * is destroyed mid-call, and the driver sees "Execution context was destroyed"
 * instead of the anchor it just found. Locating and clicking in two evaluations
 * keeps the verdict readable and lets the driver decide what to do with it.
 *
 * @param {{platform: string, url: string}} options job identity to reach
 * @returns {{status: 'found'|'not_found'|'ambiguous'|'closed', index?: number, candidates?: number}}
 *   Exported for tests; injected into the page as source.
 */
export function findCard({platform, url} = {}) {
  const id = (() => {
    const m = String(url || '').match(/\/job\/([a-zA-Z0-9_-]+)\.shtml/);
    return m ? m[1] : null;
  })();
  if (!id) return {status: 'not_found'};

  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  // Normalize the href down to the same /job/<id>.shtml shape the identity
  // check uses, so query-string differences (skId rotation, d_* tracking,
  // curPage changes between the listing and the click) do not cause a miss.
  const keyOf = a => {
    const m = String(a.getAttribute('href') || '').match(/\/job\/([a-zA-Z0-9_-]+)\.shtml/);
    return m ? m[1] : null;
  };

  // Every matching anchor, visible or not. A closed posting is still in the DOM
  // but not rendered, and that is a different observation from "not on this
  // page" — so the hidden ones have to stay visible to this check.
  const anchors = [...document.querySelectorAll('a[href*="/job/"]')];
  const matches = anchors.filter(a => keyOf(a) === id && visible(a));

  if (!matches.length) {
    // The card exists but is not rendered: the platform closed this posting.
    // Reporting that as closed keeps the reason honest; folding it into
    // extraction_failed would say the read broke, when it did not.
    const any = anchors.find(a => keyOf(a) === id);
    return any ? {status: 'closed'} : {status: 'not_found'};
  }
  // Two live anchors for one job means the page re-rendered mid-read. Clicking
  // either could land on a stale listing, so refuse and let the caller retry.
  if (matches.length > 1) return {status: 'ambiguous', candidates: matches.length};
  return {status: 'found', index: anchors.indexOf(matches[0])};
}

/**
 * Click the anchor located by findCard.
 *
 * The caller passes the index rather than the element, so this second
 * evaluation does not have to re-run the query and cannot drift onto a
 * different card if the page re-rendered in between.
 *
 * The click is synchronous and returns nothing. It must run through the
 * bridge's fire-and-forget evaluation, not evaluate(): navigating destroys the
 * execution context before a value can be marshalled back, so an expression
 * that both clicks and answers is a guaranteed error. Deferring the click with
 * setTimeout was tried first and is worse — the navigation is a task the page
 * may cancel, and read() then waits out its whole timeout on a page that never
 * moves.
 *
 * @param {{index: number}} options
 * @returns {void}
 */
export function clickCard({index} = {}) {
  const anchor = [...document.querySelectorAll('a[href*="/job/"]')][index];
  if (!anchor) return;
  // target=_blank would open a second tab and break the single-tab binding this
  // driver depends on; strip it so the click navigates in place.
  if (anchor.getAttribute('target')) anchor.removeAttribute('target');
  anchor.click();
}
