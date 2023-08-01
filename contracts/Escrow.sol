// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
// import "hardhat/console.sol";

import "./EscrowFactory.sol";
import "./Locker.sol";

contract Escrow is ReentrancyGuard {
    enum MilestoneState {
        Created,
        Agreed,
        Deposited,
        Requested,
        Released,
        Disputed
    }

    struct Milestone {
        address token;
        address participant;
        uint256 amount;
        uint256 timestamp;
        uint256 lockId;
        string meta;
        MilestoneState state;
    }

    /******************************* variables *******************************/
    bool private isInitialized;
    string private uri;
    address private factory;
    address private originator;

    Milestone[] private milestones;

    /*******************************  events  *******************************/
    event MilestoneCreated(
        uint256 mId,
        address indexed token,
        address indexed participant,
        uint256 amount,
        uint256 timestamp,
        string meta
    );
    event MilestoneUpdated(
        uint256 mId,
        address indexed token,
        address indexed participant,
        uint256 amount,
        uint256 timestamp,
        string meta
    );
    event MilestoneStateUpdated(uint256 mId, MilestoneState state);

    /******************************* modifiers *******************************/
    /**
     * @notice Check the milestone index
     */
    modifier onlyIndex(uint256 mId) {
        require(mId < milestones.length, "Escrow: invalid milestone index");
        _;
    }

    /**
     * @notice Only originator can call
     */
    modifier onlyOriginator() {
        require(originator == msg.sender, "Escrow: caller is not the originator");
        _;
    }

    /**
     * @notice Only participant can call
     */
    modifier onlyParticipant(uint256 mId) {
        require(milestones[mId].participant == msg.sender, "Escrow: caller is not the participant");
        _;
    }

    /**
     * @notice Check the milestone info to set
     */
    modifier onlyMilestoneInfo(
        address token,
        address participant,
        uint256 amount,
        uint256 timestamp,
        string memory meta
    ) {
        require(token != address(0), "Escrow: token address is not defined");
        require(participant != address(0), "Escrow: participant address is not defined");
        require(amount > 0, "Escrow: token amount is zero");
        require(block.timestamp < timestamp, "Escrow: due date has already passed");
        require(bytes(meta).length > 0, "Escrow: meta is empty");
        _;
    }

    /**
     * @notice Call only after the dipuste creation
     */
    modifier onlyDispute(uint256 mId) {
        require(milestones[mId].state == MilestoneState.Disputed, "Escrow: there is no dispute");
        _;
    }

    /******************************* functions *******************************/
    /**
     * @notice Initialize the contract
     * @param _originator: Originator address
     * @param _uri: Ecsrow uri
     */
    function initialize(address _originator, string memory _uri) external {
        require(!isInitialized, "Escrow: already initialized");
        require(_originator != address(0), "Escrow: originator address is not defined");
        require(bytes(_uri).length > 0, "Escrow: uri is empty");

        isInitialized = true;

        originator = _originator;
        uri = _uri;
        factory = msg.sender;
    }

    /**
     * @notice Udpate metadata of an escrow
     * @param _uri: escrow uri
     */
    function updateMeta(string memory _uri) external onlyOriginator {
        require(bytes(_uri).length > 0, "Escrow: uri is empty");
        uri = _uri;
    }

    /**
     * @notice Originator creates a new milestone.
     * @param token: token address to fund
     * @param participant: participant address
     * @param amount: token amount to fund
     * @param timestamp: timestamp of dueDate
     * @param meta: milestone description
     */
    function createMilestone(
        address token,
        address participant,
        uint256 amount,
        uint256 timestamp,
        string memory meta
    ) external onlyOriginator onlyMilestoneInfo(token, participant, amount, timestamp, meta) nonReentrant {
        milestones.push(
            Milestone({
                token: token,
                participant: participant,
                amount: amount,
                timestamp: timestamp,
                meta: meta,
                lockId: type(uint256).max,
                state: MilestoneState.Created
            })
        );

        emit MilestoneCreated(milestones.length - 1, token, participant, amount, timestamp, meta);
    }

    /**
     * @notice Originator updates a certain milestone.
     * @param mId: milestone index
     * @param token: token address
     * @param participant: participant address
     * @param amount: token amount
     * @param timestamp: timestamp of dueDate
     * @param meta: milestone description
     */
    function updateMilestone(
        uint256 mId,
        address token,
        address participant,
        uint256 amount,
        uint256 timestamp,
        string memory meta
    ) external onlyIndex(mId) onlyOriginator onlyMilestoneInfo(token, participant, amount, timestamp, meta) {
        Milestone storage m = milestones[mId];
        require(m.state == MilestoneState.Created, "Escrow: milestone has already been agreed");
        m.token = token;
        m.participant = participant;
        m.amount = amount;
        m.timestamp = timestamp;
        m.meta = meta;

        emit MilestoneUpdated(mId, token, participant, amount, timestamp, meta);
    }

    /**
     * @notice Originator accepts a certain milestone
     * @param mId: milestone index
     */
    function agreeMilestone(uint256 mId) external onlyIndex(mId) onlyParticipant(mId) {
        Milestone storage m = milestones[mId];
        require(m.state == MilestoneState.Created, "Escrow: milestone has already been agreed");
        milestones[mId].state = MilestoneState.Agreed;

        emit MilestoneStateUpdated(mId, milestones[mId].state);
    }

    /**
     * @notice Originator deposits fund of milstone to this contract
     * @param mId: milestone index
     */
    function depositMilestone(uint256 mId) external onlyIndex(mId) onlyOriginator nonReentrant {
        Milestone storage m = milestones[mId];
        require(m.state == MilestoneState.Agreed, "Escrow: milestone is not agreed");
        m.state = MilestoneState.Deposited;
        IERC20(m.token).transferFrom(msg.sender, address(this), m.amount);

        emit MilestoneStateUpdated(mId, m.state);
    }

    /**
     * @notice Participant call this when the milestone isn't to released and it's over dueDate
     * @param mId: milestone index
     */
    function requestMilestone(uint256 mId) external onlyIndex(mId) onlyParticipant(mId) {
        Milestone storage m = milestones[mId];
        require(
            m.state == MilestoneState.Agreed || m.state == MilestoneState.Deposited,
            "Escrow: milestone is not deposited"
        );
        require(m.timestamp <= block.timestamp, "Escrow: milestone is not yet due date");
        m.state = MilestoneState.Requested;

        emit MilestoneStateUpdated(mId, m.state);
    }

    /**
     * @dev Fund is transferred to Lock contract.
     * @param mId: milestone index
     */
    function releaseMilestone(uint256 mId) external onlyIndex(mId) onlyOriginator nonReentrant {
        Milestone storage m = milestones[mId];
        require(
            m.state == MilestoneState.Deposited || m.state == MilestoneState.Requested,
            "Escrow: milestone isn't deposited"
        );
        m.state = MilestoneState.Released;
        (address feeRecipient, , uint256 feePercent, uint256 feeMultiplier) = EscrowFactory(factory).getFeeInfo();
        uint256 feeAmount = (m.amount * feePercent) / feeMultiplier;
        uint256 lockAmount = m.amount - feeAmount;
        (address locker, ) = EscrowFactory(factory).getLockInfo();
        m.lockId = Locker(locker).create(m.participant, m.token, lockAmount, block.timestamp, mId);
        IERC20(m.token).transfer(feeRecipient, feeAmount);
        IERC20(m.token).transfer(locker, lockAmount);

        emit MilestoneStateUpdated(mId, m.state);
    }

    /**
     * @notice Originator can file a dispute for released milestones.
     * @param mId: milestone index
     */
    function createDispute(uint256 mId) external onlyIndex(mId) onlyOriginator {
        Milestone storage m = milestones[mId];
        (, uint256 lockDuration) = EscrowFactory(factory).getLockInfo();
        require(m.state == MilestoneState.Released, "Escrow: milestone is not released");
        require(block.timestamp < m.timestamp + lockDuration, "Escrow: lock duration has already passed");
        m.state = MilestoneState.Disputed;

        emit MilestoneStateUpdated(mId, m.state);
    }

    /**
     * @notice Only called by participant or operator
     * @param mId: milestone index
     */
    function resolveDispute(uint256 mId) external onlyIndex(mId) onlyDispute(mId) nonReentrant {
        Milestone storage m = milestones[mId];
        require(
            msg.sender == m.participant || EscrowFactory(factory).isOperator(msg.sender),
            "Escrow: caller has no role"
        );
        m.state = MilestoneState.Agreed;
        (address locker, ) = EscrowFactory(factory).getLockInfo();
        Locker(locker).withdraw(m.lockId);

        emit MilestoneStateUpdated(mId, m.state);
    }

    /**
     * @notice Only called by originator or operator
     * @param mId: milestone index
     */
    function cancelDispute(uint256 mId) external onlyIndex(mId) onlyDispute(mId) {
        require(
            msg.sender == originator || EscrowFactory(factory).isOperator(msg.sender),
            "Escrow: caller has no role"
        );
        Milestone storage m = milestones[mId];
        m.state = MilestoneState.Released;

        emit MilestoneStateUpdated(mId, m.state);
    }

    /**
     * @notice Pariticipant claim the fund in Lock contract
     * @param mId: milestone index
     */
    function claimPariticipant(uint256 mId) external onlyIndex(mId) onlyParticipant(mId) nonReentrant {
        Milestone storage m = milestones[mId];
        require(m.state == MilestoneState.Released, "Escrow: milestone is not yet released");
        (address locker, ) = EscrowFactory(factory).getLockInfo();
        Locker(locker).release(m.lockId);
    }

    /**
     * @notice Destory self
     */
    function destroy(uint256 eId, uint256 ownEId) external onlyOriginator nonReentrant {
        uint256 i = 0;
        for (i = 0; i < milestones.length; i++) {
            if (milestones[i].state != MilestoneState.Released) break;
        }
        require(i == milestones.length, "Escrow: there are unreleased milestones");
        EscrowFactory(factory).destroyEscrow(eId, ownEId, msg.sender);
        selfdestruct(payable(factory));
    }

    /**
     * @notice Get the meta
     */
    function getMeta() external view returns (string memory) {
        return uri;
    }

    /**
     * @notice Get the originator address
     */
    function getOriginator() external view returns (address) {
        return originator;
    }

    /**
     * @notice Get the lock duration
     */
    function getLockDuration() external view returns (uint256 lockDuration) {
        (, lockDuration) = EscrowFactory(factory).getLockInfo();
    }

    /**
     * @notice Get count of any milstones(Created, Deposited, Released, Disputed)
     */
    function getCountMilestones(MilestoneState state) external view returns (uint256 count) {
        for (uint256 i = 0; i < milestones.length; i++) {
            if (milestones[i].state == state) count++;
        }
    }

    /**
     * @notice Get the milestone
     */
    function getMilestone(uint256 mId) external view returns (Milestone memory) {
        return milestones[mId];
    }
}
