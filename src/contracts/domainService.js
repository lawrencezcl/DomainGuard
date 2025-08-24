import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

export class DomainService {
  constructor(contractMonitor) {
    this.contractMonitor = contractMonitor;
    this.provider = contractMonitor.provider;
    this.contracts = contractMonitor.contracts;
  }

  // Get comprehensive domain information
  async getDomainInfo(domain) {
    try {
      const [owner, expiryTime, price, isForSale] = await Promise.allSettled([
        this.contracts.ownership.getDomainOwner(domain),
        this.contracts.expiry.getDomainExpiry(domain),
        this.contracts.trade.getDomainPrice(domain).catch(() => null),
        this.isDomainForSale(domain)
      ]);

      const result = {
        domain,
        owner: owner.status === 'fulfilled' ? owner.value : null,
        expiryTime: expiryTime.status === 'fulfilled' ? Number(expiryTime.value) : null,
        price: price.status === 'fulfilled' && price.value ? ethers.formatEther(price.value) : null,
        isForSale: isForSale.status === 'fulfilled' ? isForSale.value : false,
        lastUpdated: new Date().toISOString()
      };

      // Calculate expiry status
      if (result.expiryTime) {
        const now = Math.floor(Date.now() / 1000);
        const daysUntilExpiry = Math.ceil((result.expiryTime - now) / 86400);
        
        result.expiryStatus = {
          daysUntilExpiry,
          isExpired: daysUntilExpiry <= 0,
          isExpiringSoon: daysUntilExpiry <= 7,
          urgency: daysUntilExpiry <= 1 ? 'critical' : 
                   daysUntilExpiry <= 3 ? 'high' : 
                   daysUntilExpiry <= 7 ? 'medium' : 'low'
        };
      }

      return result;
    } catch (error) {
      logger.error(`Failed to get domain info for ${domain}:`, error);
      throw error;
    }
  }

  // Check if domain is currently for sale
  async isDomainForSale(domain) {
    try {
      const price = await this.contracts.trade.getDomainPrice(domain);
      return price > 0;
    } catch (error) {
      return false;
    }
  }

  // Renew domain (requires wallet/signer)
  async renewDomain(domain, duration, signer) {
    try {
      const contractWithSigner = this.contracts.expiry.connect(signer);
      
      // Estimate gas
      const gasEstimate = await contractWithSigner.renewDomain.estimateGas(domain, duration);
      
      // Execute transaction
      const tx = await contractWithSigner.renewDomain(domain, duration, {
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      });

      logger.info('Domain renewal transaction sent', {
        domain,
        duration,
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      logger.info('Domain renewal confirmed', {
        domain,
        duration,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error(`Failed to renew domain ${domain}:`, error);
      throw error;
    }
  }

  // Buy domain
  async buyDomain(domain, signer) {
    try {
      const price = await this.contracts.trade.getDomainPrice(domain);
      if (price === 0n) {
        throw new Error('Domain is not for sale');
      }

      const contractWithSigner = this.contracts.trade.connect(signer);
      
      // Estimate gas
      const gasEstimate = await contractWithSigner.buyDomain.estimateGas(domain, {
        value: price
      });
      
      // Execute transaction
      const tx = await contractWithSigner.buyDomain(domain, {
        value: price,
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      });

      logger.info('Domain purchase transaction sent', {
        domain,
        price: ethers.formatEther(price),
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      logger.info('Domain purchase confirmed', {
        domain,
        price: ethers.formatEther(price),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        pricePaid: ethers.formatEther(price)
      };
    } catch (error) {
      logger.error(`Failed to buy domain ${domain}:`, error);
      throw error;
    }
  }

  // List domain for sale
  async listDomain(domain, price, signer) {
    try {
      const contractWithSigner = this.contracts.trade.connect(signer);
      const priceInWei = ethers.parseEther(price.toString());
      
      // Estimate gas
      const gasEstimate = await contractWithSigner.listDomain.estimateGas(domain, priceInWei);
      
      // Execute transaction
      const tx = await contractWithSigner.listDomain(domain, priceInWei, {
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      });

      logger.info('Domain listing transaction sent', {
        domain,
        price,
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      logger.info('Domain listing confirmed', {
        domain,
        price,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error(`Failed to list domain ${domain}:`, error);
      throw error;
    }
  }

  // Transfer domain
  async transferDomain(domain, toAddress, signer) {
    try {
      const contractWithSigner = this.contracts.ownership.connect(signer);
      
      // Estimate gas
      const gasEstimate = await contractWithSigner.transferDomain.estimateGas(toAddress, domain);
      
      // Execute transaction
      const tx = await contractWithSigner.transferDomain(toAddress, domain, {
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      });

      logger.info('Domain transfer transaction sent', {
        domain,
        toAddress,
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      logger.info('Domain transfer confirmed', {
        domain,
        toAddress,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error(`Failed to transfer domain ${domain}:`, error);
      throw error;
    }
  }

  // Set monthly spending limit for auto-actions
  async setMonthlyLimit(limit, signer) {
    try {
      const contractWithSigner = this.contracts.preauth.connect(signer);
      const limitInWei = ethers.parseEther(limit.toString());
      
      // Estimate gas
      const gasEstimate = await contractWithSigner.setMonthlyLimit.estimateGas(limitInWei);
      
      // Execute transaction
      const tx = await contractWithSigner.setMonthlyLimit(limitInWei, {
        gasLimit: gasEstimate * 120n / 100n // 20% buffer
      });

      logger.info('Monthly limit set transaction sent', {
        limit,
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      logger.info('Monthly limit set confirmed', {
        limit,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error(`Failed to set monthly limit:`, error);
      throw error;
    }
  }

  // Execute auto action (for authorized auto-actions)
  async executeAutoAction(userAddress, action, domain, amount, adminSigner) {
    try {
      const contractWithSigner = this.contracts.preauth.connect(adminSigner);
      const amountInWei = ethers.parseEther(amount.toString());
      
      // Estimate gas
      const gasEstimate = await contractWithSigner.executeAutoAction.estimateGas(
        userAddress, action, domain, amountInWei
      );
      
      // Execute transaction
      const tx = await contractWithSigner.executeAutoAction(
        userAddress, action, domain, amountInWei, {
          gasLimit: gasEstimate * 120n / 100n // 20% buffer
        }
      );

      logger.info('Auto action execution transaction sent', {
        userAddress,
        action,
        domain,
        amount,
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      logger.info('Auto action execution confirmed', {
        userAddress,
        action,
        domain,
        amount,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      logger.error(`Failed to execute auto action:`, error);
      throw error;
    }
  }

  // Get transaction receipt and status
  async getTransactionStatus(txHash) {
    try {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return { status: 'pending', receipt: null };
      }

      return {
        status: receipt.status === 1 ? 'success' : 'failed',
        receipt: {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
          logs: receipt.logs.length
        }
      };
    } catch (error) {
      logger.error(`Failed to get transaction status for ${txHash}:`, error);
      return { status: 'error', error: error.message };
    }
  }

  // Estimate gas costs for operations
  async estimateGasCosts() {
    try {
      const gasPrice = await this.provider.getFeeData();
      
      // Rough estimates for different operations
      const operations = {
        renewDomain: 100000n,
        buyDomain: 150000n,
        listDomain: 80000n,
        transferDomain: 70000n,
        setMonthlyLimit: 50000n
      };

      const estimates = {};
      for (const [operation, gasLimit] of Object.entries(operations)) {
        const cost = gasLimit * gasPrice.gasPrice;
        estimates[operation] = {
          gasLimit: gasLimit.toString(),
          gasPrice: gasPrice.gasPrice.toString(),
          estimatedCost: ethers.formatEther(cost),
          estimatedCostWei: cost.toString()
        };
      }

      return estimates;
    } catch (error) {
      logger.error('Failed to estimate gas costs:', error);
      throw error;
    }
  }

  // Validate domain name format
  validateDomainName(domain) {
    // Basic domain validation (adjust based on Doma's rules)
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
    
    if (!domainRegex.test(domain)) {
      return { valid: false, error: 'Invalid domain format' };
    }

    if (domain.length < 3 || domain.length > 63) {
      return { valid: false, error: 'Domain length must be between 3 and 63 characters' };
    }

    return { valid: true };
  }

  // Check if user has sufficient balance for operation
  async checkUserBalance(userAddress, requiredAmount) {
    try {
      const balance = await this.provider.getBalance(userAddress);
      const required = ethers.parseEther(requiredAmount.toString());
      
      return {
        balance: ethers.formatEther(balance),
        required: requiredAmount.toString(),
        sufficient: balance >= required
      };
    } catch (error) {
      logger.error(`Failed to check balance for ${userAddress}:`, error);
      throw error;
    }
  }
}