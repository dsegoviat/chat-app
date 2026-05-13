# ADR-0003: Reliability governance and SLA verification policy

> **Reading path: second** · Before this, read [`docs/adr/0002-deployment-and-api-architecture.md`](0002-deployment-and-api-architecture.md).
> Next → [`docs/availability-rollout-plan.md`](../availability-rollout-plan.md)

## Status

Accepted

## Date

2026-05-13

## Context

Chat App has selected an AWS-only, multi-region active-active architecture as a long-term target (see `docs/adr/0002-deployment-and-api-architecture.md`), with a long-term availability objective of 99.99%.

To make reliability claims credible in that target state, the project needs explicit governance for SLI/SLO measurement, release gating, failover validation, and operational review cadence. The policies below are defined now to guide the migration, but will be fully enforceable only after the target infrastructure is in place.

## Decision

Adopt formal reliability governance with measurable objectives, synthetic journey evidence, and gate-based release controls.

### 1) Reliability objectives

- Availability target: 99.99%
- Recovery Time Objective (RTO): <= 1 minute
- Recovery Point Objective (RPO): near-zero

### 2) SLI/SLO source of truth

Primary SLA evidence is domain-level synthetic Participant journeys, not infra-only host/process health.

Synthetic journey minimum scope:

- Join room and receive **Bootstrap Response** (participant identity + recent messages)
- Validate **Recent Messages** payload shape and freshness expectations
- Send participant message and verify it appears in the timeline
- Validate reconnect behavior and **Presence Count** flow under controlled reconnection

### 3) Observability baseline

- CloudWatch for metrics/alarms/dashboards
- AWS X-Ray for request tracing
- CloudWatch Synthetics for journey probes
- Centralized structured logs with immutable audit trails for control-plane and high-risk actions

### 4) Gate-based progression and deployment controls

- Reliability progression is phase-gated (see `docs/availability-rollout-plan.md`)
- Blue/green deployments are required in production
- Automatic rollback on SLO breach is required
- Error-budget policy is enforced as a deployment gate

### 5) Validation cadence

- Weekly automated failover drills
- Monthly full game days
- Weekly reliability review
- Monthly SLA report

### 6) Fault model coverage

Validation scope must include:

- Single-AZ failure
- Single-region failure
- Control-plane degradation scenarios

### 7) Break-glass policy timing

Break-glass emergency access workflow is a required control in the final hardening phase, not an early-phase dependency.

## Consequences

Positive:

- Reliability claims are auditable and tied to participant-visible behavior
- Release risk is reduced through SLO-aware gating and automated rollback
- Operations gain repeatable incident readiness through regular drills

Tradeoffs:

- Higher operational overhead for test execution and governance
- Slower release velocity when error budget is exhausted
- More upfront instrumentation work before scale objectives are met

## References

- `docs/adr/0002-deployment-and-api-architecture.md`
- [`docs/availability-rollout-plan.md`](../availability-rollout-plan.md)

---

**Continue reading → [`docs/availability-rollout-plan.md`](../availability-rollout-plan.md)** — the 4-stage migration plan that implements these policies.
