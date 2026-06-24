# ASTRA — Architecture Documentation

## Overview

ASTRA is a **production-grade Stellar Testnet wallet dashboard** built with:
- **Frontend**: Vite + Vanilla JS (ES modules), Vanilla CSS, Chart.js
- **Smart Contracts**: Soroban (Rust, WASM), deployed on Stellar Testnet
- **Wallets**: Freighter extension + Albedo (web)

```
┌─────────────────────────────────────────────────────────────────┐
│                        ASTRA Dashboard                          │
│  ┌───────────────────┐         ┌──────────────────────────────┐ │
│  │  Frontend (Vite)  │         │   Soroban Smart Contracts    │ │
│  │  src/main.js      │◄───────►│   hello-world + escrow       │ │
│  │  src/style.css    │         │   Rust/WASM on Testnet       │ │
│  └────────┬──────────┘         └──────────────────────────────┘ │
│           │                                                     │
│   ┌───────▼────────┐   ┌────────────────┐  ┌─────────────────┐ │
│   │  Horizon API   │   │  Soroban RPC   │  │  Freighter/     │ │
│   │  (payments,    │   │  (simulation,  │  │  Albedo Wallet  │ │
│   │   balances,    │   │   submission,  │  │  (signing)      │ │
│   │   streaming)   │   │   events)      │  │                 │ │
│   └────────────────┘   └────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
SOHAM/
├── contract/                        # Soroban smart contracts (Rust workspace)
│   ├── Cargo.toml                   # Workspace definition
│   ├── deploy.sh                    # Deployment automation script
│   ├── deploy-config.json           # Network/contract ID configuration
│   └── contracts/
│       ├── hello-world/             # Primary contract
│       │   └── src/
│       │       ├── lib.rs           # Contract logic (8 functions)
│       │       └── test.rs          # 22 unit tests
│       └── escrow/                  # Inter-contract communication demo
│           └── src/
│               ├── lib.rs           # Escrow logic (cross-contract calls)
│               └── test.rs          # Integration tests
│
├── src/                             # Frontend source
│   ├── main.js                      # Core app logic (2200+ lines)
│   ├── style.css                    # Design system (1800+ lines)
│   └── tests/
│       ├── setup.js                 # Vitest DOM setup
│       └── utils.test.js            # 30 frontend unit tests
│
├── .github/
│   └── workflows/
│       ├── ci.yml                   # CI: lint + test on every push
│       └── deploy.yml               # CD: build + deploy on main merge
│
├── index.html                       # Main HTML (Vite entry)
├── vite.config.js                   # Vite + Vitest configuration
├── package.json                     # Node dependencies
├── Makefile                         # Developer shortcuts
└── ARCHITECTURE.md                  # This file
```

---

## Smart Contracts

### hello-world Contract

The primary Soroban contract with **8 public functions**:

| Function | Type | Description |
|---|---|---|
| `hello(to)` | Read | Returns `["Hello", <to>]` greeting vector |
| `increment()` | Write | Increments on-chain counter, returns new value |
| `get_count()` | Read | Returns current counter (no auth needed) |
| `batch_increment(steps)` | Write | Increments by N steps, returns `BatchResult` struct |
| `store_message(key, value)` | Write | Persists key→value pair in instance storage |
| `get_message(key)` | Read | Retrieves stored value for key |
| `list_messages()` | Read | Returns all stored messages as `MessageRecord[]` |
| `reset()` | Write | Resets counter to zero |

**Events emitted**: Every write function emits a `(topic1, topic2) → data` contract event, enabling real-time streaming.

**Storage**: Uses `instance` persistent storage (survives ledger epochs).

### escrow Contract

Demonstrates **inter-contract communication** (cross-contract calls):

```rust
// In escrow/src/lib.rs
env.invoke_contract::<u32>(
    &counter_contract,          // Address of hello-world
    &symbol_short!("increment"), // Function to call
    vec![&env],                  // Arguments
)
```

The `deposit()` function calls into `hello-world.increment()` and the `escrow_hello()` function calls `hello-world.hello()`.

---

## Frontend Architecture

### State Management

