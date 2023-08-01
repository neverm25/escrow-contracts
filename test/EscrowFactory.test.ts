import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { expect } from "chai";

import moment from "moment";

import {
  Escrow,
  EscrowFactory,
  EscrowFactory__factory,
  Escrow__factory,
  Locker,
  Locker__factory,
} from "../typechain";
import { FEE_MULTIPILER } from "./utils/constants";

describe("EscrowFactory test", () => {
  let escrow: Escrow;
  let locker: Locker;
  let escrowFactory: EscrowFactory;
  /* define users */
  let feeRecipient: SignerWithAddress;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;

  beforeEach(async () => {
    [, feeRecipient, user0, user1] = await ethers.getSigners();

    /* Deploy a escrow contract */
    const escrowFact: Escrow__factory = await ethers.getContractFactory(
      "Escrow",
    );
    escrow = await escrowFact.deploy();

    /* Deploy a Locker contract */
    const lockerFactory: Locker__factory = await ethers.getContractFactory(
      "Locker",
    );
    locker = await lockerFactory.deploy();

    /* Deploy a escrow factory contract */
    const escrowFactoryFactory: EscrowFactory__factory =
      await ethers.getContractFactory("EscrowFactory");
    escrowFactory = await escrowFactoryFactory.deploy(escrow.address);
  });

  describe("Deploy the escrow factory", () => {
    it("Deployer set the escrow address as the parameter", async () => {
      const escrowFactoryFactory: EscrowFactory__factory =
        await ethers.getContractFactory("EscrowFactory");
      await expect(
        escrowFactoryFactory.deploy(ethers.constants.AddressZero),
      ).to.be.revertedWith(
        "EscrowFactory: escrow implementation address is not defined",
      );
    });
  });

  describe("Set lock info", () => {
    it("Only owner can set be the lock info", async () => {
      await expect(
        escrowFactory
          .connect(user0)
          .setLockInfo(locker.address, moment.duration(1, "weeks").asSeconds()),
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Check the validation to set the info", async () => {
      await expect(
        escrowFactory.setLockInfo(
          ethers.constants.AddressZero,
          moment.duration(1, "weeks").asSeconds(),
        ),
      ).to.be.revertedWith("EscrowFactory: locker address is not defined");
      await expect(
        escrowFactory.setLockInfo(locker.address, 0),
      ).to.be.revertedWith(
        "EscrowFactory: lock duration must be greater than zero",
      );
    });

    it("Check the infos", async () => {
      const lockDuration = moment.duration(1, "weeks").asSeconds();
      await expect(escrowFactory.setLockInfo(locker.address, lockDuration))
        .to.emit(escrowFactory, "LockInfoSet")
        .withArgs(locker.address, lockDuration);
      const lockInfo = await escrowFactory.getLockInfo();
      expect(lockInfo[0]).to.equal(locker.address);
      expect(lockInfo[1]).to.equal(lockDuration);
    });
  });

  describe("Set fee Info", () => {
    it("Only owner can set the fee info", async () => {
      await expect(
        escrowFactory.connect(user0).setFeeInfo(feeRecipient.address, 10, 10),
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Check the validation to set info", async () => {
      await expect(
        escrowFactory.setFeeInfo(ethers.constants.AddressZero, 10, 10),
      ).to.be.revertedWith(
        "EscrowFactory: fee recipient address is not defined",
      );
      await expect(
        escrowFactory.setFeeInfo(feeRecipient.address, 10, 101),
      ).to.be.revertedWith(
        "EscrowFactory: fee percent is greater than fee multiplier",
      );
    });

    it("Check the infos", async () => {
      const createFee = 10;
      const feePercent = 10;
      await expect(
        escrowFactory.setFeeInfo(feeRecipient.address, createFee, feePercent),
      )
        .to.emit(escrowFactory, "FeeInfoSet")
        .withArgs(feeRecipient.address, createFee, feePercent);
      const feeInfo = await escrowFactory.getFeeInfo();
      expect(feeInfo[0]).to.equal(feeRecipient.address);
      expect(feeInfo[1]).to.equal(createFee);
      expect(feeInfo[2]).to.equal(feePercent);
      expect(feeInfo[3]).to.equal(FEE_MULTIPILER);
    });
  });

  describe("Create an Escrow and destroy it", () => {
    const escrowUri = "http://example.com";

    it("Users can't create an escrow before fee info and lock info", async () => {
      await expect(escrowFactory.createEscrow(escrowUri)).to.be.revertedWith(
        "EscrowFactory: fee recipient is not defined",
      );
      await escrowFactory.setFeeInfo(feeRecipient.address, 10, 10);
      await expect(escrowFactory.createEscrow(escrowUri)).to.be.revertedWith(
        "EscrowFactory: locker is not defined",
      );
    });

    describe("User should pay fee for an escrow creation", async () => {
      beforeEach(async () => {
        const createFee = 100;
        const feePercent = 10;

        await escrowFactory.setLockInfo(
          locker.address,
          moment.duration(1, "weeks").asSeconds(),
        );
        await escrowFactory.setFeeInfo(
          feeRecipient.address,
          createFee,
          feePercent,
        );
      });

      it("User didn't pay", async () => {
        await expect(escrowFactory.createEscrow(escrowUri)).to.be.revertedWith(
          "EscrowFactory: create fee is not enough",
        );
      });

      it("Check the escrow creation", async () => {
        await expect(
          escrowFactory.connect(user0).createEscrow(escrowUri, { value: 100 }),
        ).to.emit(escrowFactory, "EscrowCreated");
        let escrows = await escrowFactory.getEscrows();
        expect(escrows.length).to.equal(1);

        await expect(
          escrowFactory.connect(user1).createEscrow(escrowUri, { value: 100 }),
        ).to.emit(escrowFactory, "EscrowCreated");
        escrows = await escrowFactory.getEscrows();
        expect(escrows.length).to.equal(2);
        const originatorEscrows = await escrowFactory
          .connect(user1)
          .getOriginatorEcsrows();
        expect(originatorEscrows[0]).to.equal(1);
      });

      describe("Destroy an Escrow", () => {
        let escrowCtrtFactory: Escrow__factory;
        let escrows: string[];
        let user0Escrow: Escrow;
        let user1Escrow: Escrow;

        beforeEach(async () => {
          await escrowFactory
            .connect(user0)
            .createEscrow(escrowUri, { value: 100 });
          await escrowFactory
            .connect(user1)
            .createEscrow(escrowUri, { value: 100 });

          escrowCtrtFactory = await ethers.getContractFactory("Escrow");
          escrows = await escrowFactory.getEscrows();
          user0Escrow = escrowCtrtFactory.attach(escrows[0]);
          user1Escrow = escrowCtrtFactory.attach(escrows[1]);
        });

        it("Check the index escrow", async () => {
          expect(escrows.length).to.equal(2);

          await expect(
            escrowFactory.destroyEscrow(2, 0, user0.address),
          ).to.be.revertedWith("EscrowFactory: invalid escrow index");

          await expect(
            escrowFactory.destroyEscrow(1, 0, user0.address),
          ).to.be.revertedWith("EscrowFactory: caller is not the escrow");

          await expect(
            user0Escrow.connect(user0).destroy(0, 1),
          ).to.be.revertedWith("EscrowFactory: invalid own escrow index");
        });

        it("Check to destroy", async () => {
          await escrowFactory
            .connect(user0)
            .createEscrow(escrowUri, { value: 100 });
          escrows = await escrowFactory.getEscrows();

          const user0Escrows = await escrowFactory
            .connect(user0)
            .getOriginatorEcsrows();
          await expect(user0Escrow.connect(user0).destroy(user0Escrows[0], 0))
            .to.emit(escrowFactory, "EscrowRemoved")
            .withArgs(user0.address, escrows[0], 0);

          const user1Escrows = await escrowFactory
            .connect(user1)
            .getOriginatorEcsrows();
          await expect(user1Escrow.connect(user1).destroy(user1Escrows[0], 0))
            .to.emit(escrowFactory, "EscrowRemoved")
            .withArgs(user1.address, escrows[1], 1);
        });
      });
    });
  });

  describe("Set operator", () => {
    let operator: SignerWithAddress;

    before(async () => {
      [, , , operator] = await ethers.getSigners();
    });

    it("Only owner can set the operator", async () => {
      await expect(
        escrowFactory.connect(user0).setOperator(operator.address, true),
      );
    });

    it("Check the operator", async () => {
      expect(await escrowFactory.isOperator(operator.address)).to.equal(false);

      await expect(escrowFactory.setOperator(operator.address, true))
        .to.emit(escrowFactory, "OperatorSet")
        .withArgs(operator.address, true);

      expect(await escrowFactory.isOperator(operator.address)).to.equal(true);
    });
  });
});
