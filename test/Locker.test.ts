import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { expect } from "chai";
import moment from "moment";

import {
  Escrow,
  Escrow__factory,
  EscrowFactory,
  EscrowFactory__factory,
  Locker,
  Locker__factory,
  TestToken,
  TestToken__factory,
} from "../typechain";
import { timeTravel, getLatestBlockTimestamp } from "./utils/helpers";

describe("Locker test", () => {
  let locker: Locker;
  let testToken: TestToken;
  let escrow: Escrow;
  let escrowFactory: EscrowFactory;
  /* Define users */
  let beneficiary: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let originator: SignerWithAddress;
  let participant: SignerWithAddress;

  before(async () => {
    [, beneficiary, feeRecipient, originator, participant] = await ethers.getSigners();

    const lockerFactory: Locker__factory = await ethers.getContractFactory("Locker");
    locker = await lockerFactory.deploy();

    const testTokenFactory: TestToken__factory = await ethers.getContractFactory("TestToken");
    testToken = await testTokenFactory.deploy();
  });

  it("Create a lock", async () => {
    await expect(
      locker.create(ethers.constants.AddressZero, testToken.address, 100, moment().unix(), 0),
    ).to.be.revertedWith("Locker: beneficiary is not defined");

    await expect(
      locker.create(beneficiary.address, ethers.constants.AddressZero, 100, moment().unix(), 0),
    ).to.be.revertedWith("Locker: token is not defined");
  });

  describe("After create", () => {
    const mId = 0;
    const lockDuration = moment.duration(1, "weeks").asSeconds();

    it("Only escrow can create a lock and release it", async () => {
      await expect(locker.release(1)).to.be.revertedWith("Locker: invalid lock index");
      const momentNow = moment.unix(await getLatestBlockTimestamp());
      const unlockTime = momentNow.add(1, "weeks").unix();

      await locker.create(beneficiary.address, testToken.address, 100, unlockTime, 0);
      testToken.transfer(locker.address, 1000);
      timeTravel(lockDuration);
      await expect(locker.release(0)).to.be.reverted;
    });

    it("Participant can release after unlock timestamp", async () => {
      /* Deploy a escrow contract */
      const escrowCtrtFact: Escrow__factory = await ethers.getContractFactory("Escrow");
      escrow = await escrowCtrtFact.deploy();

      /* Deploy a escrow factory contract */
      const escrowFactoryFactory: EscrowFactory__factory = await ethers.getContractFactory("EscrowFactory");
      escrowFactory = await escrowFactoryFactory.deploy(escrow.address);

      const createFee = 100;
      const feePercent = 10;
      const escrowUri = "http://escrow.example.com";
      const milestoneAmount = 100;
      const blockNow = moment.unix(await getLatestBlockTimestamp());
      const dueDate = blockNow.add(10, "days").unix();
      const milestoneMeta = "test milestone";

      await escrowFactory.setLockInfo(locker.address, lockDuration);
      await escrowFactory.setFeeInfo(feeRecipient.address, createFee, feePercent);
      await escrowFactory.connect(originator).createEscrow(escrowUri, { value: createFee });
      const escrows = await escrowFactory.getEscrows();
      escrow = escrowCtrtFact.attach(escrows[0]);
      await escrow
        .connect(originator)
        .createMilestone(testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta);
      await escrow.connect(participant).agreeMilestone(mId);
      await testToken.transfer(originator.address, 10000);
      await testToken.connect(originator).approve(escrow.address, milestoneAmount);
      await escrow.connect(originator).depositMilestone(mId);
      await expect(escrow.connect(participant).claimPariticipant(mId)).to.be.revertedWith(
        "Escrow: milestone is not yet released",
      );
      await escrow.connect(originator).releaseMilestone(mId);
      await expect(locker.release(1)).to.be.revertedWith("Locker: only escrow can call this function");
      await expect(escrow.connect(participant).claimPariticipant(mId)).to.be.revertedWith(
        "Locker: it is locked for now",
      );
    });

    it("Check to withdraw", async () => {
      await expect(locker.withdraw(3)).to.be.revertedWith("Locker: invalid lock index");
      const momentNow = moment.unix(await getLatestBlockTimestamp());
      await locker.create(beneficiary.address, testToken.address, 100, momentNow.add(1, "day").unix(), 0);
      testToken.transfer(locker.address, 1000);
      await expect(locker.withdraw(2)).to.be.reverted;
    });

    it("Withdraw a lock", async () => {
      await escrow.connect(originator).createDispute(mId);
      timeTravel(lockDuration);
      await expect(escrow.connect(participant).resolveDispute(mId)).to.be.revertedWith(
        "Locker: lock duration has already passed",
      );
    });
  });
});
