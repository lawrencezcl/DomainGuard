import React from 'react'

// Home Page
export const HomePage = () => (
  <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center">
    <div className="text-center max-w-4xl mx-auto px-6">
      <h1 className="text-6xl font-bold text-gradient mb-6">
        DomaAlert Bot
      </h1>
      <p className="text-xl text-gray-600 mb-8 text-balance">
        Your 24/7 DomainFi assistant. Never miss a domain moment again with real-time alerts, 
        automated actions, and smart notifications for Doma Protocol domains.
      </p>
      <div className="space-x-4">
        <a href="/login" className="btn btn-primary btn-lg">
          Get Started
        </a>
        <a href="#features" className="btn btn-outline btn-lg">
          Learn More
        </a>
      </div>
    </div>
  </div>
)

// Alerts Page
export const AlertsPage = () => (
  <div>
    <h1 className="text-2xl font-bold mb-6">Alert Management</h1>
    <div className="card">
      <div className="card-body">
        <p>Alert management interface coming soon...</p>
      </div>
    </div>
  </div>
)

// Domains Page
export const DomainsPage = () => (
  <div>
    <h1 className="text-2xl font-bold mb-6">Domain Explorer</h1>
    <div className="card">
      <div className="card-body">
        <p>Domain search and exploration interface coming soon...</p>
      </div>
    </div>
  </div>
)

// Subscription Page
export const SubscriptionPage = () => (
  <div>
    <h1 className="text-2xl font-bold mb-6">Subscription Management</h1>
    <div className="card">
      <div className="card-body">
        <p>Subscription management interface coming soon...</p>
      </div>
    </div>
  </div>
)

// Settings Page
export const SettingsPage = () => (
  <div>
    <h1 className="text-2xl font-bold mb-6">Settings</h1>
    <div className="card">
      <div className="card-body">
        <p>Settings interface coming soon...</p>
      </div>
    </div>
  </div>
)

// 404 Page
export const NotFoundPage = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="text-center">
      <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
      <p className="text-xl text-gray-600 mb-8">Page not found</p>
      <a href="/" className="btn btn-primary">
        Go Home
      </a>
    </div>
  </div>
)

export default HomePage