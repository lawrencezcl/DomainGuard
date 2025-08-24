import { ethers } from 'ethers';
import EventEmitter from 'events';
import { logger, logContractEvent } from '../utils/logger.js';

// Doma Contract ABIs (simplified for demo)
const DOMA_EXPIRY_ABI = [
  "event DomainExpiring(address indexed owner, string indexed domain, uint256 expiryTime)",
  "event DomainExpired(address indexed owner, string indexed domain, uint256 expiredAt)",
  "function getDomainExpiry(string memory domain) view returns (uint256)",
  "function renewDomain(string memory domain, uint256 duration) payable"
];

const DOMA_TRADE_ABI = [
  "event DomainListed(address indexed seller, string indexed domain, uint256 price, uint256 listedAt)",
  "event DomainSold(address indexed seller, address indexed buyer, string indexed domain, uint256 price, uint256 soldAt)",
  "event DomainPriceChanged(address indexed seller, string indexed domain, uint256 oldPrice, uint256 newPrice)",
  "event DomainDelisted(address indexed seller, string indexed domain, uint256 delistedAt)",
  "function listDomain(string memory domain, uint256 price) external",
  "function buyDomain(string memory domain) payable external",
  "function getDomainPrice(string memory domain) view returns (uint256)"
];

const DOMA_OWNERSHIP_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event DomainTransferred(address indexed from, address indexed to, string indexed domain, uint256 transferredAt)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getDomainOwner(string memory domain) view returns (address)",
  "function transferDomain(address to, string memory domain) external"
];

const DOMA_PREAUTH_ABI = [
  "event PreAuthorizationSet(address indexed user, uint256 monthlyLimit, uint256 setAt)",
  "event AutoActionExecuted(address indexed user, string action, string domain, uint256 amount, bool success)",
  "function setMonthlyLimit(uint256 limit) external",
  "function executeAutoAction(address user, string memory action, string memory domain, uint256 amount) external returns (bool)"
];

export class ContractMonitor extends EventEmitter {
  constructor() {
    super();
    this.provider = null;
    this.contracts = {};
    this.isRunning = false;
    this.filters = new Map();
    this.lastProcessedBlocks = new Map();
  }

  async initialize() {
    try {
      logger.info('🔗 Initializing contract monitor...');

      // Setup provider
      this.provider = new ethers.JsonRpcProvider(process.env.DOMA_TESTNET_RPC_URL);
      
      // Test connection
      await this.provider.getNetwork();
      logger.info('✅ Connected to Doma Testnet');

      // Initialize contracts
      await this.initializeContracts();

      // Setup event listeners
      await this.setupEventListeners();

      this.isRunning = true;
      logger.info('✅ Contract monitor initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize contract monitor:', error);
      throw error;
    }
  }

  async initializeContracts() {
    try {
      // Expiry Contract
      this.contracts.expiry = new ethers.Contract(
        process.env.DOMA_EXPIRY_CONTRACT_ADDRESS,
        DOMA_EXPIRY_ABI,
        this.provider
      );

      // Trade Contract
      this.contracts.trade = new ethers.Contract(
        process.env.DOMA_TRADE_CONTRACT_ADDRESS,
        DOMA_TRADE_ABI,
        this.provider
      );

      // Ownership Contract
      this.contracts.ownership = new ethers.Contract(
        process.env.DOMA_OWNERSHIP_CONTRACT_ADDRESS,
        DOMA_OWNERSHIP_ABI,
        this.provider
      );

      // Pre-Authorization Contract
      this.contracts.preauth = new ethers.Contract(
        process.env.DOMA_PREAUTH_CONTRACT_ADDRESS,
        DOMA_PREAUTH_ABI,
        this.provider
      );

      logger.info('✅ Contracts initialized', {
        expiry: process.env.DOMA_EXPIRY_CONTRACT_ADDRESS,
        trade: process.env.DOMA_TRADE_CONTRACT_ADDRESS,
        ownership: process.env.DOMA_OWNERSHIP_CONTRACT_ADDRESS,
        preauth: process.env.DOMA_PREAUTH_CONTRACT_ADDRESS
      });
    } catch (error) {
      logger.error('Failed to initialize contracts:', error);
      throw error;
    }
  }

