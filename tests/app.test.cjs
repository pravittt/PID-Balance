'use strict';
// A lightweight DOM/canvas harness exercises app wiring without dependencies.
// It does not replace visual inspection in a real browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function boot(width = 760) {
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  let now = 0;
  let nextFrame;
  function listenersFor(map, name, callback) {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(callback);
  }
  for (const match of html.matchAll(/<([a-z][\w-]*)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const [, tag, attributes, id] = match;
    assert.equal(elements.has(id), false, `duplicate element id ${id}`);
    const attribute = key => attributes.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];
    const classes = new Set((attribute('class') || '').split(/\s+/).filter(Boolean));
    const listeners = new Map();
    const context = { createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) };
    for (const method of ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'save', 'restore', 'lineCap', 'fillRect', 'fillText', 'setLineDash', 'translate', 'scale', 'rotate', 'roundRect', 'clip', 'rect', 'bezierCurveTo']) context[method] = () => {};
    const element = {
      id, tagName: tag.toUpperCase(), type: attribute('type'), min: attribute('min'), max: attribute('max'),
      value: attribute('value') || '', checked: /\bchecked\b/.test(attributes), hidden: /\bhidden\b/.test(attributes),
      disabled: /\bdisabled\b/.test(attributes), dataset: { chart: attribute('data-chart') },
      innerHTML: '', textContent: '', style: { setProperty() {} },
      classList: { toggle(value, force) { if (force) classes.add(value); else classes.delete(value); }, add: value => classes.add(value), remove: value => classes.delete(value) },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, callback) { listenersFor(listeners, name, callback); },
      emit(name, fields = {}) { const event = { target: element, preventDefault() {}, ...fields }; for (const callback of listeners.get(name) || []) callback(event); },
      getBoundingClientRect: () => ({ width, height: id === 'chart' ? 170 : 348 }),
      getContext: () => context, setPointerCapture() {},
    };
    Object.defineProperty(element, 'valueAsNumber', { get: () => element.value === '' ? NaN : Number(element.value) });
    elements.set(id, element);
  }
  for (const match of html.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...match[2].matchAll(/<option\b([^>]*)value="([^"]+)"([^>]*)>/g)];
    const selected = options.find(option => /\bselected\b/.test(option[1] + option[3])) || options[0];
    elements.get(match[1]).value = selected[2];
  }
  const document = {
    hidden: false,
    getElementById(id) { assert.ok(elements.has(id), `missing DOM element ${id}`); return elements.get(id); },
    querySelectorAll(selector) {
      if (selector === '[data-chart]') return [...elements.values()].filter(element => element.dataset.chart);
      if (selector === 'input[type="range"]') return [...elements.values()].filter(element => element.type === 'range');
      throw new Error(`Unhandled selector ${selector}`);
    },
    addEventListener(name, callback) { listenersFor(documentListeners, name, callback); },
  };
  // Chart buttons have no IDs in the real DOM; include them explicitly here.
  const tabs = ['angle', 'terms'].map(view => ({
    dataset: { chart: view }, classList: { toggle() {} }, setAttribute() {},
    addEventListener(name, callback) { this[name] = callback; },
  }));
  const originalQuery = document.querySelectorAll.bind(document);
  document.querySelectorAll = selector => selector === '[data-chart]' ? tabs : originalQuery(selector);
  const window = { devicePixelRatio: 1, addEventListener(name, callback) { listenersFor(windowListeners, name, callback); } };
  const sandbox = { window, document, performance: { now: () => now }, requestAnimationFrame(callback) { nextFrame = callback; } };
  window.BalancePhysics = require('../physics.js');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  const emitDocument = (name, event) => { for (const callback of documentListeners.get(name) || []) callback({ preventDefault() {}, ...event }); };
  return {
    get: id => elements.get(id), tabs,
    tick(seconds) { for (let k = 0; k < Math.round(seconds * 60); k++) { now += 1000 / 60; nextFrame(now); } },
    key(key, code, target = { tagName: 'BODY' }, repeat = false) { emitDocument('keydown', { key, code, target, repeat }); },
    keyup(key) { emitDocument('keyup', { key }); },
    blur() { for (const callback of windowListeners.get('blur') || []) callback(); },
  };
}

test('interface starts paused, gains match physics, and the start button advances the experiment', () => {
  const app = boot();
  assert.equal(app.get('state-label').textContent, 'Ready to balance');
  assert.equal(Number(app.get('kp').value), 110);
  assert.equal(Number(app.get('kd').value), 18);
  app.get('run-toggle').emit('click');
  app.tick(8);
  assert.equal(app.get('state-label').textContent, 'Simulation running');
  assert.equal(app.get('failure-panel').hidden, true);
  assert.ok(Math.abs(parseFloat(app.get('angle-value').innerHTML)) < .5);
  app.get('run-toggle').emit('click');
  const paused = app.get('sim-time').textContent;
  app.tick(2);
  assert.equal(app.get('sim-time').textContent, paused);
});

test('keyboard pushes still work after the Start button has focus', () => {
  const app = boot();
  app.get('run-toggle').emit('click');
  app.tick(10);
  app.key('ArrowRight', 'ArrowRight', app.get('run-toggle'));
  app.tick(.1);
  assert.ok(parseFloat(app.get('angle-value').innerHTML) > 1);
  assert.match(app.get('announcement').textContent, /Pushed right/);
  app.tick(25);
  assert.equal(app.get('failure-panel').hidden, true);
});

test('gain controls synchronize, chart tabs switch, and invalid numeric values are clamped', () => {
  const app = boot(320);
  app.get('kp-number').value = '999';
  app.get('kp-number').emit('change');
  assert.equal(Number(app.get('kp').value), 200);
  assert.equal(Number(app.get('kp-number').value), 200);
  assert.equal(app.get('preset').value, 'custom');
  app.get('ki').value = '5';
  app.get('ki').emit('input');
  assert.equal(Number(app.get('ki-number').value), 5);
  app.tabs[1].click();
  assert.match(app.get('chart-description').textContent, /contributions/);
  app.tick(.1);
});

test('failed experiments expose reset and restart cleanly with a stable preset', () => {
  const app = boot();
  app.get('preset').value = 'gentle';
  app.get('preset').emit('change');
  app.get('run-toggle').emit('click');
  app.tick(5);
  assert.equal(app.get('failure-panel').hidden, false);
  assert.equal(app.get('run-toggle').disabled, true);
  assert.match(app.get('failure-reason').textContent, /70/);
  app.get('preset').value = 'balanced';
  app.get('preset').emit('change');
  app.get('failure-reset').emit('click');
  app.tick(10);
  assert.equal(app.get('failure-panel').hidden, true);
  assert.equal(app.get('run-toggle').disabled, false);
  assert.equal(app.get('state-label').textContent, 'Simulation running');
});

test('manual buttons apply force while held and blur pauses and releases input', () => {
  const app = boot();
  app.get('mode-manual').emit('click');
  assert.equal(app.get('manual-controls').hidden, false);
  assert.equal(app.get('gain-controls').hidden, true);
  app.get('manual-right').emit('pointerdown', { pointerId: 1 });
  app.tick(.15);
  assert.ok(parseFloat(app.get('force-value').innerHTML) > 0);
  app.get('manual-right').emit('pointerup', { pointerId: 1 });
  app.tick(.1);
  assert.equal(parseFloat(app.get('force-value').innerHTML), 0);
  app.blur();
  assert.equal(app.get('state-label').textContent, 'Paused');
});
