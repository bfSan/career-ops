import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {findSearchBox, fillSearchBox, submitSearch} from '../../china/search-box.mjs';

// Both platforms decide whether a listing request looks like a person made it,
// and both downgrade one that does not. BOSS measured 2026-10-02: the search
// address reached by navigation came back as the homepage with no cards, while
// the same query typed into the field and submitted returned the listing. So
// the listing is reached by using the box, the way a reader reaches it.
//
// These functions are serialized into the page with toString(), so each has to
// be self-contained — nothing at module scope exists at runtime. The last two
// tests pin that, because a missing helper in the page would otherwise surface
// as a generic extraction failure with nothing pointing at the cause.

const ALL = 'input, button, a';

// Selector matching limited to the forms the page functions actually use:
// tags, .class, [attr], [attr*="value"]. Enough to tell a hidden query filter
// apart from a visible search field, which is the distinction the code exists
// to make.
function matches(el, sel) {
  sel = sel.trim();
  if (!sel) return false;
  // tag[attr*="value"] — the shape the page functions actually use. Matching
  // only the attribute (ignoring the tag) would let input[type="submit"] and
  // button[type="submit"] satisfy each other's selectors.
  const combo = sel.match(/^([a-zA-Z]*)\[(\w+)([*^$~]?=)?["']?([^"'\]]*)["']?\]$/);
  if (combo) {
    const [, tag, name, op, want] = combo;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    const have = el.getAttribute(name);
    if (op === '*=') return typeof have === 'string' && have.includes(want);
    if (op === '=') return have === want;
    if (!op) return have !== null && have !== undefined;
    return false;
  }
  // [attr] / [attr*="value"]
  const attr = sel.match(/^\[(\w+)([*^$~]?=)?["']?([^"'\]]*)["']?\]$/);
  if (attr) {
    const [, name, op, want] = attr;
    const have = el.getAttribute(name);
    if (op === '*=') return typeof have === 'string' && have.includes(want);
    if (op === '=') return have === want;
    if (!op) return have !== null && have !== undefined;
    return false;
  }
  if (sel.startsWith('.')) {
    return String(el.getAttribute('class') || '').split(/\s+/).includes(sel.slice(1));
  }
  const tag = sel.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return el.tagName === tag;
}

function mkInput({type='text', placeholder='', name='', cls='', visible=true, disabled=false}={}) {
  const attrs = {type, placeholder, name, class: cls};
  const events = {};
  // Built on HTMLInputElement.prototype, not Object.prototype: fillSearchBox
  // reaches the value through the prototype setter on purpose, and a plain
  // object literal would not have it — the test would then be asserting against
  // the fallback branch and proving nothing about the real path.
  const proto = globalThis.HTMLInputElement?.prototype ?? Object.prototype;
  return Object.assign(Object.create(proto), {
    tagName: 'INPUT', type, disabled, events, attrs,
    getAttribute(n) { return n in attrs ? attrs[n] : null; },
    get offsetWidth() { return visible ? 200 : 0; },
    get offsetHeight() { return visible ? 32 : 0; },
    getClientRects() { return visible ? [{}] : []; },
    focus() { globalThis.document.activeElement = this; },
    dispatchEvent(e) { (events[e.type] ||= []).push(e); return true; },
    closest() { return null; },
    get form() { return null; },
  });
}

function mkButton({type='submit', cls='', visible=true, disabled=false, target=null}={}) {
  const attrs = {class: cls};
  if (type) attrs.type = type;
  if (target) attrs.target = target;
  return {
    tagName: 'BUTTON', disabled, attrs, clicked: 0,
    getAttribute(n) { return n in attrs ? attrs[n] : null; },
    removeAttribute(n) { delete attrs[n]; },
    get offsetWidth() { return visible ? 60 : 0; },
    get offsetHeight() { return visible ? 32 : 0; },
    getClientRects() { return visible ? [{}] : []; },
    click() { this.clicked++; },
    closest() { return null; },
  };
}

function withDom(elements) {
  globalThis.document = {
    activeElement: null,
    body: {innerText: ''},
    // A descendant selector like '.search-form input[type="text"]' is matched
    // on its final segment, which is what these stubs can honestly model.
    querySelectorAll: sel => sel.split(',').flatMap(part =>
      elements.filter(el => matches(el, part.trim().split(/\s+/).pop()))),
    querySelector: sel => globalThis.document.querySelectorAll(sel)[0] || null,
  };
  return () => { delete globalThis.document; };
}

const stubGlobals = () => {
  globalThis.HTMLInputElement = {prototype: {}};
  Object.defineProperty(globalThis.HTMLInputElement.prototype, 'value', {
    configurable: true,
    get() { return this._v ?? ''; },
    set(v) { this._v = v; },
  });
  globalThis.getComputedStyle = () => ({visibility: 'visible'});
  globalThis.Event = class { constructor(type, o) { this.type = type; Object.assign(this, o); } };
  globalThis.KeyboardEvent = class { constructor(type, o) { this.type = type; Object.assign(this, o); } };
  return () => {
    delete globalThis.HTMLInputElement; delete globalThis.getComputedStyle;
    delete globalThis.Event; delete globalThis.KeyboardEvent;
  };
};

