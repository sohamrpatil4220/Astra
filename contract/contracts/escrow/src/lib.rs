//! # Escrow Smart Contract
//!
//! Demonstrates inter-contract communication on Stellar/Soroban by calling
//! into the `HelloWorldContract` counter for every deposit action.
//!
//! ## Flow
//! 1. Admin calls `initialize(counter_contract_id)` to register the counter.
//! 2. Any address calls `deposit(depositor, amount_xlm_stroops)` to lock funds
//!    into escrow. This internally calls `counter.increment()` to track deposits.
//! 3. Admin calls `release(recipient)` to transfer locked funds.
//! 4. Anyone can query `get_deposit_count()` which cross-calls `counter.get_count()`.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, IntoVal, Symbol,
};

// ─────────────────────────────────────────────────────────────────────────────
// Storage Keys
// ─────────────────────────────────────────────────────────────────────────────
const COUNTER_ADDR: Symbol = symbol_short!("CNTRADDR");
const ADMIN_KEY:    Symbol = symbol_short!("ADMIN");
const BALANCE_KEY:  Symbol = symbol_short!("BALANCE");
const DEPOSITOR_KEY: Symbol = symbol_short!("DEPOSITOR");

// ─────────────────────────────────────────────────────────────────────────────
// Custom Types
// ─────────────────────────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowInfo {
    pub admin:           Address,
    pub counter_contract: Address,
    pub balance_stroops: i128,
    pub deposit_count:   u32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────
#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // ── initialize ────────────────────────────────────────────────────────────
    /// Sets up the escrow with an admin address and the counter contract ID.
    /// Must be called once before any deposits.
    pub fn initialize(env: Env, admin: Address, counter_contract: Address) {
        // Prevent re-initialization
        if env.storage().instance().has(&ADMIN_KEY) {
            panic!("Escrow already initialized");
        }

        admin.require_auth();

        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&COUNTER_ADDR, &counter_contract);
        env.storage().instance().set(&BALANCE_KEY, &0i128);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("init")),
            admin,
        );
    }

    // ── deposit ───────────────────────────────────────────────────────────────
    /// Locks `amount_stroops` into escrow and calls `counter.increment()`.
    /// This demonstrates cross-contract invocation.
    pub fn deposit(env: Env, depositor: Address, amount_stroops: i128) -> u32 {
        depositor.require_auth();

        if amount_stroops <= 0 {
            panic!("Deposit amount must be positive");
        }

        // Accumulate balance
        let current: i128 = env
            .storage()
            .instance()
            .get(&BALANCE_KEY)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&BALANCE_KEY, &(current + amount_stroops));

        // Store last depositor
        env.storage().instance().set(&DEPOSITOR_KEY, &depositor);

        // ── Inter-contract call: counter.increment() ──────────────────────────
        let counter_id: Address = env
            .storage()
            .instance()
            .get(&COUNTER_ADDR)
            .expect("Counter contract not set — call initialize() first");

        let new_count: u32 = env
            .invoke_contract(&counter_id, &symbol_short!("increment"), soroban_sdk::vec![&env]);

        // Emit escrow deposit event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposit")),
            amount_stroops,
        );

        new_count
    }

    // ── release ───────────────────────────────────────────────────────────────
    /// Admin releases the full escrowed balance to a recipient.
    /// Emits a `release` event with the amount transferred.
    pub fn release(env: Env, recipient: Address) -> i128 {
        // Only admin can release
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .expect("Not initialized");
        admin.require_auth();

        let balance: i128 = env
            .storage()
            .instance()
            .get(&BALANCE_KEY)
            .unwrap_or(0);

        if balance == 0 {
            panic!("No funds in escrow");
        }

        // Zero out balance
        env.storage().instance().set(&BALANCE_KEY, &0i128);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("release")),
            (recipient, balance),
        );

        balance
    }

    // ── get_balance ───────────────────────────────────────────────────────────
    /// Returns the currently locked balance in stroops.
    pub fn get_balance(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&BALANCE_KEY)
            .unwrap_or(0)
    }

    // ── get_deposit_count ─────────────────────────────────────────────────────
    /// Cross-calls `counter.get_count()` on the registered counter contract
    /// and returns the total number of deposits tracked.
    pub fn get_deposit_count(env: Env) -> u32 {
        let counter_id: Address = env
            .storage()
            .instance()
            .get(&COUNTER_ADDR)
            .expect("Counter contract not set — call initialize() first");

        let count: u32 = env.invoke_contract(
            &counter_id,
            &symbol_short!("get_count"),
            soroban_sdk::vec![&env],
        );

        count
    }

    // ── get_info ──────────────────────────────────────────────────────────────
    /// Returns a summary struct with admin, counter contract, balance, and count.
    pub fn get_info(env: Env) -> EscrowInfo {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .expect("Not initialized");
        let counter_contract: Address = env
            .storage()
            .instance()
            .get(&COUNTER_ADDR)
            .expect("Not initialized");
        let balance_stroops: i128 = env
            .storage()
            .instance()
            .get(&BALANCE_KEY)
            .unwrap_or(0);
        let deposit_count: u32 = env.invoke_contract(
            &counter_contract,
            &symbol_short!("get_count"),
            soroban_sdk::vec![&env],
        );

        EscrowInfo {
            admin,
            counter_contract,
            balance_stroops,
            deposit_count,
        }
    }
}

mod test;
