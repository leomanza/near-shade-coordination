use near_sdk::{
    env, near, require,
    store::IterableMap,
    AccountId, BorshStorageKey, NearToken, PanicOnDefault,
};

const DEFAULT_MIN_DEPOSIT: NearToken = NearToken::from_millinear(100); // 0.1 NEAR

#[derive(BorshStorageKey)]
#[near]
pub enum StorageKey {
    _DeprecatedCoordinators, // ordinal 0 — V1 format (dead)
    _DeprecatedWorkers,      // ordinal 1 — V1 format (dead)
    _DeprecatedCoordinatorsV2, // ordinal 2 — V2 format (dead)
    _DeprecatedWorkersV2,    // ordinal 3 — V2 format (dead)
    WorkersByDid,            // ordinal 4 — V3 primary index
    CoordinatorsByDid,       // ordinal 5 — V3 primary index
}

/// A registered worker agent, keyed by `worker_did`
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct WorkerRecord {
    pub account_id: AccountId,
    pub coordinator_did: String,
    pub worker_did: String,
    pub endpoint_url: String,
    pub cvm_id: String,
    pub registered_at: u64,
    pub is_active: bool,
}

/// A registered coordinator, keyed by `coordinator_did`
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct CoordinatorRecord {
    pub account_id: AccountId,
    pub coordinator_did: String,
    pub endpoint_url: String,
    pub cvm_id: String,
    pub min_workers: u8,
    pub max_workers: u8,
    pub registered_at: u64,
    pub is_active: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RegistryContract {
    pub admin: AccountId,
    pub workers_by_did: IterableMap<String, WorkerRecord>,
    pub coordinators_by_did: IterableMap<String, CoordinatorRecord>,
    pub min_deposit: NearToken,
    pub next_worker_seq: u64,
}

#[near]
impl RegistryContract {
    #[init]
    #[private]
    pub fn new(admin: AccountId) -> Self {
        Self {
            admin,
            workers_by_did: IterableMap::new(StorageKey::WorkersByDid),
            coordinators_by_did: IterableMap::new(StorageKey::CoordinatorsByDid),
            min_deposit: DEFAULT_MIN_DEPOSIT,
            next_worker_seq: 0,
        }
    }

    /// Re-initialize from scratch, discarding any stale state.
    /// Use when deploying a new schema after previous state is incompatible.
    /// All previous coordinator/worker records will be cleared (use only when no live data).
    #[init(ignore_state)]
    #[private]
    pub fn force_reinitialize(admin: AccountId) -> Self {
        Self {
            admin,
            workers_by_did: IterableMap::new(StorageKey::WorkersByDid),
            coordinators_by_did: IterableMap::new(StorageKey::CoordinatorsByDid),
            min_deposit: DEFAULT_MIN_DEPOSIT,
            next_worker_seq: 0,
        }
    }

    // ========== COORDINATOR REGISTRATION ==========

    /// Register or update a coordinator. Requires minimum deposit.
    #[payable]
    pub fn register_coordinator(
        &mut self,
        coordinator_did: String,
        endpoint_url: String,
        cvm_id: String,
        min_workers: u8,
        max_workers: u8,
    ) -> CoordinatorRecord {
        let deposit = env::attached_deposit();
        require!(
            deposit >= self.min_deposit,
            format!("Minimum deposit is {}, got {}", self.min_deposit, deposit)
        );
        require!(
            coordinator_did.starts_with("did:"),
            "coordinator_did must start with 'did:'"
        );
        require!(
            min_workers <= max_workers,
            "min_workers must be <= max_workers"
        );
        require!(max_workers > 0, "max_workers must be > 0");

        let caller = env::predecessor_account_id();

        // Upsert: update existing or insert new
        if let Some(existing) = self.coordinators_by_did.get(&coordinator_did) {
            require!(
                caller == existing.account_id || caller == self.admin,
                "Only the original registrant or admin can update"
            );
        }

        let record = CoordinatorRecord {
            account_id: caller,
            coordinator_did: coordinator_did.clone(),
            endpoint_url,
            cvm_id,
            min_workers,
            max_workers,
            registered_at: env::block_timestamp(),
            is_active: true,
        };

        self.coordinators_by_did
            .insert(coordinator_did.clone(), record.clone());
        env::log_str(&format!("Registered coordinator: {}", coordinator_did));
        record
    }

    // ========== WORKER REGISTRATION ==========

    /// Register or update a worker. Requires minimum deposit.
    /// The referenced coordinator_did must exist and be active.
    #[payable]
    pub fn register_worker(
        &mut self,
        coordinator_did: String,
        worker_did: String,
        endpoint_url: String,
        cvm_id: String,
    ) -> WorkerRecord {
        let deposit = env::attached_deposit();
        require!(
            deposit >= self.min_deposit,
            format!("Minimum deposit is {}, got {}", self.min_deposit, deposit)
        );
        require!(
            coordinator_did.starts_with("did:"),
            "coordinator_did must start with 'did:'"
        );
        require!(
            worker_did.starts_with("did:"),
            "worker_did must start with 'did:'"
        );

        // Validate coordinator exists and is active
        let coordinator = self
            .coordinators_by_did
            .get(&coordinator_did)
            .expect("Coordinator not found");
        require!(
            coordinator.is_active,
            "Coordinator is not active"
        );

        let caller = env::predecessor_account_id();

        // Upsert: update existing or insert new
        if let Some(existing) = self.workers_by_did.get(&worker_did) {
            require!(
                caller == existing.account_id || caller == self.admin,
                "Only the original registrant or admin can update"
            );
        }

        let record = WorkerRecord {
            account_id: caller,
            coordinator_did,
            worker_did: worker_did.clone(),
            endpoint_url,
            cvm_id,
            registered_at: env::block_timestamp(),
            is_active: true,
        };

        self.workers_by_did
            .insert(worker_did.clone(), record.clone());
        env::log_str(&format!("Registered worker: {}", worker_did));
        record
    }

    // ========== MUTATORS ==========

    /// Update a worker's endpoint URL (only the worker's account_id or admin)
    pub fn update_worker_endpoint(&mut self, worker_did: String, endpoint_url: String) {
        let entry = self
            .workers_by_did
            .get_mut(&worker_did)
            .expect("Worker not found");
        let caller = env::predecessor_account_id();
        require!(
            caller == entry.account_id || caller == self.admin,
            "Only worker owner or admin can update endpoint"
        );
        entry.endpoint_url = endpoint_url;
        env::log_str(&format!("Updated endpoint for worker: {}", worker_did));
    }

    /// Deactivate a worker (only the worker's account_id or admin)
    pub fn deactivate_worker(&mut self, worker_did: String) {
        let entry = self
            .workers_by_did
            .get_mut(&worker_did)
            .expect("Worker not found");
        let caller = env::predecessor_account_id();
        require!(
            caller == entry.account_id || caller == self.admin,
            "Only worker owner or admin can deactivate"
        );
        entry.is_active = false;
        env::log_str(&format!("Deactivated worker: {}", worker_did));
    }

    /// Deactivate a coordinator (only the coordinator's account_id or admin)
    pub fn deactivate_coordinator(&mut self, coordinator_did: String) {
        let entry = self
            .coordinators_by_did
            .get_mut(&coordinator_did)
            .expect("Coordinator not found");
        let caller = env::predecessor_account_id();
        require!(
            caller == entry.account_id || caller == self.admin,
            "Only coordinator owner or admin can deactivate"
        );
        entry.is_active = false;
        env::log_str(&format!("Deactivated coordinator: {}", coordinator_did));
    }

    // ========== ADMIN ==========

    /// Set the minimum deposit required to register (admin only)
    pub fn set_min_deposit(&mut self, amount_yocto: String) {
        require!(
            env::predecessor_account_id() == self.admin,
            "Only admin can set min deposit"
        );
        let yocto: u128 = amount_yocto.parse().expect("Invalid yocto amount");
        self.min_deposit = NearToken::from_yoctonear(yocto);
        env::log_str(&format!("Min deposit set to {}", self.min_deposit));
    }

    // ========== VIEW FUNCTIONS ==========

    /// Get all active workers belonging to a specific coordinator
    pub fn get_workers_for_coordinator(&self, coordinator_did: String) -> Vec<WorkerRecord> {
        self.workers_by_did
            .values()
            .filter(|w| w.is_active && w.coordinator_did == coordinator_did)
            .cloned()
            .collect()
    }

    /// Look up a single worker by DID
    pub fn get_worker_by_did(&self, worker_did: String) -> Option<WorkerRecord> {
        self.workers_by_did.get(&worker_did).cloned()
    }

    /// Look up a single coordinator by DID
    pub fn get_coordinator_by_did(&self, coordinator_did: String) -> Option<CoordinatorRecord> {
        self.coordinators_by_did.get(&coordinator_did).cloned()
    }

    /// List all active workers
    pub fn list_active_workers(&self) -> Vec<WorkerRecord> {
        self.workers_by_did
            .values()
            .filter(|w| w.is_active)
            .cloned()
            .collect()
    }

    /// List all active coordinators
    pub fn list_active_coordinators(&self) -> Vec<CoordinatorRecord> {
        self.coordinators_by_did
            .values()
            .filter(|c| c.is_active)
            .cloned()
            .collect()
    }

    /// Get registry statistics
    pub fn get_stats(&self) -> serde_json::Value {
        let active_coords = self
            .coordinators_by_did
            .values()
            .filter(|c| c.is_active)
            .count();
        let active_workers = self
            .workers_by_did
            .values()
            .filter(|w| w.is_active)
            .count();
        serde_json::json!({
            "total_coordinators": self.coordinators_by_did.len(),
            "active_coordinators": active_coords,
            "total_workers": self.workers_by_did.len(),
            "active_workers": active_workers,
        })
    }

    /// Get the admin account
    pub fn get_admin(&self) -> AccountId {
        self.admin.clone()
    }

    /// Get the current minimum deposit (as yoctoNEAR string)
    pub fn get_min_deposit(&self) -> String {
        self.min_deposit.as_yoctonear().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const COORD_DID: &str = "did:key:z6MkCoordinator1";
    const WORKER_DID: &str = "did:key:z6MkWorker1";
    const WORKER_DID_2: &str = "did:key:z6MkWorker2";

    fn get_context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor)
            .attached_deposit(NearToken::from_near(1));
        builder
    }

    fn setup_contract() -> RegistryContract {
        let context = get_context(accounts(0));
        testing_env!(context.build());
        RegistryContract::new(accounts(0))
    }

    fn register_test_coordinator(contract: &mut RegistryContract) -> CoordinatorRecord {
        contract.register_coordinator(
            COORD_DID.to_string(),
            "https://coord.example.com".to_string(),
            "cvm-coord-1".to_string(),
            1,
            5,
        )
    }

    fn register_test_worker(contract: &mut RegistryContract) -> WorkerRecord {
        contract.register_worker(
            COORD_DID.to_string(),
            WORKER_DID.to_string(),
            "https://worker1.example.com".to_string(),
            "cvm-worker-1".to_string(),
        )
    }

    // ========== INIT ==========

    #[test]
    fn test_init() {
        let contract = setup_contract();
        assert_eq!(contract.get_admin(), accounts(0));
        assert_eq!(contract.list_active_coordinators().len(), 0);
        assert_eq!(contract.list_active_workers().len(), 0);
        assert_eq!(
            contract.get_min_deposit(),
            NearToken::from_millinear(100).as_yoctonear().to_string()
        );
    }

    // ========== COORDINATOR REGISTRATION ==========

    #[test]
    fn test_register_coordinator_success() {
        let mut contract = setup_contract();
        let record = register_test_coordinator(&mut contract);

        assert_eq!(record.coordinator_did, COORD_DID);
        assert_eq!(record.account_id, accounts(0));
        assert_eq!(record.endpoint_url, "https://coord.example.com");
        assert_eq!(record.cvm_id, "cvm-coord-1");
        assert_eq!(record.min_workers, 1);
        assert_eq!(record.max_workers, 5);
        assert!(record.is_active);
        assert_eq!(contract.list_active_coordinators().len(), 1);
    }

    #[test]
    #[should_panic(expected = "Minimum deposit")]
    fn test_register_coordinator_low_deposit() {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(0))
            .signer_account_id(accounts(0))
            .attached_deposit(NearToken::from_millinear(1)); // 0.001 NEAR < 0.1 min
        testing_env!(builder.build());
        let mut contract = RegistryContract::new(accounts(0));
        contract.register_coordinator(
            COORD_DID.to_string(),
            "https://coord.example.com".to_string(),
            "cvm-1".to_string(),
            1,
            3,
        );
    }

    #[test]
    #[should_panic(expected = "coordinator_did must start with 'did:'")]
    fn test_register_coordinator_invalid_did() {
        let mut contract = setup_contract();
        contract.register_coordinator(
            "not-a-did".to_string(),
            "https://coord.example.com".to_string(),
            "cvm-1".to_string(),
            1,
            3,
        );
    }

    #[test]
    fn test_register_coordinator_upsert() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);

        // Re-register same DID with updated endpoint
        let updated = contract.register_coordinator(
            COORD_DID.to_string(),
            "https://new-coord.example.com".to_string(),
            "cvm-coord-2".to_string(),
            2,
            10,
        );
        assert_eq!(updated.endpoint_url, "https://new-coord.example.com");
        assert_eq!(updated.max_workers, 10);
        // Should still be 1 coordinator, not 2
        assert_eq!(contract.list_active_coordinators().len(), 1);
    }

    // ========== WORKER REGISTRATION ==========

    #[test]
    fn test_register_worker_success() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        let record = register_test_worker(&mut contract);

        assert_eq!(record.worker_did, WORKER_DID);
        assert_eq!(record.coordinator_did, COORD_DID);
        assert_eq!(record.account_id, accounts(0));
        assert_eq!(record.endpoint_url, "https://worker1.example.com");
        assert_eq!(record.cvm_id, "cvm-worker-1");
        assert!(record.is_active);
        assert_eq!(contract.list_active_workers().len(), 1);
    }

    #[test]
    #[should_panic(expected = "Minimum deposit")]
    fn test_register_worker_low_deposit() {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(0))
            .signer_account_id(accounts(0))
            .attached_deposit(NearToken::from_near(1));
        testing_env!(builder.build());
        let mut contract = RegistryContract::new(accounts(0));
        contract.register_coordinator(
            COORD_DID.to_string(),
            "https://coord.example.com".to_string(),
            "cvm-1".to_string(),
            1,
            3,
        );

        // Now set low deposit for worker registration
        let mut builder2 = VMContextBuilder::new();
        builder2
            .predecessor_account_id(accounts(0))
            .signer_account_id(accounts(0))
            .attached_deposit(NearToken::from_millinear(1));
        testing_env!(builder2.build());

        contract.register_worker(
            COORD_DID.to_string(),
            WORKER_DID.to_string(),
            "https://worker.example.com".to_string(),
            "cvm-w-1".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Coordinator not found")]
    fn test_register_worker_nonexistent_coordinator() {
        let mut contract = setup_contract();
        contract.register_worker(
            "did:key:z6MkNonexistent".to_string(),
            WORKER_DID.to_string(),
            "https://worker.example.com".to_string(),
            "cvm-w-1".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Coordinator is not active")]
    fn test_register_worker_inactive_coordinator() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        contract.deactivate_coordinator(COORD_DID.to_string());
        contract.register_worker(
            COORD_DID.to_string(),
            WORKER_DID.to_string(),
            "https://worker.example.com".to_string(),
            "cvm-w-1".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "worker_did must start with 'did:'")]
    fn test_register_worker_invalid_did() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        contract.register_worker(
            COORD_DID.to_string(),
            "not-a-did".to_string(),
            "https://worker.example.com".to_string(),
            "cvm-w-1".to_string(),
        );
    }

    #[test]
    fn test_register_worker_upsert() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        // Re-register same worker DID with updated endpoint
        let updated = contract.register_worker(
            COORD_DID.to_string(),
            WORKER_DID.to_string(),
            "https://new-worker.example.com".to_string(),
            "cvm-worker-updated".to_string(),
        );
        assert_eq!(updated.endpoint_url, "https://new-worker.example.com");
        assert_eq!(contract.list_active_workers().len(), 1);
    }

    // ========== VIEW: get_workers_for_coordinator ==========

    #[test]
    fn test_get_workers_for_coordinator() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        // Register a second worker under same coordinator
        contract.register_worker(
            COORD_DID.to_string(),
            WORKER_DID_2.to_string(),
            "https://worker2.example.com".to_string(),
            "cvm-worker-2".to_string(),
        );

        let workers = contract.get_workers_for_coordinator(COORD_DID.to_string());
        assert_eq!(workers.len(), 2);

        // Deactivate one, should only return 1
        contract.deactivate_worker(WORKER_DID.to_string());
        let workers = contract.get_workers_for_coordinator(COORD_DID.to_string());
        assert_eq!(workers.len(), 1);
        assert_eq!(workers[0].worker_did, WORKER_DID_2);
    }

    #[test]
    fn test_get_workers_for_coordinator_empty() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        let workers = contract.get_workers_for_coordinator(COORD_DID.to_string());
        assert_eq!(workers.len(), 0);
    }

    // ========== VIEW: get_worker_by_did ==========

    #[test]
    fn test_get_worker_by_did_found() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        let worker = contract.get_worker_by_did(WORKER_DID.to_string());
        assert!(worker.is_some());
        assert_eq!(worker.unwrap().worker_did, WORKER_DID);
    }

    #[test]
    fn test_get_worker_by_did_not_found() {
        let contract = setup_contract();
        let worker = contract.get_worker_by_did("did:key:z6MkNonexistent".to_string());
        assert!(worker.is_none());
    }

    // ========== DEACTIVATE WORKER ==========

    #[test]
    fn test_deactivate_worker() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        assert_eq!(contract.list_active_workers().len(), 1);
        contract.deactivate_worker(WORKER_DID.to_string());
        assert_eq!(contract.list_active_workers().len(), 0);

        // Worker still exists, just inactive
        let worker = contract.get_worker_by_did(WORKER_DID.to_string());
        assert!(worker.is_some());
        assert!(!worker.unwrap().is_active);
    }

    #[test]
    #[should_panic(expected = "Only worker owner or admin can deactivate")]
    fn test_deactivate_worker_unauthorized() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        // Switch to a different caller
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1));
        testing_env!(builder.build());

        contract.deactivate_worker(WORKER_DID.to_string());
    }

    // ========== UPDATE WORKER ENDPOINT ==========

    #[test]
    fn test_update_worker_endpoint() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        contract.update_worker_endpoint(
            WORKER_DID.to_string(),
            "https://updated-endpoint.example.com".to_string(),
        );

        let worker = contract.get_worker_by_did(WORKER_DID.to_string()).unwrap();
        assert_eq!(worker.endpoint_url, "https://updated-endpoint.example.com");
    }

    #[test]
    #[should_panic(expected = "Only worker owner or admin can update endpoint")]
    fn test_update_worker_endpoint_unauthorized() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1));
        testing_env!(builder.build());

        contract.update_worker_endpoint(
            WORKER_DID.to_string(),
            "https://hacker.example.com".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "Worker not found")]
    fn test_update_worker_endpoint_not_found() {
        let mut contract = setup_contract();
        contract.update_worker_endpoint(
            "did:key:z6MkNonexistent".to_string(),
            "https://example.com".to_string(),
        );
    }

    // ========== DEACTIVATE COORDINATOR ==========

    #[test]
    fn test_deactivate_coordinator() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);

        assert_eq!(contract.list_active_coordinators().len(), 1);
        contract.deactivate_coordinator(COORD_DID.to_string());
        assert_eq!(contract.list_active_coordinators().len(), 0);

        let coord = contract.get_coordinator_by_did(COORD_DID.to_string());
        assert!(coord.is_some());
        assert!(!coord.unwrap().is_active);
    }

    // ========== ADMIN ==========

    #[test]
    fn test_set_min_deposit() {
        let mut contract = setup_contract();
        let new_deposit = NearToken::from_millinear(500).as_yoctonear().to_string();
        contract.set_min_deposit(new_deposit.clone());
        assert_eq!(contract.get_min_deposit(), new_deposit);
    }

    #[test]
    #[should_panic(expected = "Only admin can set min deposit")]
    fn test_set_min_deposit_unauthorized() {
        let mut contract = setup_contract();

        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1));
        testing_env!(builder.build());

        contract.set_min_deposit("1000000000000000000000000".to_string());
    }

    // ========== STATS ==========

    #[test]
    fn test_get_stats() {
        let mut contract = setup_contract();
        register_test_coordinator(&mut contract);
        register_test_worker(&mut contract);

        let stats = contract.get_stats();
        assert_eq!(stats["total_coordinators"], 1);
        assert_eq!(stats["active_coordinators"], 1);
        assert_eq!(stats["total_workers"], 1);
        assert_eq!(stats["active_workers"], 1);

        contract.deactivate_worker(WORKER_DID.to_string());
        let stats = contract.get_stats();
        assert_eq!(stats["total_workers"], 1);
        assert_eq!(stats["active_workers"], 0);
    }
}
