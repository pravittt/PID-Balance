# PID Balance

**Balance Lab** is a dependency-free browser playground for learning PID control. Balance a wooden stick by moving a circular base, adjust the controller live, and see whether your tune can recover from a push.

## Features

- A wooden stick and circular base animated from a nonlinear physics model.
- Live P, I, and D sliders, numeric gain inputs, and three starting presets.
- Repeatable left/right pushes with selectable impulse strength.
- Manual balancing with keyboard or on-screen controls.
- Live angle/target and P/I/D contribution plots.
- An optional outer loop that returns the base toward the center.
- Adjustable initial lean, motor force limit, and constant tip disturbance.
- Pause, reset, slow motion, motor saturation, and integral anti-windup.

## Getting started

Clone the repository or download and extract its ZIP:

```sh
git clone https://github.com/pravittt/PID-Balance.git
cd PID-Balance
```

Open **index.html** in a modern browser. After downloading the project, no installation, internet connection, or build step is needed to run it.

Alternatively, with Node.js installed:

```sh
npm start
```

Visit http://localhost:5173. The server binds to your own computer only. Stop it with Ctrl+C. If PowerShell blocks `npm.ps1`, use `npm.cmd start` or `node scripts/server.cjs`.

The development commands have been tested with Node.js 22.12.0. There are no npm dependencies to install.

## Your first experiment

1. Keep **A steady hand**, with **P = 110, I = 0, D = 18** and **Return to center** enabled.
2. Click **Start simulation**. Watch it recover from the initial 5° lean.
3. Apply a medium push. Compare the angle and target traces. Switch to **P / I / D** to see the individual force contributions.
4. Choose **All push, no damping**, then **Reset**. This keeps I and D at zero. Try increasing D a little at a time and repeating the same disturbance.
5. Disable **Return to center**. Angle control can keep the stick upright while the base drifts.
6. Try **Try by hand**, reset, and use the arrow keys to move the base. To catch a rightward lean, initially move the base right.

Change the starting lean, motor force limit, or constant tip force to test a harder problem. Gains apply live; starting lean applies on reset. Reset clears time, plots, and controller memory while preserving your selected settings. It preserves running/paused status; the end-of-run reset button also starts the next run.

Push strengths are impulses in N·s, applied at the stick tip. Small and medium pushes are recoverable with the starting tune. Strong pushes use much more track; the challenge push can exceed the recovery envelope. There is no hidden correction when a run is about to fail.

Keyboard: **Space** starts/pauses, **R** resets, and **← / →** push in PID mode or apply continuous motor force while held in manual mode. Form controls keep their native keyboard behavior. The simulation pauses when its tab becomes hidden or the window loses focus.

## What is simulated

- A uniform 0.3 kg rigid rod, length 1.4 m; center of mass at L/2 and pivot inertia mL²/3.
- A 1.0 kg translating base with a free pivot above a decorative wheel.
- Nonlinear coupled dynamics, gravity 9.81 m/s², viscous base drag 0.15 N·s/m, and pivot drag 0.008 N·m·s/rad.
- An ideal horizontal motor force with a selectable magnitude limit.
- A fixed 1/240 s controller/physics timestep, RK4 integration, and separate animation timing. Slow motion changes simulated time, not the physics step.
- A track with limits at ±3.2 m. A run ends at a track limit or 70° of lean. This is a balancing experiment, with no swing-up or ground collision phase.

This is an idealized cart-pole model rendered as a stick above a circle. It does not model an unattached stick contacting a freely rolling ball, rolling inertia, slip, motor electrical dynamics, sensor noise, or actuator delay.

Let x be the base position, θ the clockwise angle from upright, l = L/2, M the base mass, m the rod mass, and J = mL²/3. The accelerations solve:

```text
(M + m) ẍ + m l cos(θ) θ̈ = u − b ẋ + m l sin(θ) θ̇² + w
m l cos(θ) ẍ + J θ̈     = m g l sin(θ) − c θ̇ + w L cos(θ)
```

Here u is motor force and w is a constant horizontal force at the rod tip. A push solves the corresponding momentum jump for both base and rod velocities. It never changes the angle directly.

The formulation follows standard Lagrangian cart-pole dynamics, extended to a uniform rod rather than a point mass. See [MIT Underactuated Robotics: Cart-Pole](https://underactuated.mit.edu/acrobot.html) and [University of Michigan: Inverted Pendulum Modeling](https://ctms.engin.umich.edu/CTMS/index.php?example=InvertedPendulum&section=SystemModeling).

## Controller conventions

```text
e = θ − θ_target                         (radians)
u_raw = Kp e + Ki integral(e dt) + Kd θ̇
u = clamp(u_raw, −forceLimit, +forceLimit)
```

Positive lean and positive base force point right. This is why error is measured angle minus target. D uses measured angular velocity rather than the derivative of the setpoint error, avoiding a derivative kick when the target changes. The integral contribution is capped at 60% of the force limit; integration is blocked when it would drive further saturation and permitted when it unwinds saturation. Setting I to zero clears its stored integral on the next step.

Gain units: P in N/rad, I in N/(rad·s), D in N·s/rad. Displayed angles are degrees; controller angles are radians. Numeric gains are specific to this plant and actuator model.

**Return to center** is a separate fixed outer position/velocity loop:

```text
requested lean = clamp(−0.04 x − 0.14 ẋ, −10°, +10°)
θ_target follows requested lean with a 0.10 s first-order filter
```

The requested lean is visible on the angle plot. Disable this loop to study angle PID by itself. The starting tune intentionally uses **PD**, with I = 0. Integral is something to investigate, not a requirement for successful balancing.

A steady tip force can require a nonzero equilibrium lean. Integral in the angle loop does not guarantee zero position error, and cannot make both position and angle exactly zero against an arbitrary tip force. The slower outer loop is PD and can also leave a position offset under a persistent disturbance.

## Files and checks

- `index.html`, `styles.css`, `app.js`: interface, drawing, interactions, and response plots.
- `physics.js`: standalone simulation/controller; also importable from Node for experiments.
- `scripts/server.cjs`: optional dependency-free local HTTP server.
- `tests/`: numerical behavior and app integration checks.

Run the automated checks with:

```sh
npm test
```

On Windows, use `npm.cmd test` if PowerShell blocks `npm.ps1`. You can also run `node --test tests/*.test.cjs` directly.

The physics tests check equilibrium, failure without control, impulse momentum, recovery after pushes, repeated disturbances, drift, saturation, steady tip forces, energy conservation, reset, and timestep sensitivity. Interface checks exercise startup, keyboard pushes, gain synchronization, chart switching, reset after failure, and manual input using a lightweight DOM/canvas harness. These interface checks do not replace visual inspection in a real browser.
