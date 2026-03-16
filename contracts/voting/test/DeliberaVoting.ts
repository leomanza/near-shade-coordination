import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { DeliberaVoting, DeliberaVoting__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  tee: HardhatEthersSigner;
  voter1: HardhatEthersSigner;
  voter2: HardhatEthersSigner;
  voter3: HardhatEthersSigner;
};

async function deployFixture(teeAddress: string) {
  const factory = (await ethers.getContractFactory(
    "DeliberaVoting",
  )) as DeliberaVoting__factory;
  const contract = (await factory.deploy(teeAddress)) as DeliberaVoting;
  const contractAddress = await contract.getAddress();
  return { contract, contractAddress };
}

describe("DeliberaVoting", function () {
  let signers: Signers;
  let contract: DeliberaVoting;
  let contractAddress: string;

  before(async function () {
    const s = await ethers.getSigners();
    signers = {
      deployer: s[0],
      tee: s[1],
      voter1: s[2],
      voter2: s[3],
      voter3: s[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite requires fhEVM mock environment");
      this.skip();
    }
    ({ contract, contractAddress } = await deployFixture(
      signers.tee.address,
    ));
  });

  describe("Proposal creation", function () {
    it("should create a proposal", async function () {
      const tx = await contract.createProposal("Fund developer education", 3600);
      await tx.wait();

      const [description, deadline, voteCount, finalized] =
        await contract.getProposal(0);
      expect(description).to.equal("Fund developer education");
      expect(voteCount).to.equal(0);
      expect(finalized).to.be.false;
    });

    it("should only allow owner to create proposals", async function () {
      await expect(
        contract.connect(signers.voter1).createProposal("Test", 3600),
      ).to.be.revertedWith("Only owner");
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      // Create a proposal with 1 hour duration
      const tx = await contract.createProposal("Fund developer education", 3600);
      await tx.wait();
    });

    it("should cast an encrypted vote", async function () {
      // voter1 votes Approved (1)
      const encryptedVote = await fhevm
        .createEncryptedInput(contractAddress, signers.voter1.address)
        .add32(1) // 1 = Approved
        .encrypt();

      const tx = await contract
        .connect(signers.voter1)
        .castVote(0, encryptedVote.handles[0], encryptedVote.inputProof);
      await tx.wait();

      const [, , voteCount] = await contract.getProposal(0);
      expect(voteCount).to.equal(1);
      expect(await contract.hasVoted(0, signers.voter1.address)).to.be.true;
    });

    it("should prevent double voting", async function () {
      const encryptedVote = await fhevm
        .createEncryptedInput(contractAddress, signers.voter1.address)
        .add32(1)
        .encrypt();

      const tx = await contract
        .connect(signers.voter1)
        .castVote(0, encryptedVote.handles[0], encryptedVote.inputProof);
      await tx.wait();

      // Try to vote again
      const encryptedVote2 = await fhevm
        .createEncryptedInput(contractAddress, signers.voter1.address)
        .add32(0)
        .encrypt();

      await expect(
        contract
          .connect(signers.voter1)
          .castVote(0, encryptedVote2.handles[0], encryptedVote2.inputProof),
      ).to.be.revertedWith("Already voted");
    });

    it("should cast 3 encrypted votes and verify tally increments", async function () {
      // voter1 votes Approved (1)
      const enc1 = await fhevm
        .createEncryptedInput(contractAddress, signers.voter1.address)
        .add32(1)
        .encrypt();
      let tx = await contract
        .connect(signers.voter1)
        .castVote(0, enc1.handles[0], enc1.inputProof);
      await tx.wait();

      // voter2 votes Rejected (0)
      const enc2 = await fhevm
        .createEncryptedInput(contractAddress, signers.voter2.address)
        .add32(0)
        .encrypt();
      tx = await contract
        .connect(signers.voter2)
        .castVote(0, enc2.handles[0], enc2.inputProof);
      await tx.wait();

      // voter3 votes Approved (1)
      const enc3 = await fhevm
        .createEncryptedInput(contractAddress, signers.voter3.address)
        .add32(1)
        .encrypt();
      tx = await contract
        .connect(signers.voter3)
        .castVote(0, enc3.handles[0], enc3.inputProof);
      await tx.wait();

      // Verify vote count
      const [, , voteCount] = await contract.getProposal(0);
      expect(voteCount).to.equal(3);

      // Decrypt encrypted tallies and verify: 2 approved, 1 rejected
      const encApproved = await contract.getEncryptedApproved(0);
      const encRejected = await contract.getEncryptedRejected(0);

      // Encrypted tallies should not be zero (votes were cast)
      expect(encApproved).to.not.equal(ethers.ZeroHash);
      expect(encRejected).to.not.equal(ethers.ZeroHash);

      // Decrypt using deployer (owner) who has FHE.allow access
      const clearApproved = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encApproved,
        contractAddress,
        signers.deployer,
      );
      const clearRejected = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        encRejected,
        contractAddress,
        signers.deployer,
      );

      expect(clearApproved).to.equal(2); // voter1 + voter3
      expect(clearRejected).to.equal(1); // voter2
    });
  });

  describe("Finalization", function () {
    beforeEach(async function () {
      // Create proposal with very short duration (1 second)
      const tx = await contract.createProposal("Short proposal", 1);
      await tx.wait();

      // Cast a vote
      const enc = await fhevm
        .createEncryptedInput(contractAddress, signers.voter1.address)
        .add32(1)
        .encrypt();
      const voteTx = await contract
        .connect(signers.voter1)
        .castVote(0, enc.handles[0], enc.inputProof);
      await voteTx.wait();

      // Mine a block to advance past deadline
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);
    });

    it("should allow TEE to finalize after deadline", async function () {
      const tx = await contract.connect(signers.tee).finalize(0);
      await tx.wait();

      const [, , , finalized] = await contract.getProposal(0);
      expect(finalized).to.be.true;
    });

    it("should reject finalization from non-TEE", async function () {
      await expect(
        contract.connect(signers.voter1).finalize(0),
      ).to.be.revertedWith("Only TEE");
    });

    it("should allow TEE to publish result after finalization", async function () {
      // Finalize
      let tx = await contract.connect(signers.tee).finalize(0);
      await tx.wait();

      // Publish result: 1 approved, 0 rejected
      tx = await contract.connect(signers.tee).publishResult(0, 1, 0);
      const receipt = await tx.wait();

      const [, , , , resultApproved, resultRejected] =
        await contract.getProposal(0);
      expect(resultApproved).to.equal(1);
      expect(resultRejected).to.equal(0);
    });

    it("should reject publishResult before finalization", async function () {
      // Try to publish without finalizing first
      // Need a fresh proposal that hasn't been finalized
      const tx2 = await contract.createProposal("Another proposal", 1);
      await tx2.wait();
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        contract.connect(signers.tee).publishResult(1, 0, 0),
      ).to.be.revertedWith("Not finalized");
    });
  });

  describe("Full end-to-end flow", function () {
    it("should complete a full voting cycle: create, vote x3, finalize, publish", async function () {
      // 1. Create proposal with enough time for all votes
      let tx = await contract.createProposal(
        "Fund AI agent research",
        3600,
      );
      await tx.wait();

      // 2. Cast 3 votes: 2 Approved, 1 Rejected
      const enc1 = await fhevm
        .createEncryptedInput(contractAddress, signers.voter1.address)
        .add32(1) // Approved
        .encrypt();
      tx = await contract
        .connect(signers.voter1)
        .castVote(0, enc1.handles[0], enc1.inputProof);
      await tx.wait();

      const enc2 = await fhevm
        .createEncryptedInput(contractAddress, signers.voter2.address)
        .add32(0) // Rejected
        .encrypt();
      tx = await contract
        .connect(signers.voter2)
        .castVote(0, enc2.handles[0], enc2.inputProof);
      await tx.wait();

      const enc3 = await fhevm
        .createEncryptedInput(contractAddress, signers.voter3.address)
        .add32(1) // Approved
        .encrypt();
      tx = await contract
        .connect(signers.voter3)
        .castVote(0, enc3.handles[0], enc3.inputProof);
      await tx.wait();

      // 3. Advance past deadline
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      // 4. TEE finalizes
      tx = await contract.connect(signers.tee).finalize(0);
      await tx.wait();

      // 5. TEE decrypts and publishes result
      // In production, TEE would decrypt encryptedApproved/encryptedRejected
      // using Lit threshold keys. Here we simulate with known values.
      tx = await contract.connect(signers.tee).publishResult(0, 2, 1);
      await tx.wait();

      // 6. Verify final state
      const [desc, , voteCount, finalized, approved, rejected] =
        await contract.getProposal(0);
      expect(desc).to.equal("Fund AI agent research");
      expect(voteCount).to.equal(3);
      expect(finalized).to.be.true;
      expect(approved).to.equal(2);
      expect(rejected).to.equal(1);
    });
  });
});
