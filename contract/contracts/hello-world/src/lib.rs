#![no_std]
use soroban_sdk::{contract, contractimpl, vec, Env, String, Vec, symbol_short};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn hello(env: Env, to: String) -> Vec<String> {
        vec![&env, String::from_str(&env, "Hello"), to]
    }

    pub fn increment(env: Env) -> u32 {
        let key = symbol_short!("COUNTER");
        let mut count: u32 = env.storage().instance().get(&key).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&key, &count);
        
        // Emit event: topic is ("counter", "increment"), data is the new count
        env.events().publish(
            (symbol_short!("counter"), symbol_short!("increment")),
            count
        );
        
        count
    }

    pub fn get_count(env: Env) -> u32 {
        let key = symbol_short!("COUNTER");
        env.storage().instance().get(&key).unwrap_or(0)
    }
}

mod test;

