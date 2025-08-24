# DomaAlert Bot 🚀

**Built for Track 3: Bots & Event Subscriptions — Powering Doma's DomainFi Ecosystem with Smarter Alerts & Automated Action**

DomaAlert Bot is your 24/7 domain assistant for the Doma Protocol ecosystem. Never miss a domain expiry, high-value sale, or ownership change again!

## 🎯 Key Features

- **Real-Time Alerts**: Domain expiry, sales, and ownership changes
- **Multi-Platform**: Telegram and Twitter/X bot integration
- **Subscription Tiers**: Free, Basic ($5/month), Premium ($20/month)
- **Auto-Actions**: Automated renewal, buying, and bidding
- **Doma Integration**: Direct integration with Doma Testnet contracts
- **Web Dashboard**: React-based subscription and alert management

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Telegram Bot Token (from @BotFather)
- Twitter API credentials
- Doma Testnet access

### Installation

1. **Clone and setup:**
```bash
git clone <repository-url>
cd DomainGuard
npm run setup
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

3. **Initialize database:**
```bash
npm run migrate
```

4. **Start development servers:**
```bash
# Backend
npm run dev

# Frontend (in another terminal)
npm run dev:frontend
```

## 📁 Project Structure

```
DomainGuard/
├── src/
│   ├── bots/           # Telegram & Twitter bot implementations
│   ├── contracts/      # Doma smart contract integrations
│   ├── database/       # Database models and migrations
│   ├── services/       # Core business logic
│   ├── routes/         # API endpoints
│   ├── middleware/     # Authentication, rate limiting, etc.
│   ├── utils/          # Helper functions
│   └── index.js        # Main server entry point
├── frontend/           # React web dashboard
├── tests/              # Test suites
├── docs/               # Documentation
└── docker/             # Containerization
```

## 🤖 Bot Commands

### Telegram Bot
- `/start` - Initialize your account
- `/alerts` - View your active alerts
- `/subscribe` - Manage subscription
- `/monitor` - Add domain monitoring
- `/settings` - Configure preferences

### Twitter Bot
- Mention `@DomaAlertBot monitor domain.tld` - Start monitoring
- Daily `#DomaAlert` opportunity threads
- Success story retweets

## 💳 Subscription Tiers

| Feature | Free | Basic ($5/mo) | Premium ($20/mo) |
|---------|------|---------------|------------------|
| Domain Monitoring | 5 domains | 20 domains | Unlimited |
| Alert Frequency | Daily | Real-time | Real-time |
| Auto-Actions | ❌ | ❌ | ✅ |
| Custom Filters | Basic | Advanced | Advanced |
| Priority Support | ❌ | ❌ | ✅ |

## 🔧 Configuration

### Doma Contract Integration

Update these contract addresses in your `.env`:

```env
DOMA_EXPIRY_CONTRACT_ADDRESS=0x...
DOMA_TRADE_CONTRACT_ADDRESS=0x...
DOMA_OWNERSHIP_CONTRACT_ADDRESS=0x...
```

### Alert Types

1. **Domain Expiry**: Triggers 1/3/7 days before expiration
2. **High-Value Sales**: Monitors sales above your threshold
3. **Ownership Changes**: Tracks transfers of monitored domains

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## 🐳 Docker Deployment

```bash
# Build image
npm run docker:build

# Run container
npm run docker:run
```

## 🛠️ Development

### Adding New Alert Types

1. Create contract listener in `src/contracts/`
2. Add alert processor in `src/services/alerts/`
3. Update bot handlers in `src/bots/`
4. Add tests in `tests/`

### Database Migrations

```bash
# Create new migration
node src/database/create-migration.js migration_name

# Run migrations
npm run migrate
```

## 📊 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/me` - Get current user

### Alerts
- `GET /api/alerts` - List user alerts
- `POST /api/alerts` - Create new alert
- `PUT /api/alerts/:id` - Update alert
- `DELETE /api/alerts/:id` - Delete alert

### Subscriptions
- `GET /api/subscriptions` - Get subscription status
- `POST /api/subscriptions/upgrade` - Upgrade subscription
- `POST /api/subscriptions/cancel` - Cancel subscription

## 🔒 Security Features

- JWT authentication
- Rate limiting
- Input validation with Joi
- Encrypted sensitive data
- Pre-authorized transaction limits
- Secondary confirmation for high-value actions

## 🌐 Multi-Chain Support

Currently supports:
- Ethereum (Doma contracts)
- Base (Doma contracts)

Roadmap:
- Solana integration (Q4 2025)
- Polygon support

## 📈 Monitoring & Analytics

- Winston logging
- Real-time metrics dashboard
- Alert success rates
- User engagement tracking
- Transaction monitoring

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋‍♂️ Support

- 📧 Email: support@domaalert.io
- 💬 Telegram: @DomaAlertSupport
- 🐦 Twitter: @DomaAlertBot
- 📖 Docs: [docs.domaalert.io](https://docs.domaalert.io)

## 🚀 Built for Doma

DomaAlert Bot is built exclusively for the Doma Protocol ecosystem. Every feature is designed to drive engagement and transactions within Doma's DomainFi infrastructure.

**Let's turn "missed domain moments" into "win after win" — together! 🎯**