#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

// We import the hello-world contract WASM to register it as a dependency
// for cross-contract invocation tests.
mod hello_world {
    soroban_sdk::contractimport!(
        file = "../../target/wasm32-unknown-unknown/release/hello_world.wasm"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Test setup helper
// ─────────────────────────────────────────────────────────────────────────────
struct TestSetup {
    env:            Env,
    escrow_client:  EscrowContractClient<'static>,
    hello_id:       Address,
    admin:          Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    // Register the hello-world (counter) contract
    let hello_id = env.register(hello_world::WASM, ());

    // Register the escrow contract
    let escrow_id = env.register(EscrowContract, ());
    let escrow_client = EscrowContractClient::new(&env, &escrow_id);

    let admin = Address::generate(&env);

    // Initialize escrow with admin + counter contract
    escrow_client.initialize(&admin, &hello_id);

    TestSetup {
        env,
        escrow_client,
        hello_id,
        admin,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: initialize
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_initialize_sets_balance_zero() {
    let t = setup();
    assert_eq!(t.escrow_client.get_balance(), 0);
}

#[test]
#[should_panic(expected = "Escrow already initialized")]
fn test_initialize_panics_on_reinit() {
    let t = setup();
    let other = Address::generate(&t.env);
    // Second initialize should panic
    t.escrow_client.initialize(&other, &t.hello_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: deposit — balance accumulation + cross-contract counter increment
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_deposit_accumulates_balance() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &1_000_000);
    assert_eq!(t.escrow_client.get_balance(), 1_000_000);
}

#[test]
fn test_deposit_increments_counter_cross_contract() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    let count_after = t.escrow_client.deposit(&depositor, &500_000);
    // Counter was at 0, deposit calls increment() → should now be 1
    assert_eq!(count_after, 1);
}

#[test]
fn test_multiple_deposits_accumulate() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &100);
    t.escrow_client.deposit(&depositor, &200);
    t.escrow_client.deposit(&depositor, &300);
    assert_eq!(t.escrow_client.get_balance(), 600);
}

#[test]
fn test_multiple_deposits_counter_reflects_count() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &1);
    t.escrow_client.deposit(&depositor, &1);
    // get_deposit_count cross-calls get_count() on hello-world
    assert_eq!(t.escrow_client.get_deposit_count(), 2);
}

#[test]
#[should_panic(expected = "Deposit amount must be positive")]
fn test_deposit_rejects_zero_amount() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &0);
}

#[test]
#[should_panic(expected = "Deposit amount must be positive")]
fn test_deposit_rejects_negative_amount() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &-100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: release — balance transfer and zeroing
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_release_returns_correct_amount() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    let recipient = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &5_000_000);
    let released = t.escrow_client.release(&recipient);
    assert_eq!(released, 5_000_000);
}

#[test]
fn test_release_zeros_balance() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    let recipient = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &1_000);
    t.escrow_client.release(&recipient);
    assert_eq!(t.escrow_client.get_balance(), 0);
}

#[test]
#[should_panic(expected = "No funds in escrow")]
fn test_release_panics_with_empty_balance() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.escrow_client.release(&recipient);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: get_deposit_count — cross-contract query
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_get_deposit_count_initial_zero() {
    let t = setup();
    assert_eq!(t.escrow_client.get_deposit_count(), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: get_info — summary struct
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn test_get_info_fields() {
    let t = setup();
    let depositor = Address::generate(&t.env);
    t.escrow_client.deposit(&depositor, &250_000);

    let info = t.escrow_client.get_info();
    assert_eq!(info.admin, t.admin);
    assert_eq!(info.counter_contract, t.hello_id);
    assert_eq!(info.balance_stroops, 250_000);
    assert_eq!(info.deposit_count, 1);
}
