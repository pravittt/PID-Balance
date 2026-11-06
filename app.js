(function () {
  'use strict';
  const { Simulation, PRESETS, clamp, radians } = window.BalancePhysics;
  const byId = id => document.getElementById(id);
  const simulation = new Simulation();
  const scene = byId('scene');
  const chart = byId('chart');
  const sceneContext = scene.getContext('2d');
  const chartContext = chart.getContext('2d');
  const DT = 1 / 240;
  const WINDOW = 15;
  const sampleStride = 8;
  let running = false;
  let speed = 1;
  let accumulator = 0;
  let previousFrame = null;
  let previousUI = -1;
  let steps = 0;
  let chartView = 'angle';
  let samples = [simulation.snapshot()];
  let pushes = [];
  let pushFlash = null;
  let camera = 0;
  const keys = new Set();
  const heldPointers = new Map();
  let canvasSizes = new WeakMap();
  const palette = { ink: '#384535', muted: '#949c87', grid: '#dfe3d5', green: '#52784c',
    purple: '#9380a2', blue: '#5c8699', target: '#a5af94', gold: '#bc9259' };

  function announce(message) { byId('announcement').textContent = message; }
  function signed(value, precision = 2) {
    const number = Math.abs(value) < 0.5 * 10 ** -precision ? 0 : value;
    return (number > 0 ? '+' : '') + number.toFixed(precision);
  }
  function rangeFill(input) {
    const amount = 100 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    input.style.setProperty('--fill', `${amount}%`);
  }
  function matchingPreset() {
    return Object.keys(PRESETS).find(key => ['kp', 'ki', 'kd'].every(gain => simulation.params[gain] === PRESETS[key][gain])) || 'custom';
  }
  function syncGainInputs() {
    for (const key of ['kp', 'ki', 'kd']) {
      byId(key).value = simulation.params[key];
      byId(key + '-number').value = simulation.params[key];
      rangeFill(byId(key));
    }
    byId('preset').value = matchingPreset();
  }
  function updateNote() {
    byId('controller-note').textContent = !simulation.params.automatic
      ? 'The PID is off. Your input drives the base motor.'
      : !simulation.params.recenter
        ? 'Angle control only: a balanced stick can still drift.'
        : simulation.params.ki > 0
          ? 'Integral is active, with protection against windup.'
          : 'Start with P + D. Integral can stay at zero.';
  }
  function releaseManual() {
    keys.clear();
    heldPointers.clear();
    byId('manual-left').classList.remove('held');
    byId('manual-right').classList.remove('held');
  }
  function setRunning(next) {
    if (simulation.fallen && next) return;
    running = next;
    accumulator = 0;
    previousFrame = null;
    if (!next) releaseManual();
    updateUI();
  }
  function reset() {
    simulation.reset();
    accumulator = 0;
    steps = 0;
    samples = [simulation.snapshot()];
    pushes = [];
    pushFlash = null;
    camera = 0;
    releaseManual();
    byId('failure-panel').hidden = true;
    updateUI();
    draw();
    announce('Experiment reset. Your controller settings are unchanged.');
  }
  function applyPush(direction) {
    if (simulation.fallen) return;
    const impulse = Number(byId('push-strength').value) * direction;
    simulation.push(impulse);
    pushes.push({ time: simulation.time, impulse });
    pushFlash = { direction, started: performance.now() };
    samples.push(simulation.snapshot());
    announce(`Pushed ${direction > 0 ? 'right' : 'left'} with ${Math.abs(impulse).toFixed(2)} newton seconds.${running ? '' : ' Start or resume to watch the response.'}`);
    updateUI();
  }
  function setMode(automatic) {
    simulation.params.automatic = automatic;
    simulation.integral = 0;
    releaseManual();
    byId('mode-auto').classList.toggle('active', automatic);
    byId('mode-manual').classList.toggle('active', !automatic);
    byId('mode-auto').setAttribute('aria-pressed', String(automatic));
    byId('mode-manual').setAttribute('aria-pressed', String(!automatic));
    byId('gain-controls').hidden = !automatic;
    byId('manual-controls').hidden = automatic;
    byId('preset').disabled = !automatic;
    byId('recenter').disabled = !automatic;
    updateNote();
    announce(automatic ? 'PID control enabled.' : 'Manual control enabled. Hold the arrow keys to move the base.');
  }
  function manualForce() {
    const directions = [...heldPointers.values()];
    const left = keys.has('ArrowLeft') || directions.includes(-1);
    const right = keys.has('ArrowRight') || directions.includes(1);
    return (Number(right) - Number(left)) * simulation.params.forceLimit * 0.55;
  }
  function wireManualButton(id, direction) {
    const button = byId(id);
    button.addEventListener('pointerdown', event => {
      if (simulation.fallen) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      heldPointers.set(event.pointerId, direction);
      button.classList.add('held');
      if (!running) setRunning(true);
    });
    const release = event => {
      heldPointers.delete(event.pointerId);
      button.classList.remove('held');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('keydown', event => {
      if ((event.code === 'Space' || event.code === 'Enter') && !event.repeat) {
        event.preventDefault();
        heldPointers.set(id, direction);
        button.classList.add('held');
        if (!running) setRunning(true);
      }
    });
    button.addEventListener('keyup', event => {
      if (event.code === 'Space' || event.code === 'Enter') {
        heldPointers.delete(id);
        button.classList.remove('held');
      }
    });
    button.addEventListener('blur', () => {
      heldPointers.delete(id);
      button.classList.remove('held');
    });
  }

  byId('run-toggle').addEventListener('click', () => setRunning(!running));
  byId('reset').addEventListener('click', reset);
  byId('failure-reset').addEventListener('click', () => { reset(); setRunning(true); });
  byId('speed').addEventListener('change', event => { speed = Number(event.target.value); });
  byId('push-left').addEventListener('click', () => applyPush(-1));
  byId('push-right').addEventListener('click', () => applyPush(1));
  byId('mode-auto').addEventListener('click', () => setMode(true));
  byId('mode-manual').addEventListener('click', () => setMode(false));
  byId('recenter').addEventListener('change', event => {
    simulation.params.recenter = event.target.checked;
    updateNote();
  });
  byId('preset').addEventListener('change', event => {
    const preset = PRESETS[event.target.value];
    if (!preset) return;
    Object.assign(simulation.params, preset);
    simulation.integral = 0;
    syncGainInputs();
    updateNote();
    announce('Controller preset loaded. Reset to compare from the same starting lean.');
  });
  for (const key of ['kp', 'ki', 'kd']) {
    const slider = byId(key);
    const numeric = byId(key + '-number');
    const update = value => {
      simulation.params[key] = clamp(value, Number(slider.min), Number(slider.max));
      syncGainInputs();
      updateNote();
    };
    slider.addEventListener('input', () => update(Number(slider.value)));
    numeric.addEventListener('input', () => {
      if (numeric.value !== '' && Number.isFinite(numeric.valueAsNumber)) {
        simulation.params[key] = clamp(numeric.valueAsNumber, Number(slider.min), Number(slider.max));
        slider.value = simulation.params[key];
        rangeFill(slider);
        byId('preset').value = matchingPreset();
        updateNote();
      }
    });
    numeric.addEventListener('change', () => update(Number(numeric.value) || 0));
  }
  for (const [id, parameter, unit, precision] of [
    ['initial-angle', 'initialAngle', '°', 0], ['force-limit', 'forceLimit', ' N', 0], ['wind', 'wind', ' N', 2],
  ]) {
    const input = byId(id);
    input.addEventListener('input', () => {
      simulation.params[parameter] = Number(input.value);
      byId(id + '-output').textContent = Number(input.value).toFixed(precision) + unit;
      rangeFill(input);
    });
  }
  for (const button of document.querySelectorAll('[data-chart]')) {
    button.addEventListener('click', () => {
      chartView = button.dataset.chart;
      for (const peer of document.querySelectorAll('[data-chart]')) {
        peer.classList.toggle('active', peer === button);
        peer.setAttribute('aria-pressed', String(peer === button));
      }
      const terms = chartView === 'terms';
      byId('chart-description').textContent = terms ? 'Angle PID contributions · newtons' : 'Stick angle & target · degrees';
      byId('chart-legend').innerHTML = terms
        ? '<span><i class="legend-p"></i>P</span><span><i class="legend-i"></i>I</span><span><i class="legend-d"></i>D</span>'
        : '<span><i class="legend-angle"></i>Actual</span><span><i class="legend-target"></i>Target</span>';
      chart.setAttribute('aria-label', terms ? 'Proportional, integral, and derivative force contributions over the last 15 seconds' : 'Stick angle and target angle over the last 15 seconds');
      drawChart();
    });
  }
  wireManualButton('manual-left', -1);
  wireManualButton('manual-right', 1);
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable) return;
    // Leave native button activation alone; arrows still work after clicking Start.
    if (event.target.tagName === 'BUTTON' && (event.code === 'Space' || event.code === 'Enter')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) setRunning(!running);
    } else if (event.code === 'KeyR') {
      if (!event.repeat) reset();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (simulation.params.automatic) {
        if (!event.repeat) applyPush(event.key === 'ArrowLeft' ? -1 : 1);
      } else {
        keys.add(event.key);
        if (!running && !simulation.fallen) setRunning(true);
      }
    }
  });
  document.addEventListener('keyup', event => { keys.delete(event.key); });
  window.addEventListener('blur', () => { if (running) setRunning(false); releaseManual(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setRunning(false); });

  function updateUI() {
    const snapshot = simulation.snapshot();
    byId('angle-value').innerHTML = `${signed(snapshot.angle)}<span>°</span>`;
    byId('position-value').innerHTML = `${signed(snapshot.x)}<span> m</span>`;
    byId('force-value').innerHTML = `${signed(snapshot.force)}<span> N</span>`;
    byId('limit-indicator').hidden = !snapshot.saturated;
    const tenths = Math.floor(snapshot.time * 10 + 1e-6);
    const minutes = Math.floor(tenths / 600).toString().padStart(2, '0');
    const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
    byId('sim-time').textContent = `${minutes}:${seconds}`;
    byId('state-label').textContent = snapshot.fallen ? 'Run ended' : running ? 'Simulation running' : snapshot.time > 0 ? 'Paused' : 'Ready to balance';
    byId('state-dot').className = 'status-dot' + (snapshot.fallen ? ' failed' : running ? '' : ' paused');
    byId('run-toggle').innerHTML = running ? '<span aria-hidden="true">Ⅱ</span> Pause' : '<span aria-hidden="true">▶</span> ' + (snapshot.time > 0 ? 'Resume' : 'Start simulation');
    byId('run-toggle').disabled = snapshot.fallen;
    byId('push-left').disabled = snapshot.fallen;
    byId('push-right').disabled = snapshot.fallen;
    byId('manual-left').disabled = snapshot.fallen;
    byId('manual-right').disabled = snapshot.fallen;
  }

  function prepareCanvas(canvas, context) {
    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width;
    const height = bounds.height;
    if (width <= 0 || height <= 0) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const previous = canvasSizes.get(canvas);
    if (!previous || previous.width !== width || previous.height !== height || previous.dpr !== dpr) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvasSizes.set(canvas, { width, height, dpr });
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    return { width, height };
  }
  function line(context, x1, y1, x2, y2, color, width = 1) {
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2);
    context.strokeStyle = color; context.lineWidth = width; context.stroke();
  }
  function circle(context, x, y, radius, fill, stroke) {
    context.beginPath(); context.arc(x, y, radius, 0, 2 * Math.PI);
    if (fill) { context.fillStyle = fill; context.fill(); }
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = 1; context.stroke(); }
  }
  function arrow(context, x, y, distance, color) {
    if (Math.abs(distance) < 3) return;
    const direction = Math.sign(distance);
    context.save(); context.lineCap = 'round';
    line(context, x, y, x + distance, y, color, 2);
    line(context, x + distance - direction * 6, y - 4, x + distance, y, color, 2);
    line(context, x + distance - direction * 6, y + 4, x + distance, y, color, 2);
    context.restore();
  }
  function drawScene() {
    const dimensions = prepareCanvas(scene, sceneContext);
    if (!dimensions) return;
    const { width: w, height: h } = dimensions;
    const c = sceneContext;
    const [position, , theta] = simulation.state;
    const scale = Math.min(155, (h - 117) / (simulation.params.length + 0.34));
    const ground = h - 55;
    const wheelRadius = Math.max(18, scale * 0.18);
    const visibleHalf = (w / 2 - 35) / scale;
    const cameraTarget = Math.sign(position) * Math.max(0, Math.abs(position) - Math.max(0.35, visibleHalf - 0.6));
    camera += (cameraTarget - camera) * 0.10;
    const worldX = x => w / 2 + (x - camera) * scale;
    const x = worldX(position);
    const wheelY = ground - wheelRadius;
    const pivotY = ground - 2 * wheelRadius - 5;
    const rodLength = simulation.params.length * scale;
    const tipX = x + Math.sin(theta) * rodLength;
    const tipY = pivotY - Math.cos(theta) * rodLength;

    const background = c.createLinearGradient(0, 0, 0, h);
    background.addColorStop(0, '#f0f1e9'); background.addColorStop(1, '#e9eddf');
    c.fillStyle = background; c.fillRect(0, 0, w, h);
    // A quiet measuring grid provides spatial reference without a game-like HUD.
    for (let gx = ((w / 2 - camera * scale) % 28 + 28) % 28; gx < w; gx += 28) {
      for (let gy = 25; gy < ground - 12; gy += 28) circle(c, gx, gy, 0.65, '#cbd3bc70');
    }
    const floorGradient = c.createLinearGradient(0, ground, 0, h);
    floorGradient.addColorStop(0, '#dde3d0'); floorGradient.addColorStop(1, '#e8ebde');
    c.fillStyle = floorGradient; c.fillRect(0, ground, w, h - ground);
    line(c, 0, ground, w, ground, '#b6c2a5');
    c.font = '9px "Cascadia Code", Consolas, monospace'; c.textAlign = 'center';
    for (let metre = -3; metre <= 3; metre += 0.5) {
      const tickX = worldX(metre);
      if (tickX < 14 || tickX > w - 14) continue;
      line(c, tickX, ground, tickX, ground + (Number.isInteger(metre) ? 8 : 4), '#b6c0a7');
      if (Number.isInteger(metre)) {
        c.fillStyle = metre === 0 ? '#748761' : '#9aa78b';
        c.fillText(metre === 0 ? '0 m' : `${metre > 0 ? '+' : ''}${metre}`, tickX, ground + 23);
      }
    }
    for (const endpoint of [-simulation.params.trackLimit, simulation.params.trackLimit]) {
      const endpointX = worldX(endpoint);
      if (endpointX > 0 && endpointX < w) {
        line(c, endpointX, ground - 17, endpointX, ground + 2, '#a9916c', 3);
      }
    }
    // A fixed vertical reference and a faint target lean make corrections legible.
    c.save(); c.setLineDash([3, 5]);
    line(c, x, pivotY, x, pivotY - rodLength - 12, '#a6b39895');
    if (Math.abs(simulation.target) > radians(0.25)) {
      line(c, x, pivotY, x + Math.sin(simulation.target) * rodLength,
        pivotY - Math.cos(simulation.target) * rodLength, '#83976d80');
    }
    c.restore();

    c.save(); c.translate(x, ground + 2); c.scale(1, 0.15);
    const shadow = c.createRadialGradient(0, 0, 2, 0, 0, wheelRadius * 1.7);
    shadow.addColorStop(0, '#53643f36'); shadow.addColorStop(1, '#53643f00');
    circle(c, 0, 0, wheelRadius * 1.7, shadow); c.restore();
    circle(c, x, wheelY, wheelRadius, '#46513c', '#3c4732');
    const rim = c.createLinearGradient(x - wheelRadius, wheelY - wheelRadius, x + wheelRadius, wheelY + wheelRadius);
    rim.addColorStop(0, '#d5b983'); rim.addColorStop(0.4, '#bb9456'); rim.addColorStop(1, '#99723d');
    circle(c, x, wheelY, wheelRadius - 3.2, rim, '#e2c995');
    circle(c, x, wheelY, wheelRadius - 7, '#b48d52', '#9f783e');
    c.save(); c.translate(x, wheelY); c.rotate(position * scale / wheelRadius);
    for (let i = 0; i < 6; i++) {
      c.save(); c.rotate(i * Math.PI / 3);
      line(c, 5, 0, wheelRadius - 9, 0, '#dbc291', 2);
      c.restore();
    }
    c.restore();
    circle(c, x, wheelY, 6, '#d7bf8b', '#9f7b43');
    circle(c, x, wheelY, 2.5, '#7b653e');
    // The support is fixed to the translating base, above the decorative wheel.
    c.fillStyle = '#586349'; c.beginPath(); c.roundRect(x - 7, pivotY - 2, 14, 8, 3); c.fill();
    c.save(); c.translate(x, pivotY); c.rotate(theta);
    c.shadowColor = '#5a513a26'; c.shadowBlur = 6; c.shadowOffsetX = 2; c.shadowOffsetY = 2;
    const wood = c.createLinearGradient(-7, 0, 7, 0);
    wood.addColorStop(0, '#a77945'); wood.addColorStop(.16, '#c4955e'); wood.addColorStop(.48, '#e0ba80'); wood.addColorStop(.78, '#cea46d'); wood.addColorStop(1, '#a87a47');
    c.fillStyle = wood; c.beginPath(); c.roundRect(-6, -rodLength, 12, rodLength + 3, [4, 4, 3, 3]); c.fill();
    c.shadowColor = 'transparent';
    c.save(); c.beginPath(); c.roundRect(-6, -rodLength, 12, rodLength + 3, 4); c.clip();
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      const grainX = -4.5 + i * 2.1;
      c.moveTo(grainX, 0);
      c.bezierCurveTo(grainX + 2.2, -rodLength * .3, grainX - 2, -rodLength * .64, grainX + .5, -rodLength);
      c.strokeStyle = i % 2 ? '#85613a35' : '#f6dfb34f'; c.lineWidth = .6; c.stroke();
    }
    c.restore();
    line(c, -4, -rodLength + 3, 4, -rodLength + 3, '#f0d3a0', 1);
    c.restore();
    circle(c, x, pivotY, 5.3, '#d7c795', '#747a58');
    circle(c, x, pivotY, 1.8, '#616d4e');

    // Angle annotation follows the actual stick, including its sign.
    const angle = simulation.snapshot().angle;
    if (Math.abs(angle) > 0.6 && Math.abs(angle) < 60) {
      c.save(); c.strokeStyle = '#8b9a75'; c.lineWidth = 1;
      c.beginPath(); c.arc(x, pivotY, 34, -Math.PI / 2, -Math.PI / 2 + theta, theta < 0); c.stroke();
      c.font = '10px "Cascadia Code", Consolas, monospace'; c.fillStyle = '#83916f'; c.textAlign = theta >= 0 ? 'left' : 'right';
      c.fillText(`${signed(angle, 1)}°`, x + (theta >= 0 ? 16 : -16), pivotY - 43);
      c.restore();
    }
    const motorForce = simulation.output.force;
    if (Math.abs(motorForce) > .15) arrow(c, x, ground + 37, clamp(motorForce * 4, -85, 85), '#6f8d54');
    if (Math.abs(simulation.params.wind) > .01) {
      arrow(c, tipX - Math.sign(simulation.params.wind) * 52, tipY + 12, Math.sign(simulation.params.wind) * 36, '#9a8a71');
    }
    if (pushFlash) {
      const age = performance.now() - pushFlash.started;
      if (age < 1100) {
        c.save(); c.globalAlpha = Math.max(0, 1 - age / 1100);
        const startX = tipX - pushFlash.direction * 60;
        arrow(c, startX, tipY, pushFlash.direction * 44, '#bc8e4f');
        c.fillStyle = '#a47c43'; c.font = '9px "Cascadia Code", Consolas, monospace'; c.textAlign = 'center';
        c.fillText('PUSH', startX + pushFlash.direction * 19, tipY - 12); c.restore();
      } else pushFlash = null;
    }
  }

  function drawChart() {
    const dimensions = prepareCanvas(chart, chartContext);
    if (!dimensions) return;
    const { width: w, height: h } = dimensions;
    const c = chartContext;
    const margin = { left: 45, right: 19, top: 13, bottom: 26 };
    const width = w - margin.left - margin.right;
    const height = h - margin.top - margin.bottom;
    const end = Math.max(WINDOW, simulation.time);
    const start = end - WINDOW;
    const visible = samples.filter(sample => sample.time >= start - .05);
    const series = chartView === 'angle'
      ? [{ key: 'angle', color: palette.green }, { key: 'targetAngle', color: palette.target, dashed: true }]
      : [{ key: 'p', color: palette.green }, { key: 'i', color: palette.purple }, { key: 'd', color: palette.blue }];
    let peak = chartView === 'angle' ? 5 : 2;
    for (const sample of visible) for (const item of series) peak = Math.max(peak, Math.abs(sample[item.key]));
    const ceiling = chartView === 'angle' ? 90 : Infinity;
    const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
    const extent = Math.min(ceiling, Math.ceil(peak * 1.12 / magnitude) * magnitude);
    const toX = time => margin.left + (time - start) / WINDOW * width;
    const toY = value => margin.top + height / 2 - value / extent * height / 2;
    c.font = '9px "Cascadia Code", Consolas, monospace'; c.textBaseline = 'middle';
    for (let tick = -2; tick <= 2; tick++) {
      const value = tick * extent / 2;
      const y = toY(value);
      line(c, margin.left, y, w - margin.right, y, tick === 0 ? '#d2d9c6' : '#edf0e6');
      c.fillStyle = '#77836a'; c.textAlign = 'right';
      c.fillText(value === 0 ? '0' : signed(value, extent < 3 ? 1 : 0), margin.left - 9, y);
    }
    const tickInterval = w < 400 ? 5 : 3;
    for (let time = Math.ceil(start / tickInterval) * tickInterval; time <= end; time += tickInterval) {
      const x = toX(time);
      line(c, x, margin.top, x, margin.top + height, '#eef0e7');
      c.textAlign = 'center'; c.fillStyle = '#77836a';
      c.fillText(`${time.toFixed(0)}s`, x, h - 10);
    }
    c.save(); c.beginPath(); c.rect(margin.left, margin.top - 1, width, height + 2); c.clip();
    for (const push of pushes) {
      if (push.time < start || push.time > end) continue;
      c.save(); c.setLineDash([2, 4]);
      line(c, toX(push.time), margin.top, toX(push.time), margin.top + height, '#c19a6260');
      c.restore();
      c.fillStyle = '#bf965b'; c.beginPath();
      c.moveTo(toX(push.time) - 3, margin.top); c.lineTo(toX(push.time) + 3, margin.top); c.lineTo(toX(push.time), margin.top + 4); c.fill();
    }
    for (const item of series) {
      c.beginPath(); c.strokeStyle = item.color; c.lineWidth = item.dashed ? 1.2 : 1.7;
      c.setLineDash(item.dashed ? [4, 4] : []);
      visible.forEach((sample, i) => {
        const x = toX(sample.time); const y = toY(sample[item.key]);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.stroke();
      c.setLineDash([]);
      if (!item.dashed && visible.length) {
        const last = visible[visible.length - 1];
        circle(c, toX(last.time), toY(last[item.key]), 2.5, item.color);
      }
    }
    c.restore();
  }
  function draw() { drawScene(); drawChart(); }
  function frame(timestamp) {
    if (previousFrame === null) previousFrame = timestamp;
    const elapsed = Math.min((timestamp - previousFrame) / 1000, 0.1);
    previousFrame = timestamp;
    if (running) {
      accumulator += elapsed * speed;
      while (accumulator >= DT && !simulation.fallen) {
        simulation.step(DT, manualForce());
        accumulator -= DT;
        steps++;
        if (steps % sampleStride === 0) {
          samples.push(simulation.snapshot());
          while (samples.length > 1 && samples[1].time < simulation.time - WINDOW - .1) samples.shift();
          pushes = pushes.filter(push => push.time >= simulation.time - WINDOW - 1);
        }
      }
      if (simulation.fallen) {
        samples.push(simulation.snapshot());
        byId('failure-panel').hidden = false;
        byId('failure-reason').textContent = simulation.reason;
        setRunning(false);
        announce(simulation.reason);
      }
    }
    // Render continuously for smooth motion, but update text/plots at 20 Hz.
    drawScene();
    if (timestamp - previousUI > 50) {
      updateUI(); drawChart(); previousUI = timestamp;
    }
    requestAnimationFrame(frame);
  }
  for (const input of document.querySelectorAll('input[type="range"]')) rangeFill(input);
  syncGainInputs();
  updateNote();
  updateUI();
  window.addEventListener('resize', () => { canvasSizes = new WeakMap(); draw(); });
  draw();
  requestAnimationFrame(frame);
})();
