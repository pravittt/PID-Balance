'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, PRESETS, radians } = require('../physics.js');
const DT = 1 / 240;
function advance(simulation, seconds, manualForce = 0) {
  for (let k = 0; k < Math.round(seconds / DT) && !simulation.fallen; k++) simulation.step(DT, manualForce);
  return simulation.snapshot();
}

test('perfect upright equilibrium stays still with no input', () => {
  const sim = new Simulation({ initialAngle: 0, automatic: false });
  advance(sim, 10);
  assert.deepEqual(sim.state, [0, 0, 0, 0]);
});

test('a tilted uncontrolled rod falls; physics does not secretly stabilize it', () => {
  const sim = new Simulation({ automatic: false });
  advance(sim, 5);
  assert.equal(sim.fallen, true);
  assert.ok(Math.abs(sim.state[2]) >= radians(70));
});

test('a positive motor force moves the base right and initially leans the rod left', () => {
  const sim = new Simulation({ initialAngle: 0, automatic: false });
  advance(sim, .1, 2);
  assert.ok(sim.state[0] > 0);
  assert.ok(sim.state[2] < 0);
  assert.equal(sim.output.p, 0);
  assert.equal(sim.output.force, 2);
});

test('a tip impulse changes momentum immediately, but not position or angle', () => {
  const sim = new Simulation({ initialAngle: 0 });
  sim.push(.16);
  assert.equal(sim.state[0], 0);
  assert.equal(sim.state[2], 0);
  const [a, b, j] = [1.3, .3 * 1.4 / 2, .3 * 1.4 ** 2 / 3];
  assert.ok(Math.abs(a * sim.state[1] + b * sim.state[3] - .16) < 1e-12);
  assert.ok(Math.abs(b * sim.state[1] + j * sim.state[3] - .16 * 1.4) < 1e-12);
  assert.ok(sim.state[1] + 1.4 * sim.state[3] > 0, 'tip moves in the push direction');
});

for (const impulse of [-.32, -.16, .16, .32]) {
  test(`default PD recovers from a ${impulse} N·s push and returns near the origin`, () => {
    const sim = new Simulation();
    advance(sim, 6);
    sim.push(impulse);
    const final = advance(sim, 25);
    assert.equal(sim.fallen, false);
    assert.ok(Math.abs(final.angle) < .05, `angle ${final.angle}`);
    assert.ok(Math.abs(final.x) < .02, `position ${final.x}`);
    assert.ok(Math.abs(final.velocity) < .02);
  });
}

test('several small disturbances can be rejected without resetting', () => {
  const sim = new Simulation();
  advance(sim, 6);
  for (const impulse of [.08, -.08, .16, -.16, .08]) {
    sim.push(impulse);
    advance(sim, 6);
    assert.equal(sim.fallen, false);
  }
  const final = advance(sim, 20);
  assert.ok(Math.abs(final.angle) < .02);
  assert.ok(Math.abs(final.x) < .01);
});

test('angle-only feedback allows drift that the position loop removes', () => {
  const centered = new Simulation();
  const angleOnly = new Simulation({ recenter: false, trackLimit: 100 });
  const c = advance(centered, 15);
  const a = advance(angleOnly, 15);
  assert.ok(Math.abs(c.x) < .03);
  assert.ok(Math.abs(a.angle) < .2);
  assert.ok(Math.abs(a.x) > 1);
});

test('motor saturation and anti-windup hold with aggressive gains', () => {
  const sim = new Simulation({ kp: 200, ki: 60, kd: 0, forceLimit: 2, initialAngle: 20 });
  let saturated = false;
  for (let k = 0; k < 120 && !sim.fallen; k++) {
    sim.step(DT);
    saturated ||= sim.output.saturated;
    assert.ok(Math.abs(sim.output.force) <= 2);
    assert.ok(Math.abs(sim.output.i) <= 1.2 + 1e-12);
  }
  assert.equal(saturated, true);
  assert.equal(sim.integral, 0, 'integration is blocked while error drives further saturation');
});

test('a steady tip disturbance produces a physical nonzero equilibrium lean', () => {
  const sim = new Simulation({ wind: .05 });
  const final = advance(sim, 40);
  assert.equal(sim.fallen, false);
  const equilibrium = Math.atan(-2 * .05 / (.3 * 9.81));
  assert.ok(Math.abs(sim.state[2] - equilibrium) < 1e-5);
  assert.ok(Math.abs(final.force + .05) < .001);
});

test('without friction or actuation, integration conserves mechanical energy', () => {
  const sim = new Simulation({ automatic: false, baseDrag: 0, pivotDrag: 0 });
  const energy = () => {
    const [, v, theta, omega] = sim.state;
    return .5 * 1.3 * v * v + .3 * .7 * Math.cos(theta) * v * omega
      + .5 * (.3 * 1.4 ** 2 / 3) * omega ** 2 + .3 * 9.81 * .7 * Math.cos(theta);
  };
  const start = energy();
  advance(sim, .4);
  assert.ok(Math.abs(energy() - start) < 1e-8);
});

test('weak and undamped presets illustrate failure instead of passing as stable tunes', () => {
  for (const preset of [PRESETS.oscillating, PRESETS.gentle]) {
    const sim = new Simulation(preset);
    advance(sim, 12);
    assert.equal(sim.fallen, true);
  }
});

test('reset preserves gains and clears run history and controller memory', () => {
  const sim = new Simulation({ ki: 4 });
  advance(sim, .2);
  sim.push(.16);
  sim.reset();
  assert.equal(sim.params.ki, 4);
  assert.equal(sim.time, 0);
  assert.equal(sim.integral, 0);
  assert.equal(sim.fallen, false);
  assert.deepEqual(sim.state, [0, 0, radians(5), 0]);
});

test('timestep refinement gives similar physical responses', () => {
  const fine = new Simulation();
  const coarse = new Simulation();
  advance(fine, 5);
  for (let k = 0; k < 5 * 120; k++) coarse.step(1 / 120);
  assert.ok(Math.abs(fine.state[0] - coarse.state[0]) < .002);
  assert.ok(Math.abs(fine.state[2] - coarse.state[2]) < .001);
});

test('invalid integration intervals are rejected', () => {
  const sim = new Simulation();
  for (const dt of [0, -.1, .2, NaN]) assert.throws(() => sim.step(dt), RangeError);
});