  async setupEventListeners() {
    try {
      // Domain Expiry Events
      const expiryFilter = this.contracts.expiry.filters.DomainExpiring();
      this.contracts.expiry.on(expiryFilter, this.handleDomainExpiring.bind(this));
      this.filters.set('expiry', expiryFilter);

      // Domain Sale Events
      const saleFilter = this.contracts.trade.filters.DomainSold();
      this.contracts.trade.on(saleFilter, this.handleDomainSold.bind(this));
      this.filters.set('sale', saleFilter);

      const listingFilter = this.contracts.trade.filters.DomainListed();
      this.contracts.trade.on(listingFilter, this.handleDomainListed.bind(this));
      this.filters.set('listing', listingFilter);

      const priceChangeFilter = this.contracts.trade.filters.DomainPriceChanged();
      this.contracts.trade.on(priceChangeFilter, this.handleDomainPriceChanged.bind(this));
      this.filters.set('priceChange', priceChangeFilter);

      // Domain Transfer Events
      const transferFilter = this.contracts.ownership.filters.DomainTransferred();
      this.contracts.ownership.on(transferFilter, this.handleDomainTransferred.bind(this));
      this.filters.set('transfer', transferFilter);

      // Auto Action Events
      const autoActionFilter = this.contracts.preauth.filters.AutoActionExecuted();
      this.contracts.preauth.on(autoActionFilter, this.handleAutoActionExecuted.bind(this));
      this.filters.set('autoAction', autoActionFilter);

      logger.info('✅ Event listeners setup complete');
    } catch (error) {
      logger.error('Failed to setup event listeners:', error);
      throw error;
    }
  }

  // Event Handlers
  async handleDomainExpiring(owner, domain, expiryTime, event) {
    try {
      const eventData = {
        owner,
        domain,
        expiryTime: Number(expiryTime),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        blockHash: event.blockHash
      };

      logContractEvent('DomainExpiring', this.contracts.expiry.target, eventData);

      // Calculate days until expiry
      const now = Math.floor(Date.now() / 1000);
      const daysUntilExpiry = Math.ceil((Number(expiryTime) - now) / 86400);

      // Emit event for alert service
      this.emit('domainExpiry', {
        type: 'expiry',
        domain,
        owner,
        expiryTime: Number(expiryTime),
        daysUntilExpiry,
        urgency: daysUntilExpiry <= 1 ? 'critical' : daysUntilExpiry <= 3 ? 'high' : 'medium',
        blockData: {
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        }
      });
    } catch (error) {
      logger.error('Error handling domain expiring event:', error);
    }
  }

