use hex::encode;
use near_sdk::{
    env, near, require,
    store::{IterableMap, IterableSet},
    AccountId, BorshStorageKey, CryptoHash, Gas, GasWeight, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};
use serde_json::json;
use sha2::{Digest, Sha256};

// Gas constants (following verifiable-ai-dao/contract/src/dao.rs)
const RETURN_RESULT_GAS: Gas = Gas::from_tgas(50);
const FAIL_ON_TIMEOUT_GAS: Gas = Gas::from_tgas(10);
const YIELD_REGISTER: u64 = 0;

#[derive(BorshStorageKey)]
#[near]
pub enum StorageKey {
    ApprovedCodehashes,
    CoordinatorByAccountId,
    PendingCoordinations,
    FinalizedCoordinations,
}

/// Worker/coordinator registration information
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Worker {
    pub checksum: String,
    pub codehash: String,
}

/// Coordination request stored while yielded
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct CoordinationRequest {
    pub yield_id: CryptoHash,
    pub task_config: String,
    pub config_hash: String,
    pub timestamp: u64,
    pub requester: AccountId,
}

/// Main contract state
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CoordinatorContract {
    pub owner: AccountId,
    pub approved_codehashes: IterableSet<String>,
    pub coordinator_by_account_id: IterableMap<AccountId, Worker>,
    pub current_proposal_id: u64,
    pub pending_coordinations: IterableMap<u64, CoordinationRequest>,
    pub finalized_coordinations: IterableMap<u64, String>,
}

