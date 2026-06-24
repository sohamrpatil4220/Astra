# ASTRA — Stellar Testnet Wallet Dashboard

> A **production-ready** Stellar Testnet wallet dashboard with advanced Soroban smart contracts, real-time event streaming, CI/CD pipeline, and a fully mobile-responsive glassmorphism UI.

[![CI](https://github.com/sohamrpatil4220/Astra/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sohamrpatil4220/Astra/actions)

---

## Features

### Advanced Smart Contracts (Soroban / Rust)
- **hello-world contract** — 8 functions: `hello`, `increment`, `get_count`, `batch_increment`, `store_message`, `get_message`, `list_messages`, `reset`
- **escrow contract** — demonstrates **inter-contract communication** (cross-contract calls via `env.invoke_contract`)
- **Persistent storage** — contract state survives ledger epochs via `instance` storage
- **Contract Events** — every write function emits a typed event

### Real-Time Event Streaming
- `pollContractEvents()` uses the Soroban RPC `getEvents` API, polling every 5 seconds
- Events decoded via `scValToNative()` and displayed with ledger numbers and topic badges
- Toast notifications on every new event

### Smart Contract Deployment Workflow
- [`deploy.sh`](./contract/deploy.sh) — end-to-end build + deploy script with error handling
- [`deploy-config.json`](./contract/deploy-config.json) — testnet/mainnet RPC configuration
- [`Makefile`](./Makefile) — `make deploy-hello-world`, `make deploy-escrow`

### CI/CD Pipeline (GitHub Actions)
- **CI** — Runs on every push/PR: Rust `cargo test`, frontend Vitest tests, and `npm run build`
- **Deploy** — Pushes to `main` trigger automatic deployment to GitHub Pages

### Frontend: Error Handling & Loading States
- **Toast system** — slide-in notifications (`success`, `error`, `warning`, `info`) with auto-dismiss
- **Skeleton loading** — animated pulse while fetching contract state
- **Global error boundary** — catches `unhandledrejection` / `error` events, filters user-cancelled wallet actions
- **Retry with exponential backoff** — `withRetry(fn, maxAttempts, baseDelayMs)`

### Mobile-Responsive Design
- 4 breakpoints: 860px (1-col grid), 768px (touch targets, table → cards), 480px (condensed), 320px (minimal)
- Touch-friendly tap targets (44×44px minimum per WCAG 2.1)
- Toasts slide from bottom on mobile

### Testing
- **22 Rust unit tests** covering all contract functions, storage, events, and edge cases
- **30 Vitest frontend tests** covering address validation, retry logic, event parsing, split calculations, localStorage
- All tests run in CI

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite 8, Vanilla JS (ES Modules), Vanilla CSS |
| Smart Contracts | Soroban SDK 25.x, Rust, WASM |
| Wallet | Freighter Extension, Albedo Web Wallet |
| Blockchain APIs | Horizon Testnet, Soroban RPC |
| CI/CD | GitHub Actions |
| Testing | Rust built-in tests, Vitest + jsdom |
| Charting | Chart.js |

---

## Getting Started

### Prerequisites
- Node.js 18+
- Rust + `cargo` (for contracts)
- Stellar CLI (for deployment)
- Freighter or Albedo wallet

### Frontend Development

```bash
npm install
npm run dev         # Start Vite dev server at http://localhost:5173
npm test            # Run Vitest frontend tests
```

### Contract Development

```bash
# Run all Rust unit tests
make test-contracts

# Build WASM artifacts
make build-contracts

# Deploy to testnet (requires Stellar CLI + secret key)
STELLAR_SECRET=S... make deploy-hello-world
STELLAR_SECRET=S... HELLO_WORLD_CONTRACT=C... make deploy-escrow
```

### All Commands

```bash
make help           # Show all available commands
make dev            # Start Vite dev server
make build          # Build production bundle
make test-frontend  # Run Vitest tests
make test-contracts # Run Rust tests
make lint-contracts # Run cargo clippy + fmt check
make clean          # Remove build artifacts
```

---

## Project Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for full system design documentation, including:
- Data flow diagrams
- Contract function reference
- Frontend state management
- CI/CD pipeline details
- Design system tokens
- Security considerations

---

## Smart Contract Portal

The **Contracts** tab in the dashboard provides:
1. **Counter State** — read `get_count()` in real time, call `increment()` or `batch_increment(N)`
2. **Hello Greeting** — invoke `hello(to)` and see the return value
3. **Persistent Storage** — `store_message(key, value)` and `get_message(key)` 
4. **Live Event Feed** — real-time display of all contract events since last poll

---

## Wallet Support

| Feature | Freighter | Albedo |
|---|---|---|
| Connect | ✅ | ✅ |
| Sign XLM transfer | ✅ | ✅ |
| Sign Soroban tx | ✅ | ✅ |
| Multi-op split | ✅ | ✅ |
| Trustline | ✅ | ✅ |

---

## License

MIT © 2025 ASTRA
