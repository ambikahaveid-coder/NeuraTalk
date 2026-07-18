# Engineering Discipline Rules

## Core Principle
**Protect the core at all costs.**

This document defines the engineering standards that govern all development on this platform. These rules are non-negotiable. No engineer may bypass them for convenience or speed.

---

## Architecture Protection Rules

### 1. No Engineer May Bypass Architecture Rules
- The Dependency Zero Policy is absolute
- Core modules require review before changes
- Quick hacks are forbidden in core modules
- Every deviation must be documented and justified

### 2. Core Modules Are Protected
These modules contain our intellectual property and cannot be modified without explicit review:

| Module | Purpose | Change Policy |
|--------|---------|---------------|
| `signaling-server.ts` | WebRTC signaling | Requires architecture review |
| `media-relay.ts` | Audio relay | Requires architecture review |
| `call-gateway.ts` | Call management | Requires architecture review |
| `call-streaming.ts` | Live translation | Requires architecture review |
| `native-telephony-bridge.ts` | Device integration | Requires architecture review |

### 3. Shortcut Documentation
If a shortcut or temporary solution is absolutely necessary:
```
// SHORTCUT: [description]
// REASON: [why this was necessary]
// REMOVE_BY: [date or condition]
// OWNER: [who is responsible for cleanup]
```

Every shortcut must:
- Have a clear removal timeline
- Be tracked in a cleanup backlog
- Be reviewed monthly

---

## Code Quality Rules

### 1. Every Module Must Explain "Why"
```typescript
/**
 * WHY THIS EXISTS:
 * [Explain the purpose]
 * 
 * WHAT IT DOES:
 * [Brief functionality description]
 * 
 * ARCHITECTURAL DECISIONS:
 * [Key design choices and reasons]
 */
```

### 2. No Black Box Code
- Every algorithm must be explainable
- No magic numbers without comments
- No copied code without understanding
- Code must be defensible to investors and regulators

### 3. Test Reality, Not Theory
- Test on real devices, not emulators
- Test under real network conditions
- Measure actual latency, not theoretical
- Record performance metrics, not call content

---

## Documentation Rules

### 1. Document Decisions, Not Just APIs
Bad: "This function translates text."
Good: "This function translates text because we needed phrase-level translation to maintain natural speaking rhythm, unlike sentence-level which creates unacceptable delays."

### 2. Write for Future Team Members
Assume they know nothing about:
- Why we chose this architecture
- What alternatives we rejected
- What constraints we operate under

### 3. Keep Documentation Honest
- Admit limitations
- Document known issues
- Explain trade-offs
- Never hide technical debt

---

## Mode Separation Rules

### Debug Mode
- Exposes internal metrics
- Shows detailed error information
- Includes stack traces
- Available only to developers

### User Mode
- Hides all technical complexity
- Converts errors to human messages
- Never shows stack traces
- User should never feel something is broken

### Error Handling
```typescript
// DEBUG MODE
logger.error("TranslationService", "Translation failed", error);
// Shows: TranslationService: Translation failed at translatePhrase:127

// USER MODE
return toHumanReadableError("TRANSLATION_UNAVAILABLE");
// Shows: "Translation is paused. You can continue speaking."
```

---

## Data Handling Rules

### 1. Collect Only What's Required
- No data "just in case"
- Every field must have a clear purpose
- Transient data is never stored
- Default to not collecting

### 2. Retention Limits
| Data Type | Retention |
|-----------|-----------|
| Session data | Session only |
| Debug logs | 1 hour |
| Performance metrics | 24 hours |
| User preferences | 7 days max |
| Call content | NEVER stored |

### 3. Privacy First
- Anonymize by default
- Never share with third parties
- Give users control
- Less data = more trust

---

## Release Rules

### 1. Gradual Rollout
- Start with 1% of users
- Monitor metrics
- Increase gradually
- Full rollout only after stability proven

### 2. Feature Flags
Every new feature must:
- Be behind a feature flag
- Have an instant kill switch
- Not affect live calls when toggled
- Be testable in isolation

### 3. No Forced Updates During Calls
- Active calls continue uninterrupted
- Flag changes apply to new calls only
- Users never experience mid-call disruption

---

## Human QA Checklist

Before any release, answer these questions:

| Question | Required Answer |
|----------|-----------------|
| Does this feel natural? | Yes |
| Does it feel calm? | Yes |
| Would I trust this with my family? | Yes |
| Does it ever feel robotic? | No |
| Would a non-technical user understand it? | Yes |

**If any answer is wrong, redesign before release.**

---

## Enforcement

### Review Requirements
- Core module changes: Architecture review required
- Data handling changes: Privacy review required
- User-facing changes: Human QA required
- All changes: Code review required

### Violation Consequences
1. First violation: Documented warning, immediate fix required
2. Second violation: Extended review period for all future changes
3. Third violation: Escalation to team leadership

### Audit Trail
All changes to core modules are logged with:
- Who made the change
- What was changed
- Why it was changed
- When it was approved

---

## Summary

These rules exist because we are building a product that people will trust with their conversations. We are not building a demo or a prototype. We are building for decades.

**Compliance > shortcuts.**
**Trust > features.**
**Quality > speed.**