#[near]
impl CoordinatorContract {
    /// Initialize the contract
    #[init]
    #[private]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            approved_codehashes: IterableSet::new(StorageKey::ApprovedCodehashes),
            coordinator_by_account_id: IterableMap::new(StorageKey::CoordinatorByAccountId),
            current_proposal_id: 0,
            pending_coordinations: IterableMap::new(StorageKey::PendingCoordinations),
            finalized_coordinations: IterableMap::new(StorageKey::FinalizedCoordinations),
        }
    }

    /// Start a new coordination task
    /// Creates a yielded promise that will be resumed by the coordinator agent
    /// Following verifiable-ai-dao/contract/src/dao.rs create_proposal pattern
    pub fn start_coordination(&mut self, task_config: String) -> u64 {
        require!(
            task_config.len() <= 10000,
            "Task config needs to be under 10,000 characters"
        );

        self.current_proposal_id += 1;
        let proposal_id = self.current_proposal_id;
        let requester = env::predecessor_account_id();
        let timestamp = env::block_timestamp();
        let config_hash = hash(&task_config);

        // Create yielded promise with callback
        // Note: we do NOT promise_return this - the caller gets proposal_id immediately
        // The yield runs in the background and resolves when coordinator_resume is called
        let _yielded_promise = env::promise_yield_create(
            "return_coordination_result",
            &json!({
                "proposal_id": proposal_id,
                "task_config": task_config,
            })
            .to_string()
            .into_bytes(),
            RETURN_RESULT_GAS,
            GasWeight::default(),
            YIELD_REGISTER,
        );

        // Read the yield id from the register
        let yield_id: CryptoHash = env::read_register(YIELD_REGISTER)
            .expect("read_register failed")
            .try_into()
            .expect("conversion to CryptoHash failed");

        // Store pending coordination with yield_id
        let request = CoordinationRequest {
            yield_id,
            task_config,
            config_hash: config_hash.clone(),
            timestamp,
            requester,
        };
        self.pending_coordinations.insert(proposal_id, request);

        env::log_str(&format!(
            "Created coordination #{} with config_hash: {}",
            proposal_id, config_hash
        ));

        // Return proposal_id immediately (yield resolves in background)
        proposal_id
    }

    /// Resume a coordination task with aggregated results
    /// Called by the coordinator agent after all workers complete
    pub fn coordinator_resume(
        &mut self,
        proposal_id: u64,
        aggregated_result: String,
        config_hash: String,
        result_hash: String,
    ) {
        self.require_approved_codehash();

        let request = self
            .pending_coordinations
            .get(&proposal_id)
            .expect("No pending coordination with this ID");

        // Validate config hash (prevents config tampering during execution)
        require!(
            request.config_hash == config_hash,
            "Config hash mismatch - configuration was tampered with"
        );

        // Validate result hash
        let computed_hash = hash(&aggregated_result);
        require!(
            computed_hash == result_hash,
            "Result hash mismatch - result integrity check failed"
        );

        env::log_str(&format!(
            "Coordinator resuming proposal #{} with result (length: {})",
            proposal_id,
            aggregated_result.len()
        ));

        // Resume the yielded promise with the aggregated result
        env::promise_yield_resume(
            &request.yield_id,
            &serde_json::to_vec(&aggregated_result).unwrap(),
        );
    }

    /// Callback function when coordination yield is resumed
    /// Following verifiable-ai-dao/contract/src/dao.rs return_external_response pattern
    #[private]
    pub fn return_coordination_result(
        &mut self,
        proposal_id: u64,
        task_config: String,
        #[callback_result] response: Result<String, PromiseError>,
    ) -> PromiseOrValue<String> {
        let _ = task_config; // unused but needed for JSON deserialization matching
        self.pending_coordinations.remove(&proposal_id);

        match response {
            Ok(result) => {
                env::log_str(&format!(
                    "Coordination #{} completed successfully. Result stored.",
                    proposal_id
                ));

                self.finalized_coordinations.insert(proposal_id, result.clone());

                PromiseOrValue::Value(result)
            }
            Err(_) => {
                env::log_str(&format!(
                    "Coordination #{} failed or timed out",
                    proposal_id
                ));

                let promise = Promise::new(env::current_account_id()).function_call(
                    "fail_on_timeout".to_string(),
                    vec![],
                    NearToken::from_near(0),
                    FAIL_ON_TIMEOUT_GAS,
                );
                PromiseOrValue::Promise(promise.as_return())
            }
        }
    }

    /// Called on timeout to produce a failed receipt
    #[private]
    pub fn fail_on_timeout(&self) {
        env::panic_str("Coordination request timed out");
    }

    // ========== VIEW FUNCTIONS ==========

    /// Get all pending coordinations (for coordinator agent polling)
    pub fn get_pending_coordinations(
        &self,
        from_index: &Option<u64>,
        limit: &Option<u64>,
    ) -> Vec<(u64, CoordinationRequest)> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(self.pending_coordinations.len() as u64);

        self.pending_coordinations
            .iter()
            .filter(|(id, _)| **id >= from)
            .take(limit as usize)
            .map(|(id, request)| (*id, request.clone()))
            .collect()
    }

    /// Get a specific finalized coordination result
    pub fn get_finalized_coordination(&self, proposal_id: u64) -> Option<String> {
        self.finalized_coordinations.get(&proposal_id).cloned()
    }

    /// Get all finalized coordinations
    pub fn get_all_finalized_coordinations(
        &self,
        from_index: &Option<u64>,
        limit: &Option<u64>,
    ) -> Vec<(u64, String)> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(self.finalized_coordinations.len() as u64);

        self.finalized_coordinations
            .iter()
            .filter(|(id, _)| **id >= from)
            .take(limit as usize)
            .map(|(id, result)| (*id, result.clone()))
            .collect()
    }

    /// Get contract owner
    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    /// Get current proposal ID counter
    pub fn get_current_proposal_id(&self) -> u64 {
        self.current_proposal_id
    }

    // ========== OWNER FUNCTIONS ==========

    /// Approve a Docker image codehash
    pub fn approve_codehash(&mut self, codehash: String) {
        self.require_owner();
        self.approved_codehashes.insert(codehash.clone());
        env::log_str(&format!("Approved codehash: {}", codehash));
    }

    /// Register a coordinator agent
    /// For MVP on testnet: accepts checksum, uses placeholder codehash verification
    /// In production: would verify DCAP TEE attestation quote
    pub fn register_coordinator(&mut self, checksum: String, codehash: String) {
        self.require_owner();

        let caller = env::predecessor_account_id();

        require!(
            self.approved_codehashes.contains(&codehash),
            "Codehash not approved. Owner must approve_codehash first."
        );

        let worker = Worker {
            checksum: checksum.clone(),
            codehash: codehash.clone(),
        };

        self.coordinator_by_account_id.insert(caller.clone(), worker);

        env::log_str(&format!(
            "Coordinator {} registered with codehash: {}",
            caller, codehash
        ));
    }

    /// Remove a codehash approval
    pub fn remove_codehash(&mut self, codehash: String) {
        self.require_owner();
        self.approved_codehashes.remove(&codehash);
        env::log_str(&format!("Removed codehash: {}", codehash));
    }

    /// Check if codehash is approved
    pub fn is_codehash_approved(&self, codehash: String) -> bool {
        self.approved_codehashes.contains(&codehash)
    }

    /// Remove a stale pending coordination (e.g. after failed yield timeout)
    pub fn clear_pending_coordination(&mut self, proposal_id: u64) {
        self.require_owner();
        self.pending_coordinations.remove(&proposal_id);
        env::log_str(&format!("Cleared stale pending coordination #{}", proposal_id));
    }

    /// Transfer contract ownership
    pub fn transfer_ownership(&mut self, new_owner: AccountId) {
        self.require_owner();
        self.owner = new_owner.clone();
        env::log_str(&format!("Ownership transferred to: {}", new_owner));
    }

    // ========== INTERNAL FUNCTIONS ==========

    fn require_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            format!(
                "Only owner can call this function. Owner: {}, Caller: {}",
                self.owner,
                env::predecessor_account_id()
            )
        );
    }

    fn require_approved_codehash(&self) {
        let caller = env::predecessor_account_id();
        let worker = self
            .coordinator_by_account_id
            .get(&caller)
            .expect(&format!(
                "Only registered coordinator can call this function. Caller: {}",
                caller
            ));
        require!(
            self.approved_codehashes.contains(&worker.codehash),
            "Coordinator codehash is no longer approved"
        );
    }
}

fn hash(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    encode(hasher.finalize())
}

// ========== TESTS ==========

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn get_context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor)
            .attached_deposit(NearToken::from_near(0));
        builder
    }

    #[test]
    fn test_initialization() {
        let context = get_context(accounts(0));
        testing_env!(context.build());

        let contract = CoordinatorContract::new(accounts(0));
        assert_eq!(contract.get_owner(), accounts(0));
        assert_eq!(contract.get_current_proposal_id(), 0);
    }

    #[test]
    fn test_approve_codehash() {
        let context = get_context(accounts(0));
        testing_env!(context.build());

        let mut contract = CoordinatorContract::new(accounts(0));
        contract.approve_codehash("test_codehash".to_string());

        assert!(contract.is_codehash_approved("test_codehash".to_string()));
    }

    #[test]
    #[should_panic(expected = "Only owner can call this function")]
    fn test_non_owner_cannot_approve_codehash() {
        let context = get_context(accounts(0));
        testing_env!(context.build());

        let mut contract = CoordinatorContract::new(accounts(0));

        testing_env!(get_context(accounts(1)).build());
        contract.approve_codehash("test_codehash".to_string());
    }

    #[test]
    fn test_hash_string() {
        let data = "test data";
        let result = hash(data);
        assert_eq!(result.len(), 64); // SHA256 produces 64 hex characters
    }
}
