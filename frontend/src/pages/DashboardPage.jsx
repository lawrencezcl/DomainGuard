import React from 'react'
import { useQuery } from 'react-query'
import { 
  ChartBarIcon, 
  BellIcon, 
  GlobeAltIcon, 
  CreditCardIcon,
  TrendingUpIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'
import { apiService } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import LoadingSpinner from '../components/common/LoadingSpinner'

const DashboardPage = () => {
  const { user } = useAuth()

  // Fetch dashboard data
  const { data: dashboardData, isLoading, error } = useQuery(
    'dashboard',
    apiService.analytics.dashboard,
    {
      refetchInterval: 30000, // Refresh every 30 seconds
    }
  )

  const { data: alertStats } = useQuery(
    'alert-stats',
    apiService.alerts.stats
  )

  if (isLoading) {
    return <LoadingSpinner className="py-20" />
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        <ExclamationTriangleIcon className="h-5 w-5" />
        Failed to load dashboard data. Please try again.
      </div>
    )
  }

  const stats = [
    {
      name: 'Active Alerts',
      value: alertStats?.activeAlerts || 0,
      icon: BellIcon,
      color: 'primary',
      change: '+2 this week'
    },
    {
      name: 'Domains Monitored',
      value: alertStats?.totalDomains || 0,
      icon: GlobeAltIcon,
      color: 'success',
      change: '+1 this month'
    },
    {
      name: 'Alerts Triggered',
      value: alertStats?.totalTriggers || 0,
      icon: TrendingUpIcon,
      color: 'warning',
      change: '+12 this week'
    },
    {
      name: 'Subscription',
      value: user?.subscriptionTier?.toUpperCase() || 'FREE',
      icon: CreditCardIcon,
      color: user?.subscriptionTier === 'premium' ? 'success' : 'gray',
      change: user?.subscriptionTier === 'free' ? 'Upgrade available' : 'Active'
    }
  ]

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.username}! 👋
        </h1>
        <p className="mt-2 text-gray-600">
          Here's your domain monitoring overview
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.name} className="card">
            <div className="card-body">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <stat.icon 
                    className={`h-8 w-8 text-${stat.color}-600`}
                    aria-hidden="true" 
                  />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">
                    {stat.name}
                  </p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stat.value}
                  </p>
                  <p className="text-sm text-gray-500">
                    {stat.change}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Alerts */}
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-medium text-gray-900">
              Recent Alerts
            </h2>
          </div>
          <div className="card-body">
            <RecentAlerts />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <div className="card-header">
            <h2 className="text-lg font-medium text-gray-900">
              Quick Actions
            </h2>
          </div>
          <div className="card-body space-y-3">
            <QuickActions />
          </div>
        </div>
      </div>

      {/* Domain Opportunities */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-medium text-gray-900">
            Domain Opportunities
          </h2>
          <p className="text-sm text-gray-500">
            Trending domains you might be interested in
          </p>
        </div>
        <div className="card-body">
          <DomainOpportunities />
        </div>
      </div>
    </div>
  )
}

// Recent Alerts Component
const RecentAlerts = () => {
  const mockAlerts = [
    {
      id: 1,
      domain: 'web3.ape',
      type: 'expiry',
      message: 'Domain expires in 3 days',
      time: '2 hours ago',
      urgency: 'high'
    },
    {
      id: 2,
      domain: 'nft.core',
      type: 'sale',
      message: 'Listed for 45 USDC',
      time: '5 hours ago',
      urgency: 'medium'
    },
    {
      id: 3,
      domain: 'dao.shib',
      type: 'transfer',
      message: 'Ownership changed',
      time: '1 day ago',
      urgency: 'low'
    }
  ]

  const urgencyColors = {
    high: 'danger',
    medium: 'warning',
    low: 'success'
  }

  return (
    <div className="space-y-3">
      {mockAlerts.map((alert) => (
        <div key={alert.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div className="flex items-center space-x-3">
            <div className={`badge badge-${urgencyColors[alert.urgency]}`}>
              {alert.urgency}
            </div>
            <div>
              <p className="font-medium text-gray-900">{alert.domain}</p>
              <p className="text-sm text-gray-600">{alert.message}</p>
            </div>
          </div>
          <p className="text-xs text-gray-500">{alert.time}</p>
        </div>
      ))}
      <div className="text-center">
        <a href="/alerts" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
          View all alerts →
        </a>
      </div>
    </div>
  )
}

// Quick Actions Component
const QuickActions = () => {
  return (
    <>
      <a
        href="/alerts"
        className="flex items-center justify-between p-3 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <BellIcon className="h-5 w-5 text-primary-600" />
          <span className="font-medium text-primary-900">Create New Alert</span>
        </div>
        <span className="text-primary-600">→</span>
      </a>
      
      <a
        href="/domains"
        className="flex items-center justify-between p-3 bg-success-50 rounded-lg hover:bg-success-100 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <GlobeAltIcon className="h-5 w-5 text-success-600" />
          <span className="font-medium text-success-900">Search Domains</span>
        </div>
        <span className="text-success-600">→</span>
      </a>
      
      <a
        href="/subscription"
        className="flex items-center justify-between p-3 bg-warning-50 rounded-lg hover:bg-warning-100 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <CreditCardIcon className="h-5 w-5 text-warning-600" />
          <span className="font-medium text-warning-900">Upgrade Plan</span>
        </div>
        <span className="text-warning-600">→</span>
      </a>
    </>
  )
}

// Domain Opportunities Component
const DomainOpportunities = () => {
  const mockOpportunities = [
    {
      domain: 'metaverse.ape',
      price: '125 USDC',
      change: '+15%',
      trend: 'up'
    },
    {
      domain: 'defi.core',
      price: '89 USDC',
      change: '-5%',
      trend: 'down'
    },
    {
      domain: 'nft.shib',
      price: '67 USDC',
      change: '+8%',
      trend: 'up'
    }
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {mockOpportunities.map((opportunity) => (
        <div key={opportunity.domain} className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-900">{opportunity.domain}</h3>
            <span className={`text-sm ${opportunity.trend === 'up' ? 'text-success-600' : 'text-danger-600'}`}>
              {opportunity.change}
            </span>
          </div>
          <p className="text-lg font-semibold text-gray-900 mt-1">{opportunity.price}</p>
          <button className="btn btn-outline btn-sm mt-2 w-full">
            View Details
          </button>
        </div>
      ))}
    </div>
  )
}

export default DashboardPage