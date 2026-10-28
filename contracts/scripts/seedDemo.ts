import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log(`\n======================================================`);
  console.log(`🌱 Seeding Demo Data on Network: ${network.name}`);
  console.log(`======================================================\n`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);

  // Retrieve contract address from frontend metadata or env
  const metadataPath = path.resolve(__dirname, "../../frontend/src/contracts/TicketNFT.json");
  let contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress && fs.existsSync(metadataPath)) {
    const raw = fs.readFileSync(metadataPath, "utf-8");
    const json = JSON.parse(raw);
    contractAddress = json.address;
  }

  if (!contractAddress) {
    throw new Error(
      "Contract address not found. Please deploy first or set CONTRACT_ADDRESS in .env"
    );
  }

  console.log(`Target TicketNFT Contract: ${contractAddress}`);
  const ticketNFT = await ethers.getContractAt("TicketNFT", contractAddress, deployer);

  // ─── 1. Create 2 Demo Events ──────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);

  // Event 1: Tech Conference
  const event1Name = "ETHGlobal Hackathon & Summit 2026";
  const event1Price = ethers.parseEther("0.02");
  const event1Supply = 150;
  const event1ResaleCapBps = 11000; // 110%
  const event1RoyaltyBps = 500; // 5%
  const event1Time = nowSec + 7 * 86400; // 7 days from now
  const event1MaxPerWallet = 3;

  console.log(`Creating Event 1: "${event1Name}"...`);
  const tx1 = await ticketNFT.createEvent(
    event1Name,
    event1Price,
    event1Supply,
    event1ResaleCapBps,
    event1RoyaltyBps,
    event1Time,
    event1MaxPerWallet
  );
  const receipt1 = await tx1.wait();
  console.log(`✓ Event 1 created! Tx: ${receipt1?.hash}`);

  // Event 2: Music Festival
  const event2Name = "Cyberpunk Neon Rave & Fest";
  const event2Price = ethers.parseEther("0.04");
  const event2Supply = 80;
  const event2ResaleCapBps = 12000; // 120%
  const event2RoyaltyBps = 750; // 7.5%
  const event2Time = nowSec + 14 * 86400; // 14 days from now
  const event2MaxPerWallet = 2;

  console.log(`Creating Event 2: "${event2Name}"...`);
  const tx2 = await ticketNFT.createEvent(
    event2Name,
    event2Price,
    event2Supply,
    event2ResaleCapBps,
    event2RoyaltyBps,
    event2Time,
    event2MaxPerWallet
  );
  const receipt2 = await tx2.wait();
  console.log(`✓ Event 2 created! Tx: ${receipt2?.hash}`);

  // Query total events created
  const totalEvents = await ticketNFT.totalEvents();
  console.log(`Total events on contract: ${totalEvents}`);

  // Identify event IDs for the two created events
  const event1Id = Number(totalEvents) - 2;
  const event2Id = Number(totalEvents) - 1;

  // ─── 2. Mint Tickets to Demo Addresses ────────────────────────────────────
  const demoAddressesEnv = process.env.DEMO_ADDRESSES;
  const demoAddresses: string[] = demoAddressesEnv
    ? demoAddressesEnv
        .split(",")
        .map((a) => a.trim())
        .filter((a) => ethers.isAddress(a))
    : [];

  const mintedTokenIds: { tokenId: number; ownerSigner: any; price: bigint; capBps: number }[] = [];

  // Determine signers / accounts to mint tickets
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  if (demoAddresses.length > 0 && isLocal) {
    console.log(`\nFound ${demoAddresses.length} demo address(es) for local impersonation.`);
    for (let i = 0; i < demoAddresses.length; i++) {
      const addr = demoAddresses[i];
      console.log(`Funding & impersonating demo address: ${addr}`);
      // Fund account with ETH from deployer
      await deployer.sendTransaction({
        to: addr,
        value: ethers.parseEther("1.0"),
      });

      // Impersonate
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
      });
      const demoSigner = await ethers.getSigner(addr);

      // Mint 1 ticket for Event 1
      const mintTx = await ticketNFT.connect(demoSigner).mintTicket(event1Id, {
        value: event1Price,
      });
      await mintTx.wait();

      const nextTokenId = Number(await ticketNFT.totalMinted()) - 1;
      console.log(`✓ Minted Ticket #${nextTokenId} for Event 1 to ${addr}`);

      mintedTokenIds.push({
        tokenId: nextTokenId,
        ownerSigner: demoSigner,
        price: event1Price,
        capBps: event1ResaleCapBps,
      });
    }
  } else {
    // Mint with deployer account
    console.log(`\nMinting tickets using deployer account (${deployer.address})...`);

    // Mint for Event 1
    const mintTx1 = await ticketNFT.connect(deployer).mintTicket(event1Id, {
      value: event1Price,
    });
    await mintTx1.wait();
    const tId1 = Number(await ticketNFT.totalMinted()) - 1;
    console.log(`✓ Minted Ticket #${tId1} for "${event1Name}" to deployer`);

    mintedTokenIds.push({
      tokenId: tId1,
      ownerSigner: deployer,
      price: event1Price,
      capBps: event1ResaleCapBps,
    });

    // Mint for Event 2
    const mintTx2 = await ticketNFT.connect(deployer).mintTicket(event2Id, {
      value: event2Price,
    });
    await mintTx2.wait();
    const tId2 = Number(await ticketNFT.totalMinted()) - 1;
    console.log(`✓ Minted Ticket #${tId2} for "${event2Name}" to deployer`);

    mintedTokenIds.push({
      tokenId: tId2,
      ownerSigner: deployer,
      price: event2Price,
      capBps: event2ResaleCapBps,
    });
  }

  // ─── 3. List One Ticket for Resale at the Cap ─────────────────────────────
  if (mintedTokenIds.length > 0) {
    const toList = mintedTokenIds[0];
    const capPrice = (toList.price * BigInt(toList.capBps)) / 10000n;

    console.log(
      `\nListing Ticket #${toList.tokenId} for resale at exact maximum cap (${ethers.formatEther(capPrice)} ETH)...`
    );

    const listTx = await ticketNFT
      .connect(toList.ownerSigner)
      .listForResale(toList.tokenId, capPrice);
    await listTx.wait();

    console.log(
      `✓ Successfully listed Ticket #${toList.tokenId} for resale at cap: ${ethers.formatEther(capPrice)} ETH!`
    );
  }

  console.log(`\n======================================================`);
  console.log(`🎉 Demo seeding completed successfully!`);
  console.log(`======================================================\n`);
}

main().catch((error) => {
  console.error("Error in seedDemo script:", error);
  process.exitCode = 1;
});
