import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { TicketNFT, ReentrancyAttacker } from "../typechain-types";

describe("TicketNFT", function () {
  let ticketNFT: TicketNFT;
  let admin: HardhatEthersSigner;
  let checker: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  const EVENT_NAME = "Summer Fest 2026";
  const TICKET_PRICE = ethers.parseEther("0.1");
  const MAX_SUPPLY = 5;
  const MAX_RESALE_BPS = 11000; // 110%
  const ROYALTY_BPS = 500; // 5%
  const MAX_PER_WALLET = 2;
  let eventTime: number;

  beforeEach(async function () {
    [admin, checker, user1, user2, user3] = await ethers.getSigners();

    const TicketNFTFactory = await ethers.getContractFactory("TicketNFT");
    ticketNFT = await TicketNFTFactory.deploy();
    await ticketNFT.waitForDeployment();

    const latestTime = await time.latest();
    eventTime = latestTime + 86400; // 1 day in future
  });

  async function createDefaultEvent() {
    return ticketNFT.createEvent(
      EVENT_NAME,
      TICKET_PRICE,
      MAX_SUPPLY,
      MAX_RESALE_BPS,
      ROYALTY_BPS,
      eventTime,
      MAX_PER_WALLET
    );
  }

  describe("1. createEvent only by admin", function () {
    it("allows DEFAULT_ADMIN_ROLE to create an event and emits EventCreated", async function () {
      await expect(createDefaultEvent())
        .to.emit(ticketNFT, "EventCreated")
        .withArgs(0, EVENT_NAME, TICKET_PRICE, MAX_SUPPLY, eventTime);

      const ev = await ticketNFT.getFunction("getEvent")(0);
      expect(ev.name).to.equal(EVENT_NAME);
      expect(ev.ticketPrice).to.equal(TICKET_PRICE);
      expect(ev.maxSupply).to.equal(MAX_SUPPLY);
      expect(ev.minted).to.equal(0);
      expect(ev.maxResaleBps).to.equal(MAX_RESALE_BPS);
      expect(ev.royaltyBps).to.equal(ROYALTY_BPS);
      expect(ev.eventTime).to.equal(eventTime);
      expect(ev.maxPerWallet).to.equal(MAX_PER_WALLET);
      expect(ev.active).to.be.true;
      expect(await ticketNFT.totalEvents()).to.equal(1);
    });

    it("reverts if a non-admin attempts to create an event", async function () {
      const defaultAdminRole = await ticketNFT.DEFAULT_ADMIN_ROLE();
      await expect(
        ticketNFT.connect(user1).createEvent(
          EVENT_NAME,
          TICKET_PRICE,
          MAX_SUPPLY,
          MAX_RESALE_BPS,
          ROYALTY_BPS,
          eventTime,
          MAX_PER_WALLET
        )
      )
        .to.be.revertedWithCustomError(ticketNFT, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, defaultAdminRole);
    });

    it("reverts if event parameters are invalid", async function () {
      // royalty > 1000 bps
      await expect(
        ticketNFT.createEvent(EVENT_NAME, TICKET_PRICE, MAX_SUPPLY, MAX_RESALE_BPS, 1001, eventTime, MAX_PER_WALLET)
      ).to.be.revertedWith("TicketNFT: royaltyBps > 1000");

      // maxSupply = 0
      await expect(
        ticketNFT.createEvent(EVENT_NAME, TICKET_PRICE, 0, MAX_RESALE_BPS, ROYALTY_BPS, eventTime, MAX_PER_WALLET)
      ).to.be.revertedWith("TicketNFT: maxSupply must be > 0");

      // maxPerWallet = 0
      await expect(
        ticketNFT.createEvent(EVENT_NAME, TICKET_PRICE, MAX_SUPPLY, MAX_RESALE_BPS, ROYALTY_BPS, eventTime, 0)
      ).to.be.revertedWith("TicketNFT: maxPerWallet must be > 0");

      // eventTime in the past
      const pastTime = (await time.latest()) - 100;
      await expect(
        ticketNFT.createEvent(EVENT_NAME, TICKET_PRICE, MAX_SUPPLY, MAX_RESALE_BPS, ROYALTY_BPS, pastTime, MAX_PER_WALLET)
      ).to.be.revertedWith("TicketNFT: event already past");
    });
  });

  describe("2. mint with exact price, wrong price reverts, per-wallet limit reverts, sold-out reverts", function () {
    beforeEach(async function () {
      await createDefaultEvent();
    });

    it("mints successfully with exact price and records state accurately", async function () {
      await expect(ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE }))
        .to.emit(ticketNFT, "TicketMinted")
        .withArgs(0, 0, user1.address, TICKET_PRICE);

      expect(await ticketNFT.ownerOf(0)).to.equal(user1.address);
      expect(await ticketNFT.ticketEvent(0)).to.equal(0);
      expect(await ticketNFT.originalPrice(0)).to.equal(TICKET_PRICE);
      expect(await ticketNFT.walletBalance(0, user1.address)).to.equal(1);
      expect(await ticketNFT.pendingWithdrawals(admin.address)).to.equal(TICKET_PRICE);
      expect(await ticketNFT.totalMinted()).to.equal(1);

      const ev = await ticketNFT.getFunction("getEvent")(0);
      expect(ev.minted).to.equal(1);
    });

    it("reverts with IncorrectPayment when wrong price is sent", async function () {
      // Underpayment
      const underpay = ethers.parseEther("0.05");
      await expect(ticketNFT.connect(user1).mintTicket(0, { value: underpay }))
        .to.be.revertedWithCustomError(ticketNFT, "IncorrectPayment")
        .withArgs(underpay, TICKET_PRICE);

      // Overpayment
      const overpay = ethers.parseEther("0.15");
      await expect(ticketNFT.connect(user1).mintTicket(0, { value: overpay }))
        .to.be.revertedWithCustomError(ticketNFT, "IncorrectPayment")
        .withArgs(overpay, TICKET_PRICE);
    });

    it("reverts with WalletCapReached when user exceeds maxPerWallet limit", async function () {
      // Mint up to cap (MAX_PER_WALLET = 2)
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });

      // 3rd attempt should revert
      await expect(ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE }))
        .to.be.revertedWithCustomError(ticketNFT, "WalletCapReached")
        .withArgs(0, user1.address);
    });

    it("reverts with EventSoldOut when maxSupply is reached", async function () {
      // Max supply is 5, max per wallet is 2
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
      await ticketNFT.connect(user2).mintTicket(0, { value: TICKET_PRICE });
      await ticketNFT.connect(user2).mintTicket(0, { value: TICKET_PRICE });
      await ticketNFT.connect(user3).mintTicket(0, { value: TICKET_PRICE });

      // 6th ticket should revert with EventSoldOut
      await expect(ticketNFT.connect(user3).mintTicket(0, { value: TICKET_PRICE }))
        .to.be.revertedWithCustomError(ticketNFT, "EventSoldOut")
        .withArgs(0);
    });

    it("reverts with EventNotActive if event has passed", async function () {
      await time.increaseTo(eventTime + 1);

      await expect(ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE }))
        .to.be.revertedWithCustomError(ticketNFT, "EventNotActive")
        .withArgs(0);
    });
  });

  describe("3. direct transferFrom/safeTransferFrom between users reverts", function () {
    beforeEach(async function () {
      await createDefaultEvent();
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
    });

    it("reverts when user calls transferFrom directly", async function () {
      await expect(
        ticketNFT.connect(user1).transferFrom(user1.address, user2.address, 0)
      ).to.be.revertedWithCustomError(ticketNFT, "DirectTransferBlocked");
    });

    it("reverts when user calls safeTransferFrom directly", async function () {
      await expect(
        ticketNFT.connect(user1)["safeTransferFrom(address,address,uint256)"](user1.address, user2.address, 0)
      ).to.be.revertedWithCustomError(ticketNFT, "DirectTransferBlocked");

      await expect(
        ticketNFT.connect(user1)["safeTransferFrom(address,address,uint256,bytes)"](
          user1.address,
          user2.address,
          0,
          "0x"
        )
      ).to.be.revertedWithCustomError(ticketNFT, "DirectTransferBlocked");
    });

    it("reverts even when an approved operator tries to transfer", async function () {
      await ticketNFT.connect(user1).approve(user2.address, 0);

      await expect(
        ticketNFT.connect(user2).transferFrom(user1.address, user3.address, 0)
      ).to.be.revertedWithCustomError(ticketNFT, "DirectTransferBlocked");
    });
  });

  describe("4. listForResale at exactly the cap succeeds, one wei above reverts with PriceAboveCap", function () {
    const tokenId = 0;
    let cap: bigint;

    beforeEach(async function () {
      await createDefaultEvent();
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
      // cap = originalPrice * maxResaleBps / 10000 = 0.1 ETH * 11000 / 10000 = 0.11 ETH
      cap = (TICKET_PRICE * BigInt(MAX_RESALE_BPS)) / 10000n;
    });

    it("succeeds when listing at exactly the cap", async function () {
      await expect(ticketNFT.connect(user1).listForResale(tokenId, cap))
        .to.emit(ticketNFT, "Listed")
        .withArgs(tokenId, user1.address, cap);

      const listing = await ticketNFT.getListing(tokenId);
      expect(listing.seller).to.equal(user1.address);
      expect(listing.price).to.equal(cap);
      expect(listing.active).to.be.true;
    });

    it("reverts with PriceAboveCap when listing price is one wei above cap", async function () {
      const priceAboveCap = cap + 1n;
      await expect(ticketNFT.connect(user1).listForResale(tokenId, priceAboveCap))
        .to.be.revertedWithCustomError(ticketNFT, "PriceAboveCap")
        .withArgs(priceAboveCap, cap);
    });

    it("allows listing below the cap and supports cancelListing", async function () {
      const belowCap = ethers.parseEther("0.08");
      await ticketNFT.connect(user1).listForResale(tokenId, belowCap);

      await expect(ticketNFT.connect(user1).cancelListing(tokenId))
        .to.emit(ticketNFT, "ListingCancelled")
        .withArgs(tokenId, user1.address);

      const listing = await ticketNFT.getListing(tokenId);
      expect(listing.active).to.be.false;
    });
  });

  describe("5. buyResale pays seller and organizer royalty correctly, ownership changes, listing cleared", function () {
    const tokenId = 0;
    const resalePrice = ethers.parseEther("0.11"); // 110% of 0.1 ETH

    beforeEach(async function () {
      await createDefaultEvent();
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
      await ticketNFT.connect(user1).listForResale(tokenId, resalePrice);
    });

    it("executes resale, transfers NFT, splits payments via pendingWithdrawals, and clears listing", async function () {
      // Royalty = 0.11 ETH * 500 / 10000 = 0.0055 ETH
      const expectedRoyalty = (resalePrice * BigInt(ROYALTY_BPS)) / 10000n;
      const expectedSellerProceeds = resalePrice - expectedRoyalty;

      const adminPendingBefore = await ticketNFT.pendingWithdrawals(admin.address);
      const sellerPendingBefore = await ticketNFT.pendingWithdrawals(user1.address);

      await expect(ticketNFT.connect(user2).buyResale(tokenId, { value: resalePrice }))
        .to.emit(ticketNFT, "Resold")
        .withArgs(tokenId, user1.address, user2.address, resalePrice, expectedRoyalty);

      // Ownership changed
      expect(await ticketNFT.ownerOf(tokenId)).to.equal(user2.address);

      // Original price preserved
      expect(await ticketNFT.originalPrice(tokenId)).to.equal(TICKET_PRICE);

      // Per-wallet balances updated
      expect(await ticketNFT.walletBalance(0, user1.address)).to.equal(0);
      expect(await ticketNFT.walletBalance(0, user2.address)).to.equal(1);

      // Listing cleared
      const listing = await ticketNFT.getListing(tokenId);
      expect(listing.active).to.be.false;

      // Pending withdrawals updated
      const adminPendingAfter = await ticketNFT.pendingWithdrawals(admin.address);
      const sellerPendingAfter = await ticketNFT.pendingWithdrawals(user1.address);

      expect(adminPendingAfter - adminPendingBefore).to.equal(expectedRoyalty);
      expect(sellerPendingAfter - sellerPendingBefore).to.equal(expectedSellerProceeds);
    });

    it("reverts if buyer sends incorrect payment", async function () {
      const wrongPrice = ethers.parseEther("0.10");
      await expect(ticketNFT.connect(user2).buyResale(tokenId, { value: wrongPrice }))
        .to.be.revertedWithCustomError(ticketNFT, "IncorrectPayment")
        .withArgs(wrongPrice, resalePrice);
    });

    it("reverts if buyer would exceed maxPerWallet", async function () {
      // User2 mints 2 tickets directly (reaching cap)
      await ticketNFT.connect(user2).mintTicket(0, { value: TICKET_PRICE });
      await ticketNFT.connect(user2).mintTicket(0, { value: TICKET_PRICE });

      // Trying to buy resale should revert
      await expect(ticketNFT.connect(user2).buyResale(tokenId, { value: resalePrice }))
        .to.be.revertedWithCustomError(ticketNFT, "WalletCapReached")
        .withArgs(0, user2.address);
    });
  });

  describe("6. a non-owner cannot list", function () {
    const tokenId = 0;

    beforeEach(async function () {
      await createDefaultEvent();
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
    });

    it("reverts with NotOwner if someone other than the owner tries to list", async function () {
      await expect(ticketNFT.connect(user2).listForResale(tokenId, TICKET_PRICE))
        .to.be.revertedWithCustomError(ticketNFT, "NotOwner")
        .withArgs(tokenId, user2.address);
    });

    it("reverts with NotOwner if non-owner tries to cancel a listing", async function () {
      await ticketNFT.connect(user1).listForResale(tokenId, TICKET_PRICE);

      await expect(ticketNFT.connect(user2).cancelListing(tokenId))
        .to.be.revertedWithCustomError(ticketNFT, "NotOwner")
        .withArgs(tokenId, user2.address);
    });
  });

  describe("7. checkIn only by CHECKER_ROLE, double check-in reverts, used ticket cannot be listed", function () {
    const tokenId = 0;
    let checkerRole: string;

    beforeEach(async function () {
      await createDefaultEvent();
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
      checkerRole = await ticketNFT.CHECKER_ROLE();
      await ticketNFT.grantRole(checkerRole, checker.address);
    });

    it("validates ticket initially as valid", async function () {
      expect(await ticketNFT.isValid(tokenId)).to.be.true;
      expect(await ticketNFT.used(tokenId)).to.be.false;
    });

    it("reverts if non-checker tries to check in", async function () {
      await expect(ticketNFT.connect(user1).checkIn(tokenId))
        .to.be.revertedWithCustomError(ticketNFT, "AccessControlUnauthorizedAccount")
        .withArgs(user1.address, checkerRole);
    });

    it("allows CHECKER_ROLE to check in and emits CheckedIn", async function () {
      await expect(ticketNFT.connect(checker).checkIn(tokenId))
        .to.emit(ticketNFT, "CheckedIn")
        .withArgs(tokenId, checker.address);

      expect(await ticketNFT.used(tokenId)).to.be.true;
      expect(await ticketNFT.isValid(tokenId)).to.be.false;
    });

    it("clears any active listing when ticket is checked in", async function () {
      await ticketNFT.connect(user1).listForResale(tokenId, TICKET_PRICE);
      expect((await ticketNFT.getListing(tokenId)).active).to.be.true;

      await expect(ticketNFT.connect(checker).checkIn(tokenId))
        .to.emit(ticketNFT, "ListingCancelled")
        .withArgs(tokenId, user1.address);

      expect((await ticketNFT.getListing(tokenId)).active).to.be.false;
    });

    it("reverts on double check-in with TicketAlreadyUsed", async function () {
      await ticketNFT.connect(checker).checkIn(tokenId);

      await expect(ticketNFT.connect(checker).checkIn(tokenId))
        .to.be.revertedWithCustomError(ticketNFT, "TicketAlreadyUsed")
        .withArgs(tokenId);
    });

    it("reverts if attempting to list an already used ticket", async function () {
      await ticketNFT.connect(checker).checkIn(tokenId);

      await expect(ticketNFT.connect(user1).listForResale(tokenId, TICKET_PRICE))
        .to.be.revertedWithCustomError(ticketNFT, "TicketAlreadyUsed")
        .withArgs(tokenId);
    });
  });

  describe("8. withdraw pays out and zeroes the balance", function () {
    beforeEach(async function () {
      await createDefaultEvent();
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });
    });

    it("pays out pending withdrawal and zeroes balance", async function () {
      const pending = await ticketNFT.pendingWithdrawals(admin.address);
      expect(pending).to.equal(TICKET_PRICE);

      const balanceBefore = await ethers.provider.getBalance(admin.address);
      const tx = await ticketNFT.connect(admin).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(admin.address);

      expect(balanceAfter).to.equal(balanceBefore + pending - gasUsed);
      expect(await ticketNFT.pendingWithdrawals(admin.address)).to.equal(0);
    });

    it("reverts with NothingToWithdraw if user has zero balance", async function () {
      await expect(ticketNFT.connect(user2).withdraw())
        .to.be.revertedWithCustomError(ticketNFT, "NothingToWithdraw");
    });
  });

  describe("9. reentrancy attempt on buyResale fails", function () {
    it("prevents reentrancy during buyResale and reverts with ReentrancyGuardReentrantCall", async function () {
      await createDefaultEvent();

      // Mint two tickets for user1
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE }); // tokenId 0
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE }); // tokenId 1

      // List both tickets for resale
      await ticketNFT.connect(user1).listForResale(0, TICKET_PRICE);
      await ticketNFT.connect(user1).listForResale(1, TICKET_PRICE);

      // Deploy malicious contract
      const AttackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await AttackerFactory.deploy(await ticketNFT.getAddress());
      await attacker.waitForDeployment();

      // Attacker calls attack which tries to buy ticket 0, and reenter buyResale for ticket 1 in onERC721Received
      await expect(
        attacker.connect(user2).attack(0, 1, TICKET_PRICE, { value: TICKET_PRICE * 2n })
      ).to.be.revertedWithCustomError(ticketNFT, "ReentrancyGuardReentrantCall");
    });
  });

  describe("Token URI and metadata", function () {
    it("generates valid on-chain base64 tokenURI with event name and ticket id", async function () {
      await createDefaultEvent();
      await ticketNFT.connect(user1).mintTicket(0, { value: TICKET_PRICE });

      const uri = await ticketNFT.tokenURI(0);
      expect(uri).to.contain("data:application/json;base64,");

      const base64Data = uri.replace("data:application/json;base64,", "");
      const jsonString = Buffer.from(base64Data, "base64").toString("utf-8");
      const metadata = JSON.parse(jsonString);

      expect(metadata.name).to.contain("Ticket #0");
      expect(metadata.name).to.contain(EVENT_NAME);
      expect(metadata.attributes).to.be.an("array");
    });
  });
});