  async handleDomainSold(seller, buyer, domain, price, soldAt, event) {
    try {
      const eventData = {
        seller,
        buyer,
        domain,
        price: ethers.formatEther(price),
        soldAt: Number(soldAt),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      logContractEvent('DomainSold', this.contracts.trade.target, eventData);

      this.emit('domainSale', {
        type: 'sale',
        domain,
        seller,
        buyer,
        price: ethers.formatEther(price),
        soldAt: Number(soldAt),
        blockData: {
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        }
      });
    } catch (error) {
      logger.error('Error handling domain sold event:', error);
    }
  }

  async handleDomainListed(seller, domain, price, listedAt, event) {
    try {
      const eventData = {
        seller,
        domain,
        price: ethers.formatEther(price),
        listedAt: Number(listedAt),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      logContractEvent('DomainListed', this.contracts.trade.target, eventData);

      this.emit('domainSale', {
        type: 'listing',
        domain,
        seller,
        price: ethers.formatEther(price),
        listedAt: Number(listedAt),
        blockData: {
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        }
      });
    } catch (error) {
      logger.error('Error handling domain listed event:', error);
    }
  }

  async handleDomainPriceChanged(seller, domain, oldPrice, newPrice, event) {
    try {
      const eventData = {
        seller,
        domain,
        oldPrice: ethers.formatEther(oldPrice),
        newPrice: ethers.formatEther(newPrice),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      logContractEvent('DomainPriceChanged', this.contracts.trade.target, eventData);

      this.emit('domainSale', {
        type: 'priceChange',
        domain,
        seller,
        oldPrice: ethers.formatEther(oldPrice),
        newPrice: ethers.formatEther(newPrice),
        blockData: {
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        }
      });
    } catch (error) {
      logger.error('Error handling domain price changed event:', error);
    }
  }

  async handleDomainTransferred(from, to, domain, transferredAt, event) {
    try {
      const eventData = {
        from,
        to,
        domain,
        transferredAt: Number(transferredAt),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      logContractEvent('DomainTransferred', this.contracts.ownership.target, eventData);

      this.emit('domainTransfer', {
        type: 'transfer',
        domain,
        from,
        to,
        transferredAt: Number(transferredAt),
        blockData: {
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        }
      });
    } catch (error) {
      logger.error('Error handling domain transferred event:', error);
    }
  }

  async handleAutoActionExecuted(user, action, domain, amount, success, event) {
    try {
      const eventData = {
        user,
        action,
        domain,
        amount: ethers.formatEther(amount),
        success,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash
      };

      logContractEvent('AutoActionExecuted', this.contracts.preauth.target, eventData);

      this.emit('autoAction', {
        type: 'autoAction',
        user,
        action,
        domain,
        amount: ethers.formatEther(amount),
        success,
        blockData: {
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        }
      });
    } catch (error) {
      logger.error('Error handling auto action executed event:', error);
    }
  }

  // Contract interaction methods
  async getDomainExpiry(domain) {
    try {
      const expiryTime = await this.contracts.expiry.getDomainExpiry(domain);
      return Number(expiryTime);
    } catch (error) {
      logger.error(`Failed to get domain expiry for ${domain}:`, error);
      throw error;
    }
  }

  async getDomainPrice(domain) {
    try {
      const price = await this.contracts.trade.getDomainPrice(domain);
      return ethers.formatEther(price);
    } catch (error) {
      logger.error(`Failed to get domain price for ${domain}:`, error);
      throw error;
    }
  }

  async getDomainOwner(domain) {
    try {
      return await this.contracts.ownership.getDomainOwner(domain);
    } catch (error) {
      logger.error(`Failed to get domain owner for ${domain}:`, error);
      throw error;
    }
  }

  // Historical event scanning
  async scanHistoricalEvents(fromBlock, toBlock = 'latest') {
    try {
      logger.info('📊 Scanning historical events...', { fromBlock, toBlock });

      const eventPromises = [];

      // Scan expiry events
      eventPromises.push(
        this.contracts.expiry.queryFilter(
          this.contracts.expiry.filters.DomainExpiring(),
          fromBlock,
          toBlock
        )
      );

      // Scan sale events
      eventPromises.push(
        this.contracts.trade.queryFilter(
          this.contracts.trade.filters.DomainSold(),
          fromBlock,
          toBlock
        )
      );

      // Scan transfer events
      eventPromises.push(
        this.contracts.ownership.queryFilter(
          this.contracts.ownership.filters.DomainTransferred(),
          fromBlock,
          toBlock
        )
      );

      const [expiryEvents, saleEvents, transferEvents] = await Promise.all(eventPromises);

      // Process historical events
      for (const event of expiryEvents) {
        await this.handleDomainExpiring(...event.args, event);
      }

      for (const event of saleEvents) {
        await this.handleDomainSold(...event.args, event);
      }

      for (const event of transferEvents) {
        await this.handleDomainTransferred(...event.args, event);
      }

      logger.info('✅ Historical event scan completed', {
        expiryEvents: expiryEvents.length,
        saleEvents: saleEvents.length,
        transferEvents: transferEvents.length
      });
    } catch (error) {
      logger.error('Failed to scan historical events:', error);
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      const network = await this.provider.getNetwork();
      
      return {
        status: 'healthy',
        blockNumber,
        networkId: network.chainId.toString(),
        contractAddresses: {
          expiry: this.contracts.expiry.target,
          trade: this.contracts.trade.target,
          ownership: this.contracts.ownership.target,
          preauth: this.contracts.preauth.target
        },
        isRunning: this.isRunning
      };
    } catch (error) {
      logger.error('Contract monitor health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        isRunning: this.isRunning
      };
    }
  }

  // Stop monitoring
  async stop() {
    try {
      logger.info('🛑 Stopping contract monitor...');

      // Remove all event listeners
      for (const [name, filter] of this.filters) {
        this.contracts[name.split('.')[0]]?.removeAllListeners(filter);
      }

      this.isRunning = false;
      this.removeAllListeners();

      logger.info('✅ Contract monitor stopped');
    } catch (error) {
      logger.error('Error stopping contract monitor:', error);
      throw error;
    }
  }
}