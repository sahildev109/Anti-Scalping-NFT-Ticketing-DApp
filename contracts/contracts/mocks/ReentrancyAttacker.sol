// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {TicketNFT} from "../TicketNFT.sol";

/**
 * @title ReentrancyAttacker
 * @notice Malicious contract that attempts to re-enter buyResale during the ERC721 receiver hook.
 */
contract ReentrancyAttacker is IERC721Receiver {
    TicketNFT public immutable ticketNFT;
    uint256 public targetTokenId;
    uint256 public reenterPrice;
    bool public attacked;

    constructor(address _ticketNFT) {
        ticketNFT = TicketNFT(_ticketNFT);
    }

    function attack(uint256 tokenId, uint256 nextTokenId, uint256 nextPrice) external payable {
        targetTokenId = nextTokenId;
        reenterPrice = nextPrice;
        attacked = false;
        ticketNFT.buyResale{value: msg.value - nextPrice}(tokenId);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        if (!attacked) {
            attacked = true;
            // Attempt to re-enter buyResale
            ticketNFT.buyResale{value: reenterPrice}(targetTokenId);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
