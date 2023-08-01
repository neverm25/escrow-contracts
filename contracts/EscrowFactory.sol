//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";

import "./Escrow.sol";

/**
 * @title EscrowFactory
 * @author cr
 * @notice Originators can create escrows here.
 */
contract EscrowFactory is Ownable, ReentrancyGuard {
    /******************************* variables *******************************/
    uint256 public constant FEE_MULTIPLIER = 100;

    uint256 private lockDuration;
    uint256 private createFee;
    uint256 private feePercent;
    address private feeRecipient;
    address private locker;
    address private escrowImplementation;

    address[] private escrows;
    mapping(address => uint256[]) private originatorEcsrows;
    mapping(uint256 => address) private eIdPositon;

    mapping(address => bool) private operators;

    /*******************************  events  *******************************/
    event LockInfoSet(address _locker, uint256 _lockDuration);
    event FeeInfoSet(address _feeRecipient, uint256 _createFee, uint256 _feePercent);
    event OperatorSet(address operator, bool canOperator);
    event EscrowCreated(address escrow, address originator, string uri, uint256 eId);
    event EscrowRemoved(address originator, address escrow, uint256 eId);

    constructor(address _escrowImplementation) {
        require(_escrowImplementation != address(0), "EscrowFactory: escrow implementation address is not defined");
        escrowImplementation = _escrowImplementation;
    }

    /******************************* functions *******************************/
    /**
     * @notice Set locker contract address and lock duration
     * @param _locker: locker contract address
     * @param _lockDuration: duration of fund lock when the originator releases the fund
     */
    function setLockInfo(address _locker, uint256 _lockDuration) external onlyOwner {
        require(_locker != address(0), "EscrowFactory: locker address is not defined");
        require(_lockDuration > 0, "EscrowFactory: lock duration must be greater than zero");
        locker = _locker;
        lockDuration = _lockDuration;

        emit LockInfoSet(locker, lockDuration);
    }

    /**
     * @notice Get lock info
     * @return locker: locker address
     * @return lockDuration: lock duration
     */
    function getLockInfo() external view returns (address, uint256) {
        return (locker, lockDuration);
    }

    /**
     * @notice Set fee info(create fee, fee recipient and fee percent)
     * @param _createFee: When an originator create an escrow, they should pay a certain amount of ETH.
     * @param _feeRecipient: Create fee will be transferred to fee recipient.
     * @param _feePercent: When originator releases milestone fund, some percent will be transferred
     * to feeRecipient address.
     */
    function setFeeInfo(
        address _feeRecipient,
        uint256 _createFee,
        uint256 _feePercent
    ) external onlyOwner {
        require(_feeRecipient != address(0), "EscrowFactory: fee recipient address is not defined");
        require(_feePercent <= FEE_MULTIPLIER, "EscrowFactory: fee percent is greater than fee multiplier");
        createFee = _createFee;
        feeRecipient = _feeRecipient;
        feePercent = _feePercent;

        emit FeeInfoSet(feeRecipient, createFee, feePercent);
    }

    /**
     * @notice Get fee info(fee recipient, fee percent and fee multiplier)
     * @return feeRecipient: fee recipient address
     * @return createFee: fee for creation
     * @return feePercent: fee percent
     * @return feeMultiplier: fee multiplier
     */
    function getFeeInfo()
        external
        view
        returns (
            address,
            uint256,
            uint256,
            uint256
        )
    {
        return (feeRecipient, createFee, feePercent, FEE_MULTIPLIER);
    }

    /**
     * @notice Create an escrow
     * @param uri: uri is saved on escrow contract.
     */
    function createEscrow(string memory uri) external payable nonReentrant {
        require(feeRecipient != address(0), "EscrowFactory: fee recipient is not defined");
        require(locker != address(0), "EscrowFactory: locker is not defined");
        require(msg.value == createFee, "EscrowFactory: create fee is not enough");
        address escrow = Clones.clone(escrowImplementation);
        Escrow(escrow).initialize(msg.sender, uri);
        originatorEcsrows[msg.sender].push(escrows.length);
        eIdPositon[escrows.length] = msg.sender;
        escrows.push(escrow);
        payable(feeRecipient).transfer(createFee);

        emit EscrowCreated(escrow, msg.sender, uri, escrows.length - 1);
    }

    /**
     * @notice Get a list of escrows owned by a certain waller.
     */
    function getOriginatorEcsrows() external view returns (uint256[] memory) {
        return originatorEcsrows[msg.sender];
    }

    /**
     * @notice Get a list of all available escrows.
     */
    function getEscrows() external view returns (address[] memory) {
        return escrows;
    }

    /**
     * @dev This will be called from escrow contract to remove escrow from factory.
     * @param eId: escrow index to remove
     * @param ownEId: originator's escrow index to remove
     * @param originator: originator address
     */
    function destroyEscrow(
        uint256 eId,
        uint256 ownEId,
        address originator
    ) external nonReentrant {
        require(eId < escrows.length, "EscrowFactory: invalid escrow index");
        require(escrows[eId] == msg.sender, "EscrowFactory: caller is not the escrow");
        uint256[] storage ownEscrowIds = originatorEcsrows[originator];
        require(ownEId < ownEscrowIds.length && ownEscrowIds[ownEId] == eId, "EscrowFactory: invalid own escrow index");
        // Remove from escrows
        if (eId < escrows.length - 1) escrows[eId] = escrows[escrows.length - 1];
        escrows.pop();
        // Remove from originator's escrows
        address addr = eIdPositon[eId];
        uint256[] storage temp = originatorEcsrows[addr];
        temp[temp.length - 1] = ownEscrowIds[ownEId];
        if (ownEId < ownEscrowIds.length - 1) ownEscrowIds[ownEId] = ownEscrowIds[ownEscrowIds.length - 1];
        ownEscrowIds.pop();

        emit EscrowRemoved(originator, msg.sender, eId);
    }

    /**
     * @dev Operators can assets milestone dispute if originator and participants don’t agree each other.
     * @param user: user address to set.
     * @param canOperator: true if operator is available, else false.
     */
    function setOperator(address user, bool canOperator) external onlyOwner {
        operators[user] = canOperator;

        emit OperatorSet(user, canOperator);
    }

    /**
     * @notice Get possible of operator.
     * @param user: user address
     * @return canOperator: true if operator is available, else false.
     */
    function isOperator(address user) external view returns (bool) {
        return operators[user];
    }
}
