#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    vec, Env, String, Symbol, Vec, Map,
};

// ─────────────────────────────────────────────────────────────────────────────
// Data Types
// ─────────────────────────────────────────────────────────────────────────────

/// Structured return type for batch increment results
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchResult {
    pub start_count: u32,
    pub end_count:   u32,
    pub steps:       u32,
}

/// Structured type for stored messages
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MessageRecord {
    pub key:   String,
    pub value: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Events (using #[contractevent] macro — avoids deprecated publish API)
// ─────────────────────────────────────────────────────────────────────────────

#[contracttype]
pub struct GreetingEvent {
    pub name: String,
}

#[contracttype]
pub struct IncrementEvent {
    pub count: u32,
}

#[contracttype]
pub struct BatchEvent {
    pub step_count: u32,
}

#[contracttype]
pub struct MessageEvent {
    pub key: String,
}

#[contracttype]
pub struct ResetEvent {
    pub new_count: u32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage Keys
// ─────────────────────────────────────────────────────────────────────────────
const COUNTER_KEY: Symbol = symbol_short!("COUNTER");
const MSG_MAP_KEY: Symbol = symbol_short!("MSGMAP");

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────
#[contract]
pub struct HelloWorldContract;

#[contractimpl]
impl HelloWorldContract {
    // ── 1. hello ──────────────────────────────────────────────────────────────
    /// Returns a greeting vector: ["Hello", <to>]
    /// Emits a greeting event with the name greeted.
    pub fn hello(env: Env, to: String) -> Vec<String> {
        env.events().publish(
            (symbol_short!("greeting"), symbol_short!("called")),
            to.clone(),
        );
        vec![&env, String::from_str(&env, "Hello"), to]
    }

    // ── 2. increment ──────────────────────────────────────────────────────────
    /// Increments the on-chain counter by 1.
    /// Emits a counter/increment event with the new count.
    pub fn increment(env: Env) -> u32 {
        let mut count: u32 = env
            .storage()
            .instance()
            .get(&COUNTER_KEY)
            .unwrap_or(0);
        count += 1;
        env.storage().instance().set(&COUNTER_KEY, &count);

        env.events().publish(
            (symbol_short!("counter"), symbol_short!("increment")),
            count,
        );
        count
    }

    // ── 3. get_count ──────────────────────────────────────────────────────────
    /// Returns the current counter value without modifying state.
    pub fn get_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&COUNTER_KEY)
            .unwrap_or(0)
    }

    // ── 4. batch_increment ────────────────────────────────────────────────────
    /// Increments the counter by `steps` in one call.
    /// Emits a batch event per step, plus a batchDone summary event.
    /// Returns a `BatchResult` struct.
    pub fn batch_increment(env: Env, steps: u32) -> BatchResult {
        let start: u32 = env
            .storage()
            .instance()
            .get(&COUNTER_KEY)
            .unwrap_or(0);

        let mut count = start;
        for _ in 0..steps {
            count += 1;
            env.events().publish(
                (symbol_short!("counter"), symbol_short!("batch")),
                count,
            );
        }

        env.storage().instance().set(&COUNTER_KEY, &count);

        env.events().publish(
            (symbol_short!("counter"), symbol_short!("batchDone")),
            steps,
        );

        BatchResult {
            start_count: start,
            end_count:   count,
            steps,
        }
    }

    // ── 5. store_message ──────────────────────────────────────────────────────
    /// Stores a key→value string pair in persistent instance storage.
    /// Emits a message/stored event.
    pub fn store_message(env: Env, key: String, value: String) {
        let mut map: Map<String, String> = env
            .storage()
            .instance()
            .get(&MSG_MAP_KEY)
            .unwrap_or(Map::new(&env));

        map.set(key.clone(), value);
        env.storage().instance().set(&MSG_MAP_KEY, &map);

        env.events().publish(
            (symbol_short!("message"), symbol_short!("stored")),
            key,
        );
    }

    // ── 6. get_message ────────────────────────────────────────────────────────
    /// Retrieves the stored value for a given key.
    /// Returns an empty String if the key does not exist.
    pub fn get_message(env: Env, key: String) -> String {
        let map: Map<String, String> = env
            .storage()
            .instance()
            .get(&MSG_MAP_KEY)
            .unwrap_or(Map::new(&env));

        map.get(key).unwrap_or(String::from_str(&env, ""))
    }

    // ── 7. list_messages ──────────────────────────────────────────────────────
    /// Returns all stored messages as a Vec of MessageRecord structs.
    pub fn list_messages(env: Env) -> Vec<MessageRecord> {
        let map: Map<String, String> = env
            .storage()
            .instance()
            .get(&MSG_MAP_KEY)
            .unwrap_or(Map::new(&env));

        let mut records: Vec<MessageRecord> = Vec::new(&env);
        for (k, v) in map.iter() {
            records.push_back(MessageRecord { key: k, value: v });
        }
        records
    }

    // ── 8. reset ──────────────────────────────────────────────────────────────
    /// Resets the counter to zero and emits a counter/reset event.
    pub fn reset(env: Env) {
        env.storage().instance().set(&COUNTER_KEY, &0u32);
        env.events().publish(
            (symbol_short!("counter"), symbol_short!("reset")),
            0u32,
        );
    }
}

mod test;
