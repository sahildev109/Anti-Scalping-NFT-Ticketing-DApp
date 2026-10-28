// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ERC721Utils} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Utils.sol";

/**
 * @title TicketNFT
 * @notice ERC-721 NFT ticketing contract with role-based access, anti-scalping
 *         resale marketplace, and pull-payment withdrawals.
 *
 * Roles
 * ------
 * DEFAULT_ADMIN_ROLE  – organizer: creates events, is the royalty recipient.
 * CHECKER_ROLE        – gate staff: can check tickets in at the door.
 *
 * Anti-scalping
 * -------------
 * Direct ERC-721 transfers between two non-zero addresses are blocked.
 * The only way to transfer ownership is through the on-contract marketplace
 * (buyResale), which enforces the resale price cap and distributes royalties.
 */
contract TicketNFT is ERC721, AccessControl, ReentrancyGuard {
    using Strings for uint256;

    // ─────────────────────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Role identifier for gate staff who may call checkIn.
    bytes32 public constant CHECKER_ROLE = keccak256("CHECKER_ROLE");

    // ─────────────────────────────────────────────────────────────────────────
    // Custom Errors
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Resale listing price exceeds the allowed cap derived from face value.
    error PriceAboveCap(uint256 requested, uint256 cap);

    /// @notice A ticket transfer was attempted outside the marketplace.
    error DirectTransferBlocked();

    /// @notice The event does not exist.
    error EventNotFound(uint32 eventId);

    /// @notice The event has sold out.
    error EventSoldOut(uint32 eventId);

    /// @notice The event is not active or has already passed.
    error EventNotActive(uint32 eventId);

    /// @notice The caller or buyer already holds the maximum tickets for this event.
    error WalletCapReached(uint32 eventId, address wallet);

    /// @notice The wrong ETH amount was sent.
    error IncorrectPayment(uint256 sent, uint256 expected);

    /// @notice The ticket has already been used (checked in).
    error TicketAlreadyUsed(uint256 tokenId);

    /// @notice The token does not exist.
    error TokenNotFound(uint256 tokenId);

    /// @notice There is no active listing for this token.
    error NotListed(uint256 tokenId);

    /// @notice The caller is not the token owner.
    error NotOwner(uint256 tokenId, address caller);

    /// @notice No ETH balance to withdraw.
    error NothingToWithdraw();

    /// @notice ETH withdrawal failed.
    error WithdrawFailed();

    // ─────────────────────────────────────────────────────────────────────────
    // Data Structures
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Describes a single ticketed event.
     * @param name          Human-readable event name.
     * @param ticketPrice   Face value in wei.
     * @param maxSupply     Total tickets available.
     * @param minted        Number of tickets minted so far.
     * @param maxResaleBps  Maximum resale price as basis points of face value
     *                      (e.g. 11000 = 110%).
     * @param royaltyBps    Organizer's cut of every resale, in basis points
     *                      (max 1000 = 10%).
     * @param eventTime     Unix timestamp of the event start.
     * @param maxPerWallet  Maximum tickets any one wallet may hold for this event.
     * @param active        Whether the event is accepting new ticket sales.
     */
    struct Event {
        string  name;
        uint256 ticketPrice;
        uint32  maxSupply;
        uint32  minted;
        uint32  maxResaleBps;
        uint16  royaltyBps;
        uint64  eventTime;
        uint8   maxPerWallet;
        bool    active;
    }

    /**
     * @notice A resale listing created by a ticket holder.
     * @param seller  Address of the seller.
     * @param price   Asking price in wei.
     * @param active  True while the listing is open.
     */
    struct Listing {
        address seller;
        uint256 price;
        bool    active;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev The deployer / organizer address. Immutable after construction.
    address private immutable _deployer;

    /// @dev Auto-incrementing event counter.
    uint32 private _nextEventId;

    /// @dev Auto-incrementing token counter.
    uint256 private _nextTokenId;

    /// @notice eventId → Event struct.
    mapping(uint32 => Event) private _events;

    /// @notice tokenId → eventId.
    mapping(uint256 => uint32) public ticketEvent;

    /// @notice tokenId → original face-value price paid (never changes after mint).
    mapping(uint256 => uint256) public originalPrice;

    /// @notice tokenId → whether the ticket has been checked in.
    mapping(uint256 => bool) public used;

    /// @notice tokenId → Listing.
    mapping(uint256 => Listing) private _listings;

    /// @notice address → claimable ETH balance (pull-payment pattern).
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice eventId → owner → tickets held for that event (for per-wallet cap).
    mapping(uint32 => mapping(address => uint256)) private _eventWalletBalance;

    /// @dev Set to true only during buyResale to allow the internal _update call.
    bool private _inMarketplaceTransfer;

    // ─────────────────────────────────────────────────────────────────────────
    // Events (log)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a new event is created.
    event EventCreated(
        uint32 indexed eventId,
        string name,
        uint256 ticketPrice,
        uint32 maxSupply,
        uint64 eventTime
    );

    /// @notice Emitted when a ticket is minted.
    event TicketMinted(
        uint32 indexed eventId,
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 price
    );

    /// @notice Emitted when a ticket is listed for resale.
    event Listed(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price
    );

    /// @notice Emitted when a resale listing is cancelled.
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);

    /// @notice Emitted when a resale completes.
    event Resold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 royalty
    );

    /// @notice Emitted when a ticket is checked in at the door.
    event CheckedIn(uint256 indexed tokenId, address indexed checker);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deploys the contract and grants DEFAULT_ADMIN_ROLE to the deployer.
     *         The deployer is also recorded as the permanent organizer address
     *         for revenue routing (pendingWithdrawals).
     */
    constructor() ERC721("TicketNFT", "TCKT") {
        _deployer = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Management
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Creates a new ticketed event. Only the organizer may call this.
     * @param name_         Human-readable event name.
     * @param ticketPrice_  Face value per ticket in wei.
     * @param maxSupply_    Total ticket supply.
     * @param maxResaleBps_ Maximum resale price in basis points of face value.
     * @param royaltyBps_   Organizer's royalty cut in basis points (max 1000).
     * @param eventTime_    Unix timestamp when the event starts.
     * @param maxPerWallet_ Maximum tickets any single wallet may hold.
     * @return eventId      The ID assigned to the newly created event.
     */
    function createEvent(
        string  calldata name_,
        uint256 ticketPrice_,
        uint32  maxSupply_,
        uint32  maxResaleBps_,
        uint16  royaltyBps_,
        uint64  eventTime_,
        uint8   maxPerWallet_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint32 eventId) {
        require(royaltyBps_    <= 1000,              "TicketNFT: royaltyBps > 1000");
        require(maxSupply_     > 0,                  "TicketNFT: maxSupply must be > 0");
        require(maxPerWallet_  > 0,                  "TicketNFT: maxPerWallet must be > 0");
        require(eventTime_     > block.timestamp,    "TicketNFT: event already past");

        eventId = _nextEventId++;

        _events[eventId] = Event({
            name:         name_,
            ticketPrice:  ticketPrice_,
            maxSupply:    maxSupply_,
            minted:       0,
            maxResaleBps: maxResaleBps_,
            royaltyBps:   royaltyBps_,
            eventTime:    eventTime_,
            maxPerWallet: maxPerWallet_,
            active:       true
        });

        emit EventCreated(eventId, name_, ticketPrice_, maxSupply_, eventTime_);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Primary Sale — Mint
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mints one ticket for the given event. Exact payment required.
     * @dev    Revenue is credited to the organizer via pendingWithdrawals.
     * @param eventId The event to purchase a ticket for.
     */
    function mintTicket(uint32 eventId) external payable {
        Event storage ev = _requireActiveEvent(eventId);

        if (msg.value != ev.ticketPrice)
            revert IncorrectPayment(msg.value, ev.ticketPrice);

        if (ev.minted >= ev.maxSupply)
            revert EventSoldOut(eventId);

        if (_eventWalletBalance[eventId][msg.sender] >= ev.maxPerWallet)
            revert WalletCapReached(eventId, msg.sender);

        uint256 tokenId = _nextTokenId++;
        ev.minted++;
        ticketEvent[tokenId]   = eventId;
        originalPrice[tokenId] = msg.value;
        _eventWalletBalance[eventId][msg.sender]++;

        // Revenue accrues to the organizer (deployer) via pull payment.
        pendingWithdrawals[_deployer] += msg.value;

        _safeMint(msg.sender, tokenId);

        emit TicketMinted(eventId, tokenId, msg.sender, msg.value);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Anti-Scalping: Transfer Block
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Overrides ERC-721's internal transfer hook to block all direct
     *      wallet-to-wallet transfers. Mints (from == address(0)) are always
     *      allowed. The only exception for non-zero→non-zero moves is
     *      buyResale, which sets _inMarketplaceTransfer = true for the duration
     *      of the call.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // Block peer-to-peer transfers; allow mints (from == address(0)).
        if (from != address(0) && !_inMarketplaceTransfer) {
            revert DirectTransferBlocked();
        }

        return super._update(to, tokenId, auth);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resale Marketplace
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Lists a ticket for resale at the given price.
     * @dev    Price is capped at originalPrice * maxResaleBps / 10000.
     *         Reverts with {PriceAboveCap} if the cap is exceeded.
     * @param tokenId The ticket to list.
     * @param price   Asking price in wei.
     */
    function listForResale(uint256 tokenId, uint256 price) external {
        _requireExists(tokenId);

        if (ownerOf(tokenId) != msg.sender)
            revert NotOwner(tokenId, msg.sender);

        if (used[tokenId])
            revert TicketAlreadyUsed(tokenId);

        uint32 eventId = ticketEvent[tokenId];
        Event storage ev = _events[eventId];

        if (!ev.active || block.timestamp >= ev.eventTime)
            revert EventNotActive(eventId);

        uint256 cap = (originalPrice[tokenId] * ev.maxResaleBps) / 10_000;
        if (price > cap)
            revert PriceAboveCap(price, cap);

        _listings[tokenId] = Listing({seller: msg.sender, price: price, active: true});

        emit Listed(tokenId, msg.sender, price);
    }

    /**
     * @notice Cancels an active resale listing.
     * @param tokenId The ticket to delist.
     */
    function cancelListing(uint256 tokenId) external {
        _requireExists(tokenId);

        if (ownerOf(tokenId) != msg.sender)
            revert NotOwner(tokenId, msg.sender);

        Listing storage lst = _listings[tokenId];
        if (!lst.active) revert NotListed(tokenId);

        lst.active = false;

        emit ListingCancelled(tokenId, msg.sender);
    }

    /**
     * @notice Purchases a resale ticket. Exact payment required.
     * @dev    Royalty is credited to the organizer; remainder to the seller.
     *         Both via pendingWithdrawals (pull pattern). The NFT is transferred
     *         using the marketplace flag so the anti-scalping hook allows it.
     *         originalPrice is intentionally preserved so the resale cap always
     *         refers back to the original face value.
     * @param tokenId The ticket to purchase.
     */
    function buyResale(uint256 tokenId) external payable nonReentrant {
        _requireExists(tokenId);

        Listing storage lst = _listings[tokenId];
        if (!lst.active) revert NotListed(tokenId);

        if (msg.value != lst.price)
            revert IncorrectPayment(msg.value, lst.price);

        uint32 eventId = ticketEvent[tokenId];
        Event storage ev = _events[eventId];

        if (!ev.active || block.timestamp >= ev.eventTime)
            revert EventNotActive(eventId);

        // Enforce per-wallet cap for the buyer.
        if (_eventWalletBalance[eventId][msg.sender] >= ev.maxPerWallet)
            revert WalletCapReached(eventId, msg.sender);

        address seller = lst.seller;

        // Calculate royalty split.
        uint256 royalty         = (msg.value * ev.royaltyBps) / 10_000;
        uint256 sellerProceeds  = msg.value - royalty;

        // Clear listing before any state changes (CEI pattern).
        lst.active = false;

        // Update per-wallet event balances.
        _eventWalletBalance[eventId][seller]--;
        _eventWalletBalance[eventId][msg.sender]++;

        // Credit both parties via pull payment.
        pendingWithdrawals[seller]    += sellerProceeds;
        pendingWithdrawals[_deployer] += royalty;

        // Transfer the NFT through the marketplace bypass.
        _inMarketplaceTransfer = true;
        _transfer(seller, msg.sender, tokenId);
        _inMarketplaceTransfer = false;

        ERC721Utils.checkOnERC721Received(_msgSender(), seller, msg.sender, tokenId, "");

        emit Resold(tokenId, seller, msg.sender, msg.value, royalty);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Entry & Validation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Checks a ticket in at the door. Only callable by CHECKER_ROLE.
     * @dev    Automatically cancels any active listing for the token.
     * @param tokenId The ticket to check in.
     */
    function checkIn(uint256 tokenId) external onlyRole(CHECKER_ROLE) {
        _requireExists(tokenId);

        if (used[tokenId])
            revert TicketAlreadyUsed(tokenId);

        uint32 eventId = ticketEvent[tokenId];
        if (!_events[eventId].active)
            revert EventNotActive(eventId);

        used[tokenId] = true;

        // Clear any open listing so a used ticket cannot be resold.
        if (_listings[tokenId].active) {
            address seller = ownerOf(tokenId);
            _listings[tokenId].active = false;
            emit ListingCancelled(tokenId, seller);
        }

        emit CheckedIn(tokenId, msg.sender);
    }

    /**
     * @notice Returns true if a ticket exists and has not yet been checked in.
     * @param tokenId The token to query.
     */
    function isValid(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0) && !used[tokenId];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdrawals (Pull Payment)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Withdraws the caller's accumulated ETH balance.
     * @dev    Uses the pull-payment pattern to avoid re-entrancy from push payments.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert WithdrawFailed();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Token URI — On-Chain Base64 JSON
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns a base64-encoded JSON metadata URI stored entirely on-chain.
     *         No IPFS or external service required.
     * @param tokenId The token to query.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        _requireExists(tokenId);

        uint32 eventId    = ticketEvent[tokenId];
        string memory evName = _events[eventId].name;
        string memory status = used[tokenId] ? "Used" : "Valid";

        string memory json = string.concat(
            '{"name":"Ticket #',
            tokenId.toString(),
            " \xe2\x80\x94 ",
            evName,
            '","description":"NFT Event Ticket issued on-chain.","attributes":[',
            '{"trait_type":"Event","value":"', evName, '"},',
            '{"trait_type":"Token ID","value":"', tokenId.toString(), '"},',
            '{"trait_type":"Event ID","value":"', uint256(eventId).toString(), '"},',
            '{"trait_type":"Status","value":"', status, '"}',
            ']}'
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Getters
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the full Event struct for a given event ID.
     * @param eventId The event to query.
     */
    function getEvent(uint32 eventId) external view returns (Event memory) {
        if (eventId >= _nextEventId) revert EventNotFound(eventId);
        return _events[eventId];
    }

    /**
     * @notice Returns the listing for a given token ID.
     * @param tokenId The token to query.
     */
    function getListing(uint256 tokenId) external view returns (Listing memory) {
        return _listings[tokenId];
    }

    /**
     * @notice Returns the total number of events created.
     */
    function totalEvents() external view returns (uint32) {
        return _nextEventId;
    }

    /**
     * @notice Returns the total number of tokens minted across all events.
     */
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @notice Returns how many tickets a wallet holds for a specific event.
     * @param eventId The event to query.
     * @param wallet  The wallet to query.
     */
    function walletBalance(uint32 eventId, address wallet)
        external
        view
        returns (uint256)
    {
        return _eventWalletBalance[eventId][wallet];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // supportsInterface
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Merges ERC721 and AccessControl interface declarations.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Loads the event and reverts if it does not exist or is not active / future.
     */
    function _requireActiveEvent(uint32 eventId)
        private
        view
        returns (Event storage ev)
    {
        if (eventId >= _nextEventId) revert EventNotFound(eventId);
        ev = _events[eventId];
        if (!ev.active || block.timestamp >= ev.eventTime)
            revert EventNotActive(eventId);
    }

    /**
     * @dev Reverts if the token has not been minted (owner is zero address).
     */
    function _requireExists(uint256 tokenId) private view {
        if (_ownerOf(tokenId) == address(0)) revert TokenNotFound(tokenId);
    }
}
