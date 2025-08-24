import React from 'react'
import { NavLink } from 'react-router-dom'
import { 
  HomeIcon,
  BellIcon,
  GlobeAltIcon,
  CreditCardIcon,
  CogIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Alerts', href: '/alerts', icon: BellIcon },
  { name: 'Domains', href: '/domains', icon: GlobeAltIcon },
  { name: 'Subscription', href: '/subscription', icon: CreditCardIcon },
  { name: 'Settings', href: '/settings', icon: CogIcon },
]

const Sidebar = () => {
  return (
    <div className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:pt-16">
      <div className="flex flex-col flex-grow bg-white border-r border-gray-200 overflow-y-auto">
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                isActive ? 'nav-link-active' : 'nav-link-inactive'
              }
            >
              <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {item.name}
            </NavLink>
          ))}
        </nav>

        {/* Bot Links */}
        <div className="px-4 py-4 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            Quick Access
          </p>
          <div className="space-y-2">
            <a
              href="https://t.me/DomaAlertBot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center text-sm text-gray-600 hover:text-gray-900"
            >
              <span className="mr-2">📱</span>
              Telegram Bot
            </a>
            <a
              href="https://twitter.com/DomaAlertBot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center text-sm text-gray-600 hover:text-gray-900"
            >
              <span className="mr-2">🐦</span>
              Twitter Bot
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Sidebar