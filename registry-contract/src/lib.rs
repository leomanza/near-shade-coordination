use near_sdk::{
    env, near, require,
    store::IterableMap,
    AccountId, BorshStorageKey, NearToken, PanicOnDefault,
};

const DEFAULT_MIN_DEPOSIT: NearToken = NearToken::from_millinear(100); // 0.1 NEAR

#[derive(BorshStorageKey)]
#[near]
pub enum StorageKey {
    Coordinators,
    Workers,
}

/// A registered coordinator on the ShadeBoard platform
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct CoordinatorEntry {
    pub coordinator_id: String,
    pub owner: AccountId,
    pub contract_id: Option<AccountId>,
    pub phala_cvm_id: Option<String>,
    pub ensue_configured: bool,
    pub created_at: u64,
    pub active: bool,
}

/// A registered worker agent on the ShadeBoard platform
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct WorkerEntry {
    pub worker_id: String,
    pub owner: AccountId,
    pub coordinator_id: Option<String>,
    pub phala_cvm_id: Option<String>,
    pub nova_group_id: Option<String>,
    pub created_at: u64,
    pub active: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RegistryContract {
    pub admin: AccountId,
    pub coordinators: IterableMap<String, CoordinatorEntry>,
    pub workers: IterableMap<String, WorkerEntry>,
    pub next_worker_id: u64,
    pub min_deposit: NearToken,
}

#[near]
impl RegistryContract {
    #[init]
    #[private]
    pub fn new(admin: AccountId) -> Self {
        Self {
            admin,
            coordinators: IterableMap::new(StorageKey::Coordinators),
            workers: IterableMap::new(StorageKey::Workers),
            next_worker_id: 0,
            min_deposit: DEFAULT_MIN_DEPOSIT,
        }
    }

    /// Migrate from old state (no min_deposit field) to new state
    #[init(ignore_state)]
    #[private]
    pub fn migrate(admin: AccountId) -> Self {
        Self {
            admin,
            coordinators: IterableMap::new(StorageKey::Coordinators),
            workers: IterableMap::new(StorageKey::Workers),
            next_worker_id: 0,
            min_deposit: DEFAULT_MIN_DEPOSIT,
        }
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

    /// Get the current minimum deposit
    pub fn get_min_deposit(&self) -> String {
        self.min_deposit.as_yoctonear().to_string()
    }

    // ========== COORDINATOR REGISTRATION ==========

    /// Register a new coordinator. Requires minimum deposit.
    #[payable]
    pub fn register_coordinator(&mut self, name: String) -> CoordinatorEntry {
        let deposit = env::attached_deposit();
        require!(
            deposit >= self.min_deposit,
            format!("Minimum deposit is {}, got {}", self.min_deposit, deposit)
        );
        require!(name.len() >= 2 && name.len() <= 64, "Name must be 2-64 characters");
        require!(
            !self.coordinators.contains_key(&name),
            "Coordinator name already taken"
        );

        let entry = CoordinatorEntry {
            coordinator_id: name.clone(),
            owner: env::predecessor_account_id(),
            contract_id: None,
            phala_cvm_id: None,
            ensue_configured: false,
            created_at: env::block_timestamp(),
            active: true,
        };

        self.coordinators.insert(name.clone(), entry.clone());
        env::log_str(&format!("Registered coordinator: {}", name));
        entry
    }

    /// Update coordinator deployment info (only owner)
    pub fn update_coordinator(
        &mut self,
        name: String,
        contract_id: Option<AccountId>,
        phala_cvm_id: Option<String>,
        ensue_configured: Option<bool>,
    ) {
        let entry = self.coordinators.get_mut(&name).expect("Coordinator not found");
        require!(
            env::predecessor_account_id() == entry.owner || env::predecessor_account_id() == self.admin,
            "Only owner or admin can update"
        );

        if let Some(cid) = contract_id {
            entry.contract_id = Some(cid);
        }
        if let Some(pid) = phala_cvm_id {
            entry.phala_cvm_id = Some(pid);
        }
        if let Some(ec) = ensue_configured {
            entry.ensue_configured = ec;
        }
    }

    /// Deactivate a coordinator (owner or admin)
    pub fn deactivate_coordinator(&mut self, name: String) {
        let entry = self.coordinators.get_mut(&name).expect("Coordinator not found");
        require!(
            env::predecessor_account_id() == entry.owner || env::predecessor_account_id() == self.admin,
            "Only owner or admin"
        );
        entry.active = false;
    }

    // ========== WORKER REGISTRATION ==========

    /// Register a new worker. Requires minimum deposit.
    #[payable]
    pub fn register_worker(
        &mut self,
        name: String,
        coordinator_id: Option<String>,
    ) -> WorkerEntry {
        let deposit = env::attached_deposit();
        require!(
            deposit >= self.min_deposit,
            format!("Minimum deposit is {}, got {}", self.min_deposit, deposit)
        );
        require!(name.len() >= 2 && name.len() <= 64, "Name must be 2-64 characters");

        // Generate unique worker ID
        self.next_worker_id += 1;
        let worker_id = format!("{}-{}", name, self.next_worker_id);

        require!(
            !self.workers.contains_key(&worker_id),
            "Worker ID collision"
        );

        // Validate coordinator exists if specified
        if let Some(ref cid) = coordinator_id {
            let coord = self.coordinators.get(cid);
            require!(
                coord.is_some() && coord.unwrap().active,
                "Coordinator not found or not active"
            );
        }

        let entry = WorkerEntry {
            worker_id: worker_id.clone(),
            owner: env::predecessor_account_id(),
            coordinator_id,
            phala_cvm_id: None,
            nova_group_id: None,
            created_at: env::block_timestamp(),
            active: true,
        };

        self.workers.insert(worker_id.clone(), entry.clone());
        env::log_str(&format!("Registered worker: {}", worker_id));
        entry
    }

    /// Update worker deployment info (only owner)
    pub fn update_worker(
        &mut self,
        worker_id: String,
        phala_cvm_id: Option<String>,
        nova_group_id: Option<String>,
        coordinator_id: Option<String>,
    ) {
        let entry = self.workers.get_mut(&worker_id).expect("Worker not found");
        require!(
            env::predecessor_account_id() == entry.owner || env::predecessor_account_id() == self.admin,
            "Only owner or admin can update"
        );

        if let Some(pid) = phala_cvm_id {
            entry.phala_cvm_id = Some(pid);
        }
        if let Some(ngid) = nova_group_id {
            entry.nova_group_id = Some(ngid);
        }
        if let Some(cid) = coordinator_id {
            entry.coordinator_id = Some(cid);
        }
    }

    /// Deactivate a worker (owner or admin)
    pub fn deactivate_worker(&mut self, worker_id: String) {
        let entry = self.workers.get_mut(&worker_id).expect("Worker not found");
        require!(
            env::predecessor_account_id() == entry.owner || env::predecessor_account_id() == self.admin,
            "Only owner or admin"
        );
        entry.active = false;
    }

    // ========== VIEW FUNCTIONS ==========

    pub fn get_coordinator(&self, name: String) -> Option<CoordinatorEntry> {
        self.coordinators.get(&name).cloned()
    }

    pub fn list_coordinators(&self) -> Vec<CoordinatorEntry> {
        self.coordinators.values().cloned().collect()
    }

    pub fn list_active_coordinators(&self) -> Vec<CoordinatorEntry> {
        self.coordinators.values().filter(|c| c.active).cloned().collect()
    }

    pub fn get_worker(&self, worker_id: String) -> Option<WorkerEntry> {
        self.workers.get(&worker_id).cloned()
    }

    pub fn list_workers(&self) -> Vec<WorkerEntry> {
        self.workers.values().cloned().collect()
    }

    pub fn list_active_workers(&self) -> Vec<WorkerEntry> {
        self.workers.values().filter(|w| w.active).cloned().collect()
    }

    pub fn list_workers_by_coordinator(&self, coordinator_id: String) -> Vec<WorkerEntry> {
        self.workers
            .values()
            .filter(|w| w.active && w.coordinator_id.as_deref() == Some(&coordinator_id))
            .cloned()
            .collect()
    }

    pub fn get_admin(&self) -> AccountId {
        self.admin.clone()
    }

    pub fn get_stats(&self) -> serde_json::Value {
        let active_coords = self.coordinators.values().filter(|c| c.active).count();
        let active_workers = self.workers.values().filter(|w| w.active).count();
        serde_json::json!({
            "total_coordinators": self.coordinators.len(),
            "active_coordinators": active_coords,
            "total_workers": self.workers.len(),
            "active_workers": active_workers,
        })
    }
}

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
            .attached_deposit(NearToken::from_near(1));
        builder
    }

    #[test]
    fn test_init() {
        let context = get_context(accounts(0));
        testing_env!(context.build());
        let contract = RegistryContract::new(accounts(0));
        assert_eq!(contract.get_admin(), accounts(0));
        assert_eq!(contract.list_coordinators().len(), 0);
        assert_eq!(contract.list_workers().len(), 0);
    }

    #[test]
    fn test_register_coordinator() {
        let context = get_context(accounts(0));
        testing_env!(context.build());
        let mut contract = RegistryContract::new(accounts(0));

        let entry = contract.register_coordinator("my-dao".to_string());
        assert_eq!(entry.coordinator_id, "my-dao");
        assert_eq!(entry.owner, accounts(0));
        assert!(entry.active);
        assert_eq!(contract.list_coordinators().len(), 1);
    }

    #[test]
    fn test_register_worker() {
        let context = get_context(accounts(0));
        testing_env!(context.build());
        let mut contract = RegistryContract::new(accounts(0));

        let entry = contract.register_worker("voter-alice".to_string(), None);
        assert_eq!(entry.worker_id, "voter-alice-1");
        assert_eq!(entry.owner, accounts(0));
        assert!(entry.active);
        assert_eq!(contract.list_workers().len(), 1);
    }

    #[test]
    fn test_register_worker_with_coordinator() {
        let context = get_context(accounts(0));
        testing_env!(context.build());
        let mut contract = RegistryContract::new(accounts(0));

        contract.register_coordinator("my-dao".to_string());
        let worker = contract.register_worker("voter".to_string(), Some("my-dao".to_string()));
        assert_eq!(worker.coordinator_id, Some("my-dao".to_string()));

        let by_coord = contract.list_workers_by_coordinator("my-dao".to_string());
        assert_eq!(by_coord.len(), 1);
    }

    #[test]
    #[should_panic(expected = "Minimum deposit")]
    fn test_register_coordinator_low_deposit() {
        let mut builder = VMContextBuilder::new();
        builder
            .predecessor_account_id(accounts(0))
            .signer_account_id(accounts(0))
            .attached_deposit(NearToken::from_millinear(1)); // 0.001 NEAR < 0.01 min
        testing_env!(builder.build());
        let mut contract = RegistryContract::new(accounts(0));
        contract.register_coordinator("test".to_string());
    }

    #[test]
    fn test_deactivate() {
        let context = get_context(accounts(0));
        testing_env!(context.build());
        let mut contract = RegistryContract::new(accounts(0));

        contract.register_coordinator("dao".to_string());
        assert_eq!(contract.list_active_coordinators().len(), 1);

        contract.deactivate_coordinator("dao".to_string());
        assert_eq!(contract.list_active_coordinators().len(), 0);
        assert_eq!(contract.list_coordinators().len(), 1);
    }
}