test('finds the BOSS search field and its submit button', () => {
  const field = mkInput({placeholder: '搜索职位、公司', cls: 'search-input'});
  const button = mkButton();
  const restore = withDom([field, button]);
  const cleanup = stubGlobals();
  try {
    const r = findSearchBox({platform: 'boss', query: 'AI Agent'});
    assert.equal(r.status, 'found');
    const all = globalThis.document.querySelectorAll(ALL);
    assert.equal(all[r.field], field, 'field index must address the field');
    // submitSearch indexes the non-input list, so the assertion has to read
    // the same list the code does rather than the combined one.
    const controls = all.filter(el => el.tagName !== 'INPUT');
    assert.equal(controls[r.submit], button, 'submit index must address the button');
  } finally { restore(); cleanup(); }
});

test('skips a hidden field and takes the visible one', () => {
  // A generic input[name=query] also matches hidden filter inputs. Filling one
  // of those looks like it worked and then searches for nothing.
  const hidden = mkInput({name: 'query', visible: false});
  const shown = mkInput({name: 'query'});
  const restore = withDom([hidden, shown, mkButton()]);
  const cleanup = stubGlobals();
  try {
    const r = findSearchBox({platform: 'boss', query: 'AI Agent'});
    assert.equal(r.status, 'found');
    const all = globalThis.document.querySelectorAll(ALL);
    assert.equal(all[r.field], shown, 'must not fill the hidden filter input');
  } finally { restore(); cleanup(); }
});

test('reports no field when the page offers no usable search box', () => {
  const restore = withDom([mkButton()]);
  const cleanup = stubGlobals();
  try {
    assert.equal(findSearchBox({platform: 'boss', query: 'x'}).status, 'no_field');
  } finally { restore(); cleanup(); }
});

test('a disabled submit is still located, so Enter can carry the search', () => {
  // A site disables its button until the field has content. Refusing here
  // would strand the run on a page that is perfectly searchable.
  const restore = withDom([mkInput({cls: 'search-input'}), mkButton({disabled: true})]);
  const cleanup = stubGlobals();
  try {
    assert.equal(findSearchBox({platform: 'boss', query: 'x'}).status, 'found');
  } finally { restore(); cleanup(); }
});

test('filling sets the value and fires the events the framework listens for', () => {
  // Assigning .value alone leaves the field looking filled while the page still
  // believes it is empty — React/Vue observe the change only through the events.
  const cleanup = stubGlobals();
  const field = mkInput({cls: 'search-input'});
  // The prototype has to exist before the element is built: mkInput hangs the
  // stub off HTMLInputElement.prototype, and the page function looks the value
  // setter up there.
  const restore = withDom([field, mkButton()]);
  try {
    assert.deepEqual(fillSearchBox({index: 0, query: 'AI Agent'}), {status: 'filled'});
    assert.equal(field.value, 'AI Agent');
    assert.equal(field.events.input.length, 1);
    assert.equal(field.events.change.length, 1);
  } finally { restore(); cleanup(); }
});

test('filling a field that is no longer there fails without throwing', () => {
  const restore = withDom([]);
  const cleanup = stubGlobals();
  try {
    assert.deepEqual(fillSearchBox({index: 3, query: 'x'}), {status: 'missing'});
  } finally { restore(); cleanup(); }
});

test('submitting clicks the located button in place', () => {
  // A new tab would break the driver's single-tab binding.
  const field = mkInput({cls: 'search-input'});
  const button = mkButton({target: '_blank'});
  const restore = withDom([field, button]);
  const cleanup = stubGlobals();
  try {
    submitSearch({index: 0});
    assert.equal(button.clicked, 1);
    assert.equal(button.getAttribute('target'), null, 'target must be stripped');
  } finally { restore(); cleanup(); }
});

test('submitting with no button presses Enter in the field instead', () => {
  const field = mkInput({cls: 'search-input'});
  const restore = withDom([field]);
  const cleanup = stubGlobals();
  try {
    fillSearchBox({index: 0, query: 'AI Agent'});
    submitSearch({index: null});
    assert.equal(field.events.keydown.length, 1);
    assert.equal(field.events.keypress.length, 1);
    assert.equal(field.events.keyup.length, 1);
  } finally { restore(); cleanup(); }
});

test('none of the three page functions reaches for module scope', () => {
  const src = readFileSync(new URL('../../china/search-box.mjs', import.meta.url), 'utf8');
  for (const fn of ['findSearchBox', 'fillSearchBox', 'submitSearch']) {
    const body = src.match(new RegExp(`export function ${fn}[\\s\\S]*?\\n}`))[0];
    assert.ok(!/\bALL\b/.test(body), `${fn} must not reference a module-level constant`);
  }
});

test('the stub models every document property the page functions read', () => {
  // Guards the stub: if a page function starts reading something unmodelled,
  // the tests above would fail for the wrong reason.
  for (const fn of [findSearchBox, fillSearchBox, submitSearch]) {
    for (const [, prop] of fn.toString().matchAll(/\bdocument\.(\w+)/g)) {
      assert.ok(['querySelectorAll', 'querySelector', 'activeElement', 'body'].includes(prop),
        `${fn.name} reads document.${prop}, which the stub does not model`);
    }
  }
});
