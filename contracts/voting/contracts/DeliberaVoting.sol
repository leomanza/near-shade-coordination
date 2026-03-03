// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title DeliberaVoting — FHE Blind Voting for DAO Governance
/// @notice Votes are encrypted as euint32 and accumulated via FHE.add().
///         No plaintext vote is ever visible on-chain.
///         Only the authorized TEE can finalize and publish the aggregate result.
contract DeliberaVoting is ZamaEthereumConfig {
    struct Proposal {
        string description;
        uint256 deadline;
        euint32 encryptedApproved;
        euint32 encryptedRejected;
        uint32 voteCount;
        bool finalized;
        uint32 resultApproved;
        uint32 resultRejected;
    }

    address public owner;
    address public teeAddress;
    uint256 public proposalCount;

    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    event ProposalCreated(uint256 indexed proposalId, string description, uint256 deadline);
    event VoteCast(uint256 indexed proposalId, address indexed voter);
    event ProposalFinalized(uint256 indexed proposalId);
    event ResultPublished(uint256 indexed proposalId, uint32 approved, uint32 rejected, string decision);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyTEE() {
        require(msg.sender == teeAddress, "Only TEE");
        _;
    }

    constructor(address _teeAddress) {
        owner = msg.sender;
        teeAddress = _teeAddress;
    }

    /// @notice Create a new proposal for blind voting
    /// @param description The proposal text
    /// @param duration Voting duration in seconds
    /// @return proposalId The ID of the created proposal
    function createProposal(
        string calldata description,
        uint256 duration
    ) external onlyOwner returns (uint256 proposalId) {
        proposalId = proposalCount++;
        Proposal storage p = _proposals[proposalId];
        p.description = description;
        p.deadline = block.timestamp + duration;

        emit ProposalCreated(proposalId, description, p.deadline);
    }

    /// @notice Cast an encrypted vote (0 = Rejected, 1 = Approved)
    /// @param proposalId The proposal to vote on
    /// @param encryptedVote Encrypted euint32 input (0 or 1)
    /// @param inputProof Proof for the encrypted input
    function castVote(
        uint256 proposalId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        Proposal storage p = _proposals[proposalId];
        require(p.deadline > 0, "Proposal does not exist");
        require(block.timestamp <= p.deadline, "Voting closed");
        require(!_hasVoted[proposalId][msg.sender], "Already voted");
        require(!p.finalized, "Already finalized");

        _hasVoted[proposalId][msg.sender] = true;

        euint32 vote = FHE.fromExternal(encryptedVote, inputProof);

        // vote=1 means Approved, vote=0 means Rejected
        // Accumulate approved count
        p.encryptedApproved = FHE.add(p.encryptedApproved, vote);
        FHE.allowThis(p.encryptedApproved);
        FHE.allow(p.encryptedApproved, owner);
        FHE.allow(p.encryptedApproved, teeAddress);

        // Accumulate rejected: rejected += (1 - vote)
        euint32 one = FHE.asEuint32(1);
        euint32 rejected = FHE.sub(one, vote);
        p.encryptedRejected = FHE.add(p.encryptedRejected, rejected);
        FHE.allowThis(p.encryptedRejected);
        FHE.allow(p.encryptedRejected, owner);
        FHE.allow(p.encryptedRejected, teeAddress);

        p.voteCount++;

        emit VoteCast(proposalId, msg.sender);
    }

    /// @notice Finalize voting — marks proposal as finalized. Only TEE can call.
    /// @dev In production, the TEE retrieves the Lit threshold key,
    ///      decrypts the aggregate locally, then calls publishResult().
    /// @param proposalId The proposal to finalize
    function finalize(uint256 proposalId) external onlyTEE {
        Proposal storage p = _proposals[proposalId];
        require(p.deadline > 0, "Proposal does not exist");
        require(block.timestamp > p.deadline, "Voting still open");
        require(!p.finalized, "Already finalized");

        p.finalized = true;

        emit ProposalFinalized(proposalId);
    }

    /// @notice Publish the decrypted result. Only TEE can call after finalization.
    /// @param proposalId The proposal
    /// @param approved Decrypted approved vote count
    /// @param rejected Decrypted rejected vote count
    function publishResult(
        uint256 proposalId,
        uint32 approved,
        uint32 rejected
    ) external onlyTEE {
        Proposal storage p = _proposals[proposalId];
        require(p.finalized, "Not finalized");
        require(p.resultApproved == 0 && p.resultRejected == 0, "Result already published");

        p.resultApproved = approved;
        p.resultRejected = rejected;

        string memory decision = approved >= rejected ? "Approved" : "Rejected";

        emit ResultPublished(proposalId, approved, rejected, decision);
    }

    /// @notice Get proposal metadata (public info only, no encrypted data)
    function getProposal(uint256 proposalId)
        external
        view
        returns (
            string memory description,
            uint256 deadline,
            uint32 voteCount,
            bool finalized,
            uint32 resultApproved,
            uint32 resultRejected
        )
    {
        Proposal storage p = _proposals[proposalId];
        return (
            p.description,
            p.deadline,
            p.voteCount,
            p.finalized,
            p.resultApproved,
            p.resultRejected
        );
    }

    /// @notice Get the encrypted approved tally (only accessible to allowed addresses)
    function getEncryptedApproved(uint256 proposalId) external view returns (euint32) {
        return _proposals[proposalId].encryptedApproved;
    }

    /// @notice Get the encrypted rejected tally (only accessible to allowed addresses)
    function getEncryptedRejected(uint256 proposalId) external view returns (euint32) {
        return _proposals[proposalId].encryptedRejected;
    }

    /// @notice Check if an address has voted on a proposal
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return _hasVoted[proposalId][voter];
    }

    /// @notice Update the TEE address (owner only, for key rotation)
    function setTeeAddress(address _teeAddress) external onlyOwner {
        teeAddress = _teeAddress;
    }
}
