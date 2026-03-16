/*!
Coordinator Factory Contract
============================
Deploys sovereign coordinator contract instances via the NEAR factory pattern.
Each new coordinator gets their own sub-account with the coordinator contract
WASM deployed and initialized with the calling wallet as owner.

Sub-account naming: `{prefix}.{factory_account_id}`
e.g. calling create_coordinator("alice-dao", ...) on coord-factory.agents-coordinator.testnet
     creates alice-dao.coord-factory.agents-coordinator.testnet

The coordinator contract WASM is embedded at compile time from the coordinator-contract build.
To update the embedded WASM, rebuild coordinator-contract first, then rebuild this factory.
*/

use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use serde_json::json;
use std::str::FromStr;

// Coordinator contract WASM embedded at compile time.
// Rebuild coordinator-contract before rebuilding factory to pick up changes.
const COORDINATOR_WASM: &[u8] =
    include_bytes!("../../coordinator-contract/target/near/coordinator_contract.wasm");

/// Gas for calling `new` on the newly deployed coordinator contract.
const INIT_GAS: Gas = Gas::from_tgas(10);

/// Minimum deposit required to create a coordinator account.
/// Covers: new account balance (1 NEAR) + coordinator contract storage (~1.5 NEAR) + buffer.
const MIN_DEPOSIT: NearToken = NearToken::from_near(3);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CoordinatorFactory {}

#[near]
impl CoordinatorFactory {
    #[init]
    pub fn new() -> Self {
        Self {}
    }

    /// Deploy a new coordinator contract instance.
    ///
    /// - Creates sub-account `{prefix}.{current_account_id}`
    /// - Deploys coordinator contract WASM to it
    /// - Calls `new(owner: caller)` to initialize with caller as owner
    /// - Attached deposit funds the new account (minimum 3 NEAR)
    ///
    /// Returns a Promise that resolves to the new coordinator's AccountId.
    #[payable]
    pub fn create_coordinator(
        &mut self,
        prefix: AccountId,      // e.g. "alice-dao" → alice-dao.coord-factory.agents-coordinator.testnet
        min_workers: u8,
        max_workers: u8,
    ) -> Promise {
        // Validate prefix: must be a valid sub-account prefix
        let factory_id = env::current_account_id();
        let new_account_id = AccountId::from_str(
            &format!("{}.{}", prefix, factory_id)
        ).unwrap_or_else(|_| env::panic_str("Invalid prefix: cannot form valid account ID"));

        // Enforce minimum deposit
        let deposit = env::attached_deposit();
        assert!(
            deposit >= MIN_DEPOSIT,
            "Minimum deposit is {} NEAR, got {} NEAR",
            MIN_DEPOSIT.as_near(),
            deposit.as_near()
        );

        // Validate min/max workers
        assert!(min_workers >= 1, "min_workers must be >= 1");
        assert!(max_workers >= min_workers, "max_workers must be >= min_workers");

        let owner = env::predecessor_account_id();

        // Build the init args for coordinator-contract's `new(owner: AccountId)`
        let init_args = json!({ "owner": owner }).to_string().into_bytes();

        Promise::new(new_account_id)
            .create_account()
            .transfer(deposit)
            .deploy_contract(COORDINATOR_WASM.to_vec())
            .function_call("new".to_string(), init_args, NearToken::from_yoctonear(0), INIT_GAS)
    }

    /// View: get the coordinator WASM hash (sha256 hex) embedded in this factory.
    /// Useful for verifying which coordinator version the factory deploys.
    pub fn get_wasm_hash(&self) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        // Simple fingerprint — not cryptographic, just for display
        let mut hasher = DefaultHasher::new();
        COORDINATOR_WASM.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    /// View: minimum deposit required (in yoctoNEAR as string).
    pub fn get_min_deposit(&self) -> String {
        MIN_DEPOSIT.as_yoctonear().to_string()
    }
}
