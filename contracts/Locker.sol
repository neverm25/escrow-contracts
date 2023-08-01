// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
// import "hardhat/console.sol";

import "./Escrow.sol";

contract Locker is ReentrancyGuard {
    enum LockState {
        Locked,
        Released,
        Withdrawn
    }

    struct Lock {
        address escrow;
        address beneficiary;
        address token;
        uint256 amount;
        uint256 mId;
        uint256 unlockTimestamp;
        LockState state;
    }

    /******************************* variables *******************************/
    Lock[] private locks;

    /******************************* modifiers *******************************/
    modifier onlyLock(uint256 lockId) {
        require(lockId < locks.length, "Locker: invalid lock index");
        require(msg.sender == locks[lockId].escrow, "Locker: only escrow can call this function");
        require(locks[lockId].state == LockState.Locked, "Locker: it is not locked");
        _;
    }

    /******************************* functions *******************************/
    /**
     * @notice Create lock
     * @param beneficiary: beneficiary address
     * @param token: token address
     * @param amount: token amount
     * @param unlockTimestamp: unlock timestamp
     * @param mId: milestone index
     * @return lockId
     */
    function create(
        address beneficiary,
        address token,
        uint256 amount,
        uint256 unlockTimestamp,
        uint256 mId
    ) external nonReentrant returns (uint256) {
        require(beneficiary != address(0), "Locker: beneficiary is not defined");
        require(token != address(0), "Locker: token is not defined");
        locks.push(Lock(msg.sender, beneficiary, token, amount, mId, unlockTimestamp, LockState.Locked));
        return locks.length - 1;
    }

    /**
     * @notice Release lock
     * @param lockId: lock index
     */
    function release(uint256 lockId) external onlyLock(lockId) nonReentrant {
        Lock storage lock = locks[lockId];
        require(
            block.timestamp >= lock.unlockTimestamp + Escrow(lock.escrow).getLockDuration(),
            "Locker: it is locked for now"
        );
        lock.state = LockState.Released;
        IERC20(lock.token).transfer(lock.beneficiary, lock.amount);
    }

    /**
     * @notice Originator withdraw fund
     * @param lockId: lock Index
     */
    function withdraw(uint256 lockId) external onlyLock(lockId) nonReentrant {
        Lock storage lock = locks[lockId];
        require(
            block.timestamp < lock.unlockTimestamp + Escrow(lock.escrow).getLockDuration(),
            "Locker: lock duration has already passed"
        );
        address originator = Escrow(lock.escrow).getOriginator();
        lock.state = LockState.Withdrawn;
        IERC20(lock.token).transfer(originator, lock.amount);
    }
}
