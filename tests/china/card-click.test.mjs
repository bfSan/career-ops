import test from 'node:test';
import assert from 'node:assert/strict';
import {findCard, clickCard} from '../../china/card-click.mjs';

// 猎聘 serves a job page only when the arrival looks like it came from the
// results list. Measured 2026-10-02 on a healthy account: the same job reached
// by Page.navigate lands on safe.liepin.com, while clicking its card renders
// the JD. The provenance the site keys on lives in the card's own href —
// pgRef encodes c_pc_search_job_listcard, and the parser strips that down to a
// bare /job/<id>.shtml, which is why navigating there looked like an outside
// arrival.
//
// Locating and clicking are separate functions because a script that clicks and
// returns in one evaluation loses its return value: the click navigates and the
// context dies before the value is marshalled back. So findCard only reads.

// A minimal DOM good enough for both: they read offsetWidth/height and
// getClientRects, then getAttribute / removeAttribute / click.
function mkAnchor(jobId, {visible=true, target=null, href}={}) {
  const attrs = new Map();
  if (href !== undefined) attrs.set('href', href);
  if (target !== undefined) attrs.set('target', target);
  return {
    clicked: 0,
    getAttribute: name => (attrs.has(name) ? attrs.get(name) : null),
    removeAttribute(name) { attrs.delete(name); },
    get offsetWidth() { return visible ? 100 : 0; },
    get offsetHeight() { return visible ? 20 : 0; },
    getClientRects() { return visible ? [{}] : []; },
    click() { this.clicked++; },
  };
}

const withDom = anchors => {
  globalThis.document = {querySelectorAll: () => anchors};
  return () => { delete globalThis.document; };
};

const JOB = 'https://www.liepin.com/job/1983557243.shtml';

test('finds the single visible anchor for the job', () => {
  const target = mkAnchor('1983557243', {href: '/job/1983557243.shtml'});
  const other = mkAnchor('1983557244', {href: '/job/1983557244.shtml'});
  const restore = withDom([other, target]);
  try {
    const r = findCard({platform: 'liepin', url: JOB});
    assert.equal(r.status, 'found');
    assert.equal(target.clicked, 0, 'finding must not click anything');
  } finally { restore(); }
});

test('matches through the session query the parser strips', () => {
  // The listing href carries skId/ckId/pgRef; the parser reduces it to a bare
  // path. Matching has to survive that, or every real card reads as missing.
  const full = '/job/1983557243.shtml?pgRef=c_pc_search_page%3Ajob_listcard&skId=abc123&d_curPage=0';
  const anchor = mkAnchor('1983557243', {href: full});
  const restore = withDom([anchor]);
  try {
    const r = findCard({platform: 'liepin', url: JOB});
    assert.equal(r.status, 'found');
    assert.equal(r.index, 0);
  } finally { restore(); }
});

test('reports closed rather than missing when the card is present but hidden', () => {
  // The platform closed this posting. That is a real observation, and folding
  // it into extraction_failed would misreport why the job is absent.
  const anchor = mkAnchor('1983557243', {href: '/job/1983557243.shtml', visible: false});
  const restore = withDom([anchor]);
  try {
    assert.deepEqual(findCard({platform: 'liepin', url: JOB}), {status: 'closed'});
  } finally { restore(); }
});

test('refuses to guess between two live anchors for one job', () => {
  // A re-render mid-read can leave duplicates. Clicking either could open a
  // stale listing, so the driver must be told the page was not trustworthy.
  const a = mkAnchor('1983557243', {href: '/job/1983557243.shtml?skId=old'});
  const b = mkAnchor('1983557243', {href: '/job/1983557243.shtml?skId=new'});
  const restore = withDom([a, b]);
  try {
    const r = findCard({platform: 'liepin', url: JOB});
    assert.equal(r.status, 'ambiguous');
    assert.equal(r.candidates, 2);
  } finally { restore(); }
});

test('ignores hidden duplicates and finds the visible one', () => {
  const hidden = mkAnchor('1983557243', {href: '/job/1983557243.shtml', visible: false});
  const shown = mkAnchor('1983557243', {href: '/job/1983557243.shtml'});
  const restore = withDom([hidden, shown]);
  try {
    const r = findCard({platform: 'liepin', url: JOB});
    assert.equal(r.status, 'found');
    assert.equal(r.index, 1, 'index addresses the unfiltered list, so clickCard can re-query it');
  } finally { restore(); }
});

test('reports not_found for a job that is not on this page', () => {
  const restore = withDom([mkAnchor('1983557244', {href: '/job/1983557244.shtml'})]);
  try {
    assert.deepEqual(findCard({platform: 'liepin', url: JOB}), {status: 'not_found'});
  } finally { restore(); }
});

test('rejects a URL that is not a 猎聘 job link', () => {
  const anchor = mkAnchor('1983557243', {href: '/job/1983557243.shtml'});
  const restore = withDom([anchor]);
  try {
    for (const url of ['', 'https://www.liepin.com/company/abc', undefined, null]) {
      assert.deepEqual(findCard({platform: 'liepin', url}), {status: 'not_found'},
        `refused ${JSON.stringify(url)}`);
    }
  } finally { restore(); }
});

test('clickCard clicks the anchor findCard indexed', () => {
  const a = mkAnchor('1983557243', {href: '/job/1983557243.shtml'});
  const b = mkAnchor('1983557244', {href: '/job/1983557244.shtml'});
  const restore = withDom([a, b]);
  try {
    const found = findCard({platform: 'liepin', url: 'https://www.liepin.com/job/1983557244.shtml'});
    clickCard(found);
    assert.equal(b.clicked, 1);
    assert.equal(a.clicked, 0, 'must click only the indexed card');
  } finally { restore(); }
});

test('clickCard strips target=_blank so the click stays in the bound tab', () => {
  // A new tab would break the driver's single-tab binding; the click has to
  // navigate in place or the run dies with unexpected_browser_tab.
  const anchor = mkAnchor('1983557243', {href: '/job/1983557243.shtml', target: '_blank'});
  const restore = withDom([anchor]);
  try {
    clickCard({index: 0});
    assert.equal(anchor.getAttribute('target'), null, 'target must be removed');
    assert.equal(anchor.clicked, 1);
  } finally { restore(); }
});

test('clickCard returns quietly when the listing changed under it', () => {
  // The index was computed against a list that may no longer exist. That is a
  // failed click, not a thrown error — the driver reports extraction_failed.
  const restore = withDom([]);
  try {
    assert.doesNotThrow(() => clickCard({index: 0}));
  } finally { restore(); }
});
