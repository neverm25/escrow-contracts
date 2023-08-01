import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { expect } from "chai";

import moment from "moment";

import {
  EscrowFactory,
  EscrowFactory__factory,
  Escrow,
  Escrow__factory,
  Locker,
  Locker__factory,
  TestToken,
  TestToken__factory,
} from "../typechain";
import { getLatestBlockTimestamp, timeTravel } from "./utils/helpers";
import { MilestoneState } from "./utils/constants";

describe("Escrow test", () => {
  // Define contracts
  let escrowFactory: EscrowFactory;
  let escrow: Escrow;
  let locker: Locker;

  // Define users
  let feeRecipient: SignerWithAddress;
  let originator: SignerWithAddress;
  let participant: SignerWithAddress;

  // Array of Escrow addreses
  let escrows: string[];

  // lock duration
  const lockDuration = moment.duration(1, "weeks").asSeconds();

  before(async () => {
    [, feeRecipient, originator, participant] = await ethers.getSigners();

    // Deploy a escrow contract
    const escrowCtrtFact: Escrow__factory = await ethers.getContractFactory("Escrow");
    escrow = await escrowCtrtFact.deploy();

    // Deploy a escrow factory contract
    const escrowFactoryFactory: EscrowFactory__factory = await ethers.getContractFactory("EscrowFactory");
    escrowFactory = await escrowFactoryFactory.deploy(escrow.address);
  });

  describe("Create an Escrow and initailize it", () => {
    before(async () => {
      // Deploy a Locker contract
      const lockerFactory: Locker__factory = await ethers.getContractFactory("Locker");
      locker = await lockerFactory.deploy();
    });

    it("Check to initialize", async () => {
      const escrowUri = "http://escrow.example.com";
      await expect(escrow.initialize(ethers.constants.AddressZero, "")).to.be.revertedWith(
        "Escrow: originator address is not defined",
      );
      await expect(escrow.initialize(originator.address, "")).to.be.revertedWith("Escrow: uri is empty");
      await escrow.initialize(originator.address, escrowUri);
      await expect(escrow.initialize(originator.address, escrowUri)).to.be.revertedWith("Escrow: already initialized");
    });

    it("Create an Escrow from the EscrowFactroy", async () => {
      const createFee = 100;
      const feePercent = 10;
      const escrowUri = "http://escrow.example.com";

      await escrowFactory.setLockInfo(locker.address, lockDuration);
      await escrowFactory.setFeeInfo(feeRecipient.address, createFee, feePercent);
      await escrowFactory.connect(originator).createEscrow(escrowUri, { value: createFee });
      escrows = await escrowFactory.getEscrows();
      const escrowCtrtFact: Escrow__factory = await ethers.getContractFactory("Escrow");
      escrow = escrowCtrtFact.attach(escrows[0]);
    });
  });

  describe("Update the meta of the escrow", () => {
    const updatedEscrowUri = "http://escrow.updated.example.com";

    it("Only originator can update the meta of the escrow", async () => {
      await expect(escrow.updateMeta(updatedEscrowUri)).to.be.revertedWith("Escrow: caller is not the originator");
    });

    it("Check to update the meta", async () => {
      await expect(escrow.connect(originator).updateMeta("")).to.be.revertedWith("Escrow: uri is empty");
    });

    it("Check the updated meta", async () => {
      await escrow.connect(originator).updateMeta(updatedEscrowUri);
      expect(await escrow.getMeta()).be.equal(updatedEscrowUri);
    });
  });

  describe("Start an Escrow", () => {
    let testToken: TestToken;
    const milestoneAmount = 100;
    const dueDate = moment().add(10, "days").unix();
    const milestoneMeta = "test milestone";
    const mId = 0;

    before(async () => {
      // Deploy a test token contract
      const testTokenFactory: TestToken__factory = await ethers.getContractFactory("TestToken");
      testToken = await testTokenFactory.deploy();
    });

    describe("Originator creates a milestone", () => {
      it("Only originator can create the milestone", async () => {
        await expect(
          escrow.createMilestone(testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: caller is not the originator");
      });

      it("Check the property to create", async () => {
        await expect(
          escrow
            .connect(originator)
            .createMilestone(
              ethers.constants.AddressZero,
              participant.address,
              milestoneAmount,
              dueDate,
              milestoneMeta,
            ),
        ).to.be.revertedWith("Escrow: token address is not defined");
        await expect(
          escrow
            .connect(originator)
            .createMilestone(testToken.address, ethers.constants.AddressZero, milestoneAmount, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: participant address is not defined");
        await expect(
          escrow.connect(originator).createMilestone(testToken.address, participant.address, 0, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: token amount is zero");
        await expect(
          escrow
            .connect(originator)
            .createMilestone(
              testToken.address,
              participant.address,
              milestoneAmount,
              await getLatestBlockTimestamp(),
              milestoneMeta,
            ),
        ).to.be.revertedWith("Escrow: due date has already passed");
        await expect(
          escrow
            .connect(originator)
            .createMilestone(testToken.address, participant.address, milestoneAmount, dueDate, ""),
        ).to.be.revertedWith("Escrow: meta is empty");
      });

      it("Check the created milestone", async () => {
        await expect(
          escrow
            .connect(originator)
            .createMilestone(testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta),
        )
          .to.emit(escrow, "MilestoneCreated")
          .withArgs(mId, testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta);

        const milestone = await escrow.getMilestone(mId);
        expect(milestone[0]).to.equal(testToken.address);
        expect(milestone[1]).to.equal(participant.address);
        expect(milestone[2]).to.equal(milestoneAmount);
        expect(milestone[3]).to.equal(dueDate);
        expect(milestone[4]).to.equal(ethers.constants.MaxUint256);
        expect(milestone[5]).to.equal(milestoneMeta);
        expect(milestone[6]).to.equal(MilestoneState.Created);
      });

      it("Overvew info", async () => {
        expect(await escrow.getCountMilestones(MilestoneState.Created)).to.equal(1);
        expect(await escrow.getCountMilestones(MilestoneState.Agreed)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Deposited)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Requested)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Released)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Disputed)).to.equal(0);
      });
    });

    describe("Originator updates a milestone", () => {
      it("Only originator can update the milestone", async () => {
        await expect(
          escrow.updateMilestone(mId, testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: caller is not the originator");
      });

      it("Check the milestone index", async () => {
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(1, testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: invalid milestone index");
      });

      it("Check the property to update", async () => {
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(
              mId,
              ethers.constants.AddressZero,
              participant.address,
              milestoneAmount,
              dueDate,
              milestoneMeta,
            ),
        ).to.be.revertedWith("Escrow: token address is not defined");
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(
              mId,
              testToken.address,
              ethers.constants.AddressZero,
              milestoneAmount,
              dueDate,
              milestoneMeta,
            ),
        ).to.be.revertedWith("Escrow: participant address is not defined");
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(mId, testToken.address, participant.address, 0, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: token amount is zero");
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(
              mId,
              testToken.address,
              participant.address,
              milestoneAmount,
              await getLatestBlockTimestamp(),
              milestoneMeta,
            ),
        ).to.be.revertedWith("Escrow: due date has already passed");
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(mId, testToken.address, participant.address, milestoneAmount, dueDate, ""),
        ).to.be.revertedWith("Escrow: meta is empty");
      });

      it("Check the updated milestone", async () => {
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(mId, testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta),
        )
          .to.emit(escrow, "MilestoneUpdated")
          .withArgs(mId, testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta);

        const milestone = await escrow.getMilestone(mId);
        expect(milestone[0]).to.equal(testToken.address);
        expect(milestone[1]).to.equal(participant.address);
        expect(milestone[2]).to.equal(milestoneAmount);
        expect(milestone[3]).to.equal(dueDate);
        expect(milestone[4]).to.equal(ethers.constants.MaxUint256);
        expect(milestone[5]).to.equal(milestoneMeta);
        expect(milestone[6]).to.equal(MilestoneState.Created);
      });

      it("Overvew info", async () => {
        expect(await escrow.getCountMilestones(MilestoneState.Created)).to.equal(1);
        expect(await escrow.getCountMilestones(MilestoneState.Agreed)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Deposited)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Requested)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Released)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Disputed)).to.equal(0);
      });
    });

    describe("Participant agrees a milestone", () => {
      it("Only participant can agree the milestone", async () => {
        await expect(escrow.agreeMilestone(mId)).to.be.revertedWith("Escrow: caller is not the participant");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(participant).agreeMilestone(1)).to.be.revertedWith(
          "Escrow: invalid milestone index",
        );
      });

      it("Originator can't deposite before participant agrees", async () => {
        await expect(escrow.connect(originator).depositMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone is not agreed",
        );
      });

      it("Originator should deposite for the milestone after participant agreed", async () => {
        await expect(escrow.connect(originator).depositMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone is not agreed",
        );
      });

      it("Participant should request the milestone when it's not released.", async () => {
        await expect(escrow.connect(participant).requestMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone is not deposited",
        );
      });

      it("Check the agreed milestone", async () => {
        await expect(escrow.connect(participant).agreeMilestone(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Agreed);
        await expect(escrow.connect(participant).agreeMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone has already been agreed",
        );
      });

      it("Originator can't update the milestone after participant agreed", async () => {
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(mId, testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: milestone has already been agreed");
      });

      it("Originator can't update when the milestone is agreed", async () => {
        await expect(
          escrow
            .connect(originator)
            .updateMilestone(mId, testToken.address, participant.address, milestoneAmount, dueDate, milestoneMeta),
        ).to.be.revertedWith("Escrow: milestone has already been agreed");
      });

      it("Overvew info", async () => {
        expect(await escrow.getCountMilestones(MilestoneState.Created)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Agreed)).to.equal(1);
        expect(await escrow.getCountMilestones(MilestoneState.Deposited)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Requested)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Released)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Disputed)).to.equal(0);
      });
    });

    describe("Originator deposites for a milestone", () => {
      it("Only originator can depostie for the milestone", async () => {
        await expect(escrow.depositMilestone(mId)).to.be.revertedWith("Escrow: caller is not the originator");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(originator).depositMilestone(2)).to.be.revertedWith(
          "Escrow: invalid milestone index",
        );
      });

      it("Originator should release the milestone after deposite it", async () => {
        await expect(escrow.connect(originator).releaseMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone isn't deposited",
        );
      });

      it("Check the deposited milestone", async () => {
        await testToken.transfer(originator.address, 10000);
        await testToken.connect(originator).approve(escrow.address, milestoneAmount);
        await expect(escrow.connect(originator).depositMilestone(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Deposited);
        expect(await testToken.balanceOf(escrow.address)).to.equal(milestoneAmount);
        expect(await testToken.balanceOf(originator.address)).to.equal(10000 - milestoneAmount);
        await expect(escrow.connect(originator).depositMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone is not agreed",
        );
      });

      it("Overvew info", async () => {
        expect(await escrow.getCountMilestones(MilestoneState.Created)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Agreed)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Deposited)).to.equal(1);
        expect(await escrow.getCountMilestones(MilestoneState.Requested)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Released)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Disputed)).to.equal(0);
      });
    });

    describe("Participant requests a milestone", () => {
      it("Only participant can request the milestone", async () => {
        await expect(escrow.requestMilestone(mId)).to.be.revertedWith("Escrow: caller is not the participant");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(originator).requestMilestone(2)).to.be.revertedWith(
          "Escrow: invalid milestone index",
        );
      });

      it("Participant can request the milestone when it's not released, after due date", async () => {
        await expect(escrow.connect(participant).requestMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone is not yet due date",
        );
      });

      it("Check the requested milestone", async () => {
        const blockNow = await getLatestBlockTimestamp();
        timeTravel(dueDate - blockNow);
        await expect(escrow.connect(participant).requestMilestone(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Requested);

        await expect(escrow.connect(participant).requestMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone is not deposited",
        );
      });

      it("Overvew info", async () => {
        expect(await escrow.getCountMilestones(MilestoneState.Created)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Agreed)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Deposited)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Requested)).to.equal(1);
        expect(await escrow.getCountMilestones(MilestoneState.Released)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Disputed)).to.equal(0);
      });
    });

    describe("Originator releases a milestone", () => {
      it("Only originator can release the milestone", async () => {
        await expect(escrow.releaseMilestone(mId)).to.be.revertedWith("Escrow: caller is not the originator");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(originator).releaseMilestone(2)).to.be.revertedWith(
          "Escrow: invalid milestone index",
        );
      });

      it("Originator can create a dispute after released the milestone", async () => {
        await expect(escrow.connect(originator).createDispute(mId)).to.be.revertedWith(
          "Escrow: milestone is not released",
        );
      });

      it("Originator can destroy the escrow after release all milestone", async () => {
        await expect(escrow.connect(originator).destroy(0, 0)).to.be.revertedWith(
          "Escrow: there are unreleased milestones",
        );
      });

      it("Check the released milestone", async () => {
        await expect(escrow.connect(originator).releaseMilestone(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Released);
        expect(await testToken.balanceOf(feeRecipient.address)).to.equal(milestoneAmount * 0.1);
        expect(await testToken.balanceOf(locker.address)).to.equal(milestoneAmount * 0.9);
        await expect(escrow.connect(originator).releaseMilestone(mId)).to.be.revertedWith(
          "Escrow: milestone isn't deposited",
        );
      });

      it("Overvew info", async () => {
        expect(await escrow.getCountMilestones(MilestoneState.Created)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Agreed)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Deposited)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Requested)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Released)).to.equal(1);
        expect(await escrow.getCountMilestones(MilestoneState.Disputed)).to.equal(0);
      });
    });

    describe("Originator creates a dispute", () => {
      it("Only originator can create the dispute", async () => {
        await expect(escrow.createDispute(mId)).to.be.revertedWith("Escrow: caller is not the originator");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(originator).createDispute(2)).to.be.revertedWith("Escrow: invalid milestone index");
      });

      it("Originator can cancel the dispute after created it", async () => {
        await expect(escrow.connect(originator).cancelDispute(mId)).to.be.revertedWith("Escrow: there is no dispute");
      });

      it("Participant can resolve the dispute after created it", async () => {
        await expect(escrow.connect(participant).resolveDispute(mId)).to.be.revertedWith("Escrow: there is no dispute");
      });

      it("Check the milestone with created dispute", async () => {
        await expect(escrow.connect(originator).createDispute(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Disputed);
        await expect(escrow.connect(originator).createDispute(mId)).to.be.revertedWith(
          "Escrow: milestone is not released",
        );
      });

      it("Participant should claim after released the milestone", async () => {
        await expect(escrow.connect(participant).claimPariticipant(mId)).to.be.revertedWith(
          "Escrow: milestone is not yet released",
        );
      });

      it("Overvew info", async () => {
        expect(await escrow.getCountMilestones(MilestoneState.Created)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Agreed)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Deposited)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Requested)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Released)).to.equal(0);
        expect(await escrow.getCountMilestones(MilestoneState.Disputed)).to.equal(1);
      });
    });

    describe("Originator cancels a dispute", () => {
      it("Originator or operator can cancel the dispute", async () => {
        await expect(escrow.cancelDispute(mId)).to.be.revertedWith("Escrow: caller has no role");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(originator).cancelDispute(2)).to.be.revertedWith("Escrow: invalid milestone index");
      });

      it("Check the milestone with canceled dispute", async () => {
        await expect(escrow.connect(originator).cancelDispute(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Released);
        await expect(escrow.connect(originator).cancelDispute(mId)).to.be.revertedWith("Escrow: there is no dispute");
      });
    });

    describe("Participant accepts a dispute", () => {
      before(async () => {
        await expect(escrow.connect(originator).createDispute(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Disputed);
      });

      it("Participant or operator can accept the dispute", async () => {
        await expect(escrow.resolveDispute(mId)).to.be.revertedWith("Escrow: caller has no role");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(participant).resolveDispute(2)).to.be.revertedWith(
          "Escrow: invalid milestone index",
        );
      });

      it("Check the milestone with resolved dispute", async () => {
        await expect(escrow.connect(participant).resolveDispute(mId))
          .to.emit(escrow, "MilestoneStateUpdated")
          .withArgs(mId, MilestoneState.Agreed);
        expect(await testToken.balanceOf(locker.address)).to.equal(0);
        expect(await testToken.balanceOf(originator.address)).to.equal(10000 - milestoneAmount * 0.1);
        await expect(escrow.connect(participant).resolveDispute(mId)).to.be.revertedWith("Escrow: there is no dispute");
      });
    });

    describe("Participant claims the release fund", () => {
      before(async () => {
        await testToken.connect(originator).approve(escrow.address, milestoneAmount);
        await escrow.connect(originator).depositMilestone(mId);
        await escrow.connect(originator).releaseMilestone(mId);
      });

      it("Only participant can claim", async () => {
        await expect(escrow.claimPariticipant(mId)).to.be.revertedWith("Escrow: caller is not the participant");
      });

      it("Check the milestone index", async () => {
        await expect(escrow.connect(participant).claimPariticipant(2)).to.be.revertedWith(
          "Escrow: invalid milestone index",
        );
      });

      it("Participant can claim after lock duraton", async () => {
        await expect(escrow.connect(participant).claimPariticipant(mId)).to.be.revertedWith(
          "Locker: it is locked for now",
        );
      });

      it("Check the claimed fund", async () => {
        timeTravel(lockDuration);
        await escrow.connect(participant).claimPariticipant(mId);
        expect(await testToken.balanceOf(locker.address)).to.equal(0);
        expect(await testToken.balanceOf(participant.address)).to.equal(milestoneAmount * 0.9);
        await expect(escrow.connect(participant).claimPariticipant(mId)).to.be.revertedWith("Locker: it is not locked");
      });

      it("Originator can't create the dispute after lock duration", async () => {
        await expect(escrow.connect(originator).createDispute(mId)).to.be.revertedWith(
          "Escrow: lock duration has already passed",
        );
      });
    });
  });

  describe("Destroy an Escrow", () => {
    it("Only originator can destroy the escrow", async () => {
      await expect(escrow.destroy(0, 0)).to.be.revertedWith("Escrow: caller is not the originator");
    });

    it("Check the destroyed escrow", async () => {
      await escrow.connect(originator).destroy(0, 0);
    });
  });
});
