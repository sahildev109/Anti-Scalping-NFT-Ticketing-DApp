import { ethers, network, artifacts } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

async function main() {
  const checkerAddress = process.env.CHECKER_ADDRESS;
  if (!checkerAddress || !ethers.isAddress(checkerAddress)) {
    throw new Error(
      "Missing or invalid CHECKER_ADDRESS environment variable. Example: CHECKER_ADDRESS=0x123... npx hardhat run scripts/grantChecker.ts --network sepolia"
    );
  }

  const frontendContractsDir = path.resolve(__dirname, "../../frontend/src/contracts");
  const deploymentPath = path.join(frontendContractsDir, "TicketNFT.json");

  let contractAddress = process.env.TICKET_NFT_ADDRESS;
  if (!contractAddress && fs.existsSync(deploymentPath)) {
    const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
    contractAddress = deploymentData.address;
  }

  const [admin] = await ethers.getSigners();
  console.log(`Executing from admin account: ${admin.address}`);

  // Check if contract exists on this network; if on ephemeral hardhat network, deploy test instance
  let code = contractAddress ? await ethers.provider.getCode(contractAddress) : "0x";
  if (code === "0x") {
    if (network.name === "hardhat") {
      console.log(
        `Notice: No contract found at ${contractAddress} on the in-memory 'hardhat' network. Deploying a new instance for test execution...`
      );
      const Factory = await ethers.getContractFactory("TicketNFT", admin);
      const deployed = await Factory.deploy();
      await deployed.waitForDeployment();
      contractAddress = await deployed.getAddress();
      console.log(`Contract deployed at: ${contractAddress}`);
    } else {
      throw new Error(
        `No contract code found at address ${contractAddress} on network ${network.name}. Please ensure you have deployed to this network.`
      );
    }
  }

  console.log(`Target TicketNFT contract: ${contractAddress}`);
  console.log(`Granting CHECKER_ROLE to: ${checkerAddress}`);

  const networkData = await ethers.provider.getNetwork();
  const chainId = Number(networkData.chainId);

  const ticketNFT = await ethers.getContractAt("TicketNFT", contractAddress, admin);
  const checkerRole = await ticketNFT.CHECKER_ROLE();

  const alreadyGranted = await ticketNFT.hasRole(checkerRole, checkerAddress);
  if (alreadyGranted) {
    console.log(`Notice: Address ${checkerAddress} already possesses CHECKER_ROLE.`);
  } else {
    const tx = await ticketNFT.grantRole(checkerRole, checkerAddress);
    console.log(`Transaction submitted: ${tx.hash}`);

    if (chainId === 11155111 || network.name === "sepolia") {
      console.log(`Etherscan transaction link: https://sepolia.etherscan.io/tx/${tx.hash}`);
      console.log(`Etherscan contract link: https://sepolia.etherscan.io/address/${contractAddress}`);
    }

    const receipt = await tx.wait();
    console.log(`CHECKER_ROLE successfully granted in block ${receipt?.blockNumber}!`);
  }

  // Ensure frontend/src/contracts/TicketNFT.json is maintained
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }

  const artifact = await artifacts.readArtifact("TicketNFT");
  const updatedDeploymentData = {
    address: contractAddress,
    chainId: chainId,
    abi: artifact.abi,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(updatedDeploymentData, null, 2), "utf-8");
  console.log(`Contract metadata synchronized with ${deploymentPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
