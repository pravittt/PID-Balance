(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BalancePhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const radians = degrees => degrees * Math.PI / 180;
  const degrees = radians => radians * 180 / Math.PI;
  const DEFAULTS = Object.freeze({
    gravity: 9.81, baseMass: 1, rodMass: 0.3, length: 1.4,
    baseDrag: 0.15, pivotDrag: 0.008, forceLimit: 18,
    kp: 110, ki: 0, kd: 18, recenter: true, automatic: true,
    wind: 0, initialAngle: 5, trackLimit: 3.2,
  });
  const PRESETS = Object.freeze({
    balanced: { kp: 110, ki: 0, kd: 18 },
    oscillating: { kp: 55, ki: 0, kd: 0 },
    gentle: { kp: 6, ki: 0, kd: 1 },
  });

  class Simulation {
    constructor(options = {}) {
      this.params = { ...DEFAULTS, ...options };
      this.reset();
    }

    reset() {
      this.state = [0, 0, radians(this.params.initialAngle), 0];
      this.time = 0;
      this.integral = 0;
      this.target = 0;
      this.fallen = false;
      this.reason = '';
      this.output = { p: 0, i: 0, d: 0, raw: 0, force: 0, saturated: false, target: 0 };
    }

    // Uniform rigid rod: center of mass at L/2, inertia about pivot m L²/3.
    massMatrix(theta) {
      const p = this.params;
      const a = p.baseMass + p.rodMass;
      const b = p.rodMass * p.length / 2 * Math.cos(theta);
      const j = p.rodMass * p.length * p.length / 3;
      return { a, b, j, determinant: a * j - b * b };
    }

    derivatives(state, force) {
      const p = this.params;
      const [, velocity, theta, omega] = state;
      const { a, b, j, determinant } = this.massMatrix(theta);
      const translation = force - p.baseDrag * velocity
        + p.rodMass * p.length / 2 * Math.sin(theta) * omega * omega + p.wind;
      const rotation = p.rodMass * p.gravity * p.length / 2 * Math.sin(theta)
        - p.pivotDrag * omega + p.wind * p.length * Math.cos(theta);
      return [velocity, (j * translation - b * rotation) / determinant,
        omega, (a * rotation - b * translation) / determinant];
    }

    controller(dt, manualForce) {
      const p = this.params;
      const [position, velocity, theta, omega] = this.state;
      // A slow outer position loop requests a small lean. It is intentionally
      // visible and switchable; angle PID alone does not regulate base position.
      const requested = p.recenter && p.automatic
        ? clamp(-0.04 * position - 0.14 * velocity, -radians(10), radians(10)) : 0;
      this.target += (requested - this.target) * (1 - Math.exp(-dt / 0.1));

      if (!p.automatic) {
        this.integral = 0;
        const force = clamp(manualForce, -p.forceLimit, p.forceLimit);
        return { p: 0, i: 0, d: 0, raw: manualForce, force,
          saturated: Math.abs(manualForce) > p.forceLimit, target: 0 };
      }

      // Positive error means leaning right; a positive base force catches it.
      // D uses measured angular velocity, so changing the target causes no kick.
      const error = theta - this.target;
      const proportional = p.kp * error;
      const derivative = p.kd * omega;
      if (p.ki <= 0) this.integral = 0;
      else {
        const bound = p.forceLimit * 0.6 / p.ki;
        const candidate = clamp(this.integral + error * dt, -bound, bound);
        const candidateRaw = proportional + p.ki * candidate + derivative;
        // Conditional integration: permit unwinding, block further saturation.
        if (Math.abs(candidateRaw) <= p.forceLimit || error * candidateRaw < 0) {
          this.integral = candidate;
        }
        this.integral = clamp(this.integral, -bound, bound);
      }
      const integral = p.ki * this.integral;
      const raw = proportional + integral + derivative;
      return { p: proportional, i: integral, d: derivative, raw,
        force: clamp(raw, -p.forceLimit, p.forceLimit),
        saturated: Math.abs(raw) > p.forceLimit, target: this.target };
    }

    step(dt, manualForce = 0) {
      if (this.fallen) return this.snapshot();
      if (!(dt > 0 && dt <= 0.05)) throw new RangeError('Use a timestep in (0, 0.05].');
      this.output = this.controller(dt, manualForce);
      // RK4 integration; the controller holds its command during each step.
      const state = this.state;
      const offset = (slope, amount) => state.map((value, i) => value + slope[i] * amount);
      const k1 = this.derivatives(state, this.output.force);
      const k2 = this.derivatives(offset(k1, dt / 2), this.output.force);
      const k3 = this.derivatives(offset(k2, dt / 2), this.output.force);
      const k4 = this.derivatives(offset(k3, dt), this.output.force);
      this.state = state.map((value, i) => value + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      this.time += dt;
      if (Math.abs(this.state[2]) >= radians(70)) {
        this.fallen = true;
        this.reason = 'The stick leaned past 70°. Reset and try another tune.';
      } else if (Math.abs(this.state[0]) >= this.params.trackLimit) {
        this.fallen = true;
        this.reason = this.params.recenter && this.params.automatic
          ? 'The base reached the end of the track. Try a smaller push or adjust the gains.'
          : 'The base reached the end of the track. Try enabling return to center.';
      }
      return this.snapshot();
    }

    push(impulse) {
      if (this.fallen || !Number.isFinite(impulse)) return;
      // A horizontal impulse at the rod tip changes both generalized momenta.
      // Solve M(q) Δq̇ = [J, J L cos(theta)] instead of changing the angle.
      const { a, b, j, determinant } = this.massMatrix(this.state[2]);
      const angularImpulse = impulse * this.params.length * Math.cos(this.state[2]);
      this.state[1] += (j * impulse - b * angularImpulse) / determinant;
      this.state[3] += (a * angularImpulse - b * impulse) / determinant;
    }

    snapshot() {
      return { time: this.time, x: this.state[0], velocity: this.state[1],
        angle: degrees(this.state[2]), omega: degrees(this.state[3]),
        ...this.output, targetAngle: degrees(this.target), fallen: this.fallen };
    }
  }

  return { Simulation, DEFAULTS, PRESETS, clamp, radians, degrees };
});
