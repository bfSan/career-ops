/**
 * Reach a results page by using the site's own search box.
 *
 * Why: BOTH platforms decide whether a listing request looks like a person made
 * it, and both downgrade one that does not. Measured on BOSS 2026-10-02 —
 * asking for /web/geek/jobs?query=AI Agent and arriving there by address bar
 * returned https://www.zhipin.com/ with zero job cards, while the same query
 * typed into the search field and submitted returned the listing. 猎聘 is
 * stricter still: a detail URL navigated to without provenance lands on
 * safe.liepin.com, the same complaint one level down (see card-click.mjs).
 *
 * So the listing is reached the way a reader reaches it — find the field, fill
 * it, press the button. The search is a real user gesture and the request that
 * follows carries the session the site expects.
 *
 * Three page functions, split for the same reason as card-click: a script that
 * submits and returns in one evaluation loses its return value, because
 * submitting navigates and destroys the context before the value is marshalled
 * back. See china/search-box.mjs.
 */

export function findSearchBox({platform, query} = {}) {
  const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true'
    && !/disabled|readonly|read-only/i.test(el.getAttribute('class') || '');

  // Ordered most-specific first. A generic input[name=query] also matches the
  // hidden filter inputs both sites keep, and filling one of those is silently
  // useless — the field looks filled and the search returns everything.
  const fieldSelectors = platform === 'boss'
    ? ['.search-form input[type="text"]', '.search-form input:not([type])',
       'input.search-input', 'input[placeholder*="搜索职位"]', 'input[placeholder*="职位名称"]',
       'input[name="query"]', 'input[type="search"]']
    : platform === 'linkedin'
      ? ['input.jobs-search__text-input', 'input[aria-label*="Search"]',
         'input[placeholder*="Search"]', 'input[type="search"]', 'input[name="keywords"]']
      : ['.keyword-input', 'input[name="key"]', 'input[placeholder*="职位"]', 'input[placeholder*="关键词"]',
         'input[type="search"]', 'input[type="text"]'];

  const field = fieldSelectors
    .flatMap(sel => [...document.querySelectorAll(sel)])
    .find(el => visible(el) && enabled(el) && el.type !== 'hidden');
  if (!field) return {status: 'no_field'};

  // Prefer a submit control inside the field's own form; a bare page-wide
  // button risks pressing something unrelated.
  const form = field.closest('form') || field.form;
  const submitSelectors = platform === 'linkedin'
    ? ['button.jobs-search__submit', 'button[aria-label*="Search"]', 'button[type="submit"]']
    : ['button[type="submit"]', '.search-form button', 'button.btn-search', 'button.btn.btn-search',
       'a.btn-search', 'button[class*="search"]', 'button'];
  const scope = form || document;
  const submit = submitSelectors
    .flatMap(sel => [...scope.querySelectorAll(sel)])
    .find(el => visible(el) && enabled(el));

  // Inlined rather than shared: these run in the page via toString(), so
  // nothing at module scope exists at runtime. 'input, button, a' is the one
  // list every step indexes, so an index means the same element in each.
  const all = [...document.querySelectorAll('input, button, a')];
  const controlIndex = el => all.filter(x => x.tagName !== 'INPUT').indexOf(el);
  return {status: 'found', field: all.indexOf(field), submit: submit ? controlIndex(submit) : null};
}

export function fillSearchBox({index, query} = {}) {
  const field = [...document.querySelectorAll('input, button, a')]
    .filter(el => el.tagName === 'INPUT')[index];
  if (!field) return {status: 'missing'};
  field.focus();
  // React/Vue install their own value setter on the element; calling the
  // prototype's is what makes the framework observe the change. Assigning
  // .value directly leaves the field looking filled while the page still
  // believes it is empty, and the search then runs with the old text.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(field, query);
  else field.value = query;
  field.dispatchEvent(new Event('input', {bubbles: true}));
  field.dispatchEvent(new Event('change', {bubbles: true}));
  return {status: 'filled'};
}

export function submitSearch({index} = {}) {
  const control = [...document.querySelectorAll('input, button, a')]
    .filter(el => el.tagName !== 'INPUT')[index];
  if (control) {
    // target=_blank would open a second tab and break the single-tab binding.
    if (control.getAttribute('target')) control.removeAttribute('target');
    control.click();
    return;
  }
  // No usable button: press Enter in the field, which submits a form that has
  // a single input. document.activeElement is the field just filled.
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT') {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      active.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
      }));
    }
  }
}
