# Agent Implementation Brief: Persistent Statusline

## Core Mental Model
Use when monitoring long-running processes or AI agent contexts where full modal/drawer UIs are too intrusive, but ambient situational awareness is critical.

## Key Rules
1. **Wall-clock Truth**:
   Never render relative countdowns ("3m remaining") unless you guarantee high-frequency timer renders. Always render absolute wall-clock timestamps ("expires 21:40").
2. **Event Collapsing**:
   Fold repeating actions into `Action ×Count` (e.g. `Read ×4`) rather than spamming multiple lines.
3. **Threshold Reactivity**:
   `value < warnThreshold`: Normal accent (Green)
   `value >= warnThreshold && value < critThreshold`: Warning (Yellow)
   `value >= critThreshold`: Critical alert (Red)
