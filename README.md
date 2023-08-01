# Escrow System

## About
It’s functionality is similar to normal freelancing platforms.  
On a freelancing platform, a client can create a project. And hire several developers on the project. After discussion with a developer, the client creates a milestone and deposit funds to escrow. And once the developer delivers work, they release the fund in escrow to the developer. And a client can file a dispute in a certain period.  
We’re going to implement this system using a smart contract.  
On our project, let’s define some words: `originator` (same as client) and `participant`(same as developer)  
We use cryptocurrency, and once the fund is transferred to a participant, we can’t dispute it. So funds will be transferred to a participant through a vesting contract. Before it’s being released, clients can file a dispute.  

## Core contract
EscrowFactory: Originators can create escrows here

Escrow: Originators can create milestones and manage funds. Participants will use this contract to get paid.

Locker: If originators release funds, fund is transferred to vesting contract and originators can claim after some time.

## Project Specs

### EscrowFactory
  - This contract has a variable named `createFee`, `feeRecipient` and `feePercent`.  
    When an originator create an escrow, they should pay a certain amount of ETH. It will be  transferred to `feeRecipient`.  
    When originator releases milestone fund, some percent will be transferred to `feeRecipient` address.
  - This contract has a function named `createEscrow`.  
    It will receive `uri`(string) as a parameter and create an escrow contract. And uri is saved on `escrow` contract.  
    The front-end also need to get a list of escrows owned by a certain wallet.  
    The front-end also need to get a list of all available escrows.  
  - It has operators registration. Operators can assets milestone dispute if originator and participants don’t agree each other.
  - It has locker(address) and lockDuration(uint256).  
    Locker is the address of locker contract. LockDuration is the duration of fund lock when the originator releases the fund.
  - This contract has a function named `destroy`. This will be called from escrow contract to remove `escrow` from `factory`.

_You can define and use other necessary variables and functions._

### Escrow
  - Flow of a `milestone`.
    - Originator create a milestone
    - Originator can create a milestone info before participant agrees
    - Participant can agree with a milestone
    - Originator deposits funds to agreed milestone
    - Originator can released fund, or if they don’t release it, participant can request fund after dueDate of the milestone
    - Originator can file a dispute for released milestones (only when milestone fund is released, but it’s in Locker contract and it’s locked. => block.timestamp – released timestamp < lockDuration)
      If milestone fund in Locker is available to claim and participant doesn’t claim yet, originator can’t file a dispute.
    - Participant can accept dispute, and then fund in Locker contract is immediately sent back to originator.
    - Originator can cancel a dispute.
    - Also, operator can accept/cancel a dispute if participant and originator don’t agree each other.
  - It will have `overview` info. (count of created milestones, deposited milestones, released milestones, disputed milestones)
  - `updateMeta` function is to update metadata of an escrow
  - `createMilestone(address token, address participant, uint256 amount, uint256 timestamp, string memory meta)`: timestamp is unix timestamp of dueDate. Meta is just a string value of milestone description. And only called by originator
  - `updateMilestone(uint256 _mId, token, participant, amount, timestamp, meta)`: It can be called before milestone is agreed by participant. And only called by originator
  - `agreeMilestone(mId)`: only called by participant. It’s to accept a certain milestone.
  - `depositMilestone(mId)`: only called by originator, and deposit fund of milestone to this contract
  - `requestMilestone(mId)`: only called by participant when it’s not released and it’s over dueDate
  - `releaseMilestone(mId)`: only called by originator and release fund. Fund is transferred to Lock contract
  - `createDispute(mId)`: only called by originator. 
  - `resolveDispute(mId)`: only called by participant or operator.
  - `cancelDispute(mId)`: only called by originator or operator. 
  - `destroy()`: only called by originator, when all milestones are released. It will call factory.destroy() and destroy the current escrow contract

_You can define and use other necessary variables and functions._

### Locker
  - `Create(_token, amount, beneficiary, mId, unlockTimestamp)`: Called by escrow contracts only. 
  - `Release(lockId)`: Release fund to `beneficiary` address of `lockId` (if lockDuration is passed)

_You can define and use other necessary variables and functions._

## Example
### About dispute flow:
LockDuration is one week.  
Originator released milestoneA to Participant on 1th.  
Originator can file a dispute for milestoneA before 8th.  
After 8th, participant can release the fund.  
After 8th, originator can’t file a dispute even if participant doesn’t release it.  

Let’s assume that originator filed a dispute on 6th.  
Then participant can’t release fund on 8th or 9 th…  
If that dispute is cancelled on 7th, participant can release after 8th.  

## Reference:
When deploying a new contract, `don’t use new`. In that case, code size of factory contract is bigger, and it’s a bad practice.  
Use [Clones.clone](https://docs.openzeppelin.com/contracts/4.x/api/proxy#Clones) and [factory](https://github.com/pancakeswap/pancake-smart-contracts/blob/master/projects/farms-pools/contracts/SmartChefFactory.sol) and [initialize](https://github.com/pancakeswap/pancake-smart-contracts/blob/master/projects/farms-pools/contracts/SmartChefInitializable.sol) model.  
When destorying a contract, use [selfdestruct](https://solidity-by-example.org/hacks/self-destruct/)

## Command
This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a script that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
GAS_REPORT=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.ts
```
