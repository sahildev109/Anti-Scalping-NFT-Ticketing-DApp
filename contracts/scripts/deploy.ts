import { ethers, artifacts, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log(`Deploying TicketNFT to network: ${network.name}...`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  const TicketNFTFactory = await ethers.getContractFactory("TicketNFT");
  const ticketNFT = await TicketNFTFactory.deploy();
  await ticketNFT.waitForDeployment();

  const contractAddress = await ticketNFT.getAddress();
  console.log(`TicketNFT successfully deployed to: ${contractAddress}`);

  const networkData = await ethers.provider.getNetwork();
  const chainId = Number(networkData.chainId);
  console.log(`Chain ID: ${chainId}`);

  const deployTx = ticketNFT.deploymentTransaction();
  if (deployTx) {
    console.log(`Deployment transaction hash: ${deployTx.hash}`);
    if (chainId === 11155111 || network.name === "sepolia") {
      console.log(`Etherscan transaction link: https://sepolia.etherscan.io/tx/${deployTx.hash}`);
      console.log(`Etherscan contract link: https://sepolia.etherscan.io/address/${contractAddress}`);
    }
  }

  // Read contract artifact for ABI
  const artifact = await artifacts.readArtifact("TicketNFT");

  // Output destination: frontend/src/contracts/TicketNFT.json
  const frontendContractsDir = path.resolve(__dirname, "../../frontend/src/contracts");
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }

  const outputPath = path.join(frontendContractsDir, "TicketNFT.json");
  const deploymentData = {
    address: contractAddress,
    chainId: chainId,
    abi: artifact.abi,
  };

  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2), "utf-8");
  console.log(`Contract metadata (address, chainId, ABI) saved to: ${outputPath}`);

  // If on Sepolia, wait for 5 confirmations and verify programmatically on Etherscan
  if (chainId === 11155111 || network.name === "sepolia") {
    console.log("Waiting for 5 block confirmations on Sepolia...");
    if (deployTx) {
      await deployTx.wait(5);
      console.log("5 confirmations received!");
    }

    console.log("Verifying contract on Etherscan via hardhat-verify...");
    try {
      await run("verify:verify", {
        address: contractAddress,
        constructorArguments: [],
      });
      console.log("Contract successfully verified on Etherscan!");
      console.log(`Verified contract: https://sepolia.etherscan.io/address/${contractAddress}#code`);
    } catch (error: any) {
      const errStr = String(error?.message || error).toLowerCase();
      if (errStr.includes("already verified")) {
        console.log("Contract is already verified on Etherscan.");
      } else {
        console.error("Etherscan verification encountered an error:", error);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
