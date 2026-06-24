#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{vec, Env, String};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: register contract and return client
// ─────────────────────────────────────────────────────────────────────────────
fn setup() -> (Env, HelloWorldContractClient<'static>) {
    let env = Env::default();
    let id = env.register(HelloWorldContract, ());
    let client = HelloWorldContractClient::new(&env, &id);
    (env, client)
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: hello() — greeting vector
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_hello_returns_greeting_vec() {
    let (env, client) = setup();
    let words = client.hello(&String::from_str(&env, "Astra"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "Astra"),
        ]
    );
}

#[test]
fn test_hello_with_empty_name() {
    let (env, client) = setup();
    let words = client.hello(&String::from_str(&env, ""));
    assert_eq!(words.len(), 2);
    assert_eq!(words.get(0).unwrap(), String::from_str(&env, "Hello"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: increment() — counter state
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_increment_starts_at_one() {
    let (_env, client) = setup();
    let result = client.increment();
    assert_eq!(result, 1);
}

#[test]
fn test_increment_accumulates() {
    let (_env, client) = setup();
    assert_eq!(client.increment(), 1);
    assert_eq!(client.increment(), 2);
    assert_eq!(client.increment(), 3);
}

#[test]
fn test_increment_returns_correct_value() {
    let (_env, client) = setup();
    for i in 1u32..=5 {
        assert_eq!(client.increment(), i);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: get_count() — read-only query
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_get_count_initial_zero() {
    let (_env, client) = setup();
    assert_eq!(client.get_count(), 0);
}

#[test]
fn test_get_count_reflects_increments() {
    let (_env, client) = setup();
    client.increment();
    client.increment();
    assert_eq!(client.get_count(), 2);
}

#[test]
fn test_get_count_does_not_mutate() {
    let (_env, client) = setup();
    client.increment();
    let count1 = client.get_count();
    let count2 = client.get_count();
    assert_eq!(count1, count2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: batch_increment() — bulk counter update
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_batch_increment_result_fields() {
    let (_env, client) = setup();
    let result = client.batch_increment(&5);
    assert_eq!(result.start_count, 0);
    assert_eq!(result.end_count, 5);
    assert_eq!(result.steps, 5);
}

#[test]
fn test_batch_increment_after_single_increment() {
    let (_env, client) = setup();
    client.increment(); // count = 1
    let result = client.batch_increment(&3);
    assert_eq!(result.start_count, 1);
    assert_eq!(result.end_count, 4);
    assert_eq!(result.steps, 3);
}

#[test]
fn test_batch_increment_zero_steps() {
    let (_env, client) = setup();
    let result = client.batch_increment(&0);
    assert_eq!(result.start_count, 0);
    assert_eq!(result.end_count, 0);
    assert_eq!(result.steps, 0);
}

#[test]
fn test_batch_increment_updates_get_count() {
    let (_env, client) = setup();
    client.batch_increment(&7);
    assert_eq!(client.get_count(), 7);
}

#[test]
fn test_batch_increment_large_steps() {
    let (_env, client) = setup();
    let result = client.batch_increment(&100);
    assert_eq!(result.end_count, 100);
    assert_eq!(result.steps, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: store_message() + get_message() — key-value persistence
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_store_and_get_message() {
    let (env, client) = setup();
    let key = String::from_str(&env, "greeting");
    let val = String::from_str(&env, "Hello Soroban!");
    client.store_message(&key, &val);
    let result = client.get_message(&key);
    assert_eq!(result, val);
}

#[test]
fn test_get_message_missing_key_returns_empty() {
    let (env, client) = setup();
    let key = String::from_str(&env, "nonexistent");
    let result = client.get_message(&key);
    assert_eq!(result, String::from_str(&env, ""));
}

#[test]
fn test_store_message_overwrites_existing() {
    let (env, client) = setup();
    let key = String::from_str(&env, "name");
    client.store_message(&key, &String::from_str(&env, "Alice"));
    client.store_message(&key, &String::from_str(&env, "Bob"));
    let result = client.get_message(&key);
    assert_eq!(result, String::from_str(&env, "Bob"));
}

#[test]
fn test_store_multiple_keys() {
    let (env, client) = setup();
    client.store_message(&String::from_str(&env, "k1"), &String::from_str(&env, "v1"));
    client.store_message(&String::from_str(&env, "k2"), &String::from_str(&env, "v2"));
    assert_eq!(
        client.get_message(&String::from_str(&env, "k1")),
        String::from_str(&env, "v1")
    );
    assert_eq!(
        client.get_message(&String::from_str(&env, "k2")),
        String::from_str(&env, "v2")
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: list_messages()
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_list_messages_empty() {
    let (_env, client) = setup();
    let records = client.list_messages();
    assert_eq!(records.len(), 0);
}

#[test]
fn test_list_messages_returns_all() {
    let (env, client) = setup();
    client.store_message(&String::from_str(&env, "a"), &String::from_str(&env, "1"));
    client.store_message(&String::from_str(&env, "b"), &String::from_str(&env, "2"));
    let records = client.list_messages();
    assert_eq!(records.len(), 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: reset() — counter reset
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_reset_sets_counter_to_zero() {
    let (_env, client) = setup();
    client.increment();
    client.increment();
    assert_eq!(client.get_count(), 2);
    client.reset();
    assert_eq!(client.get_count(), 0);
}

#[test]
fn test_increment_after_reset() {
    let (_env, client) = setup();
    client.batch_increment(&10);
    client.reset();
    let result = client.increment();
    assert_eq!(result, 1);
}

#[test]
fn test_double_reset_stays_zero() {
    let (_env, client) = setup();
    client.increment();
    client.reset();
    client.reset();
    assert_eq!(client.get_count(), 0);
}