All application state lives in module-level `let` variables (no external state library):

```
userAddress         → Connected wallet public key
currentBalance      → XLM balance
watchlist           → Array of watched accounts (persisted in localStorage)
capturedEvents      → Contract events array (newest first, max 50)
paymentStreamCloser → Horizon streaming closer fn
eventPollInterval   → Soroban event polling timer
```

### Data Flow

```
User Action
    │
    ▼
Event Handler (main.js)
    │
    ├── Read path:  simulateTransaction() → scValToNative() → UI update
    │
    └── Write path: simulateTransaction()
                       │
                       ▼
                  assembleTransaction()   ← adds auth footprint
                       │
                       ▼
                  signTxEnvelope()        ← Freighter/Albedo signs
                       │
                       ▼
                  submitTransaction()     ← Horizon broadcast
                       │
                       ▼
                  pollContractEvents()    ← captures emitted events
```

### Key Systems

#### Toast Notification System (Section 15)
Non-blocking slide-in toast notifications for all async operation results.
- Types: `success`, `error`, `warning`, `info`
- Auto-dismiss after configurable duration
- Mobile: slides up from bottom

#### Retry with Exponential Backoff (Section 16)
```js
withRetry(fn, maxAttempts=3, baseDelayMs=500)
// Delays: 500ms → 1000ms → 2000ms
```

#### Global Error Boundary (Section 17)
Catches `unhandledrejection` and `error` events, shows toast notifications. Filters user-cancelled wallet actions.

#### Contract Event Streaming (Section 18)
```
pollContractEvents() runs every 5 seconds:
  1. getLatestLedger() → get current ledger sequence
  2. getEvents({ startLedger, contractIds: [CONTRACT_ID] })
  3. Deduplicate by event ID
  4. scValToNative() → human-readable values
  5. Render to event feed + show toast
```

#### Skeleton Loading States (Section 19)
The `setCounterSkeleton(loading)` pattern applies a CSS pulse animation while fetching.

---

## CI/CD Pipeline

### CI (`ci.yml`) — Triggers on every push/PR
```yaml
jobs:
  contract-tests:  cargo test --all
  frontend-build:  npm ci && npm run build
  frontend-tests:  npm test
```

### Deploy (`deploy.yml`) — Triggers on push to `main`
```yaml
jobs:
  build:    npm run build → artifact
  deploy:   Upload dist/ to GitHub Pages
```

### Local Development
```bash
make dev              # Start Vite dev server
make test-contracts   # Run Rust unit tests
make test-frontend    # Run Vitest frontend tests
make build-contracts  # Compile WASM artifacts
```

---

## Design System

### Color Tokens
| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | `#08090c` | App background |
| `--bg-secondary` | `#12131a` | Cards, panels |
| `--bg-input` | `#0c0d12` | Input fields |
| `--color-accent` | `#3b82f6` | CTAs, links |
| `--text-primary` | `#f3f4f6` | Body text |
| `--text-secondary` | `#9ca3af` | Labels, subtitles |

### Typography
- **Headings**: Inter (variable, system fallback)
- **Monospace**: JetBrains Mono (addresses, hashes, code)

### Responsive Breakpoints
| Breakpoint | CSS | Behavior |
|---|---|---|
| Desktop | >860px | 2-column grid |
| Tablet | ≤768px | 1-column, stacked forms, touch targets |
| Mobile | ≤480px | Condensed header, toasts from bottom |
| Tiny | ≤320px | Vertical header layout |

---

## Security Considerations

- **Secret keys never touch the frontend** — all signing is delegated to Freighter/Albedo
- **Input validation** on all Stellar addresses using `StrKey.isValidEd25519PublicKey()`
- **Testnet only** — no mainnet transactions possible by default
- **No sensitive data in localStorage** — only wallet address and watchlist

---

## Deployment

See [deploy.sh](./contract/deploy.sh) and [deploy-config.json](./contract/deploy-config.json).

```bash
# Deploy contracts
STELLAR_SECRET=S... ./contract/deploy.sh

# Deploy frontend (GitHub Actions handles this automatically on push to main)
npm run build
# Upload dist/ to your hosting provider
```
