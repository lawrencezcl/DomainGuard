import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Add timestamp to prevent caching
    config.params = {
      ...config.params,
      _t: Date.now(),
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Handle 401 errors (token expired)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        // Try to refresh token
        const token = localStorage.getItem('domaAlert_token')
        if (token) {
          const response = await apiClient.post('/auth/refresh', { token })
          const newToken = response.data.token

          localStorage.setItem('domaAlert_token', newToken)
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`

          // Retry original request
          originalRequest.headers['Authorization'] = `Bearer ${newToken}`
          return apiClient(originalRequest)
        }
      } catch (refreshError) {
        // Refresh failed, redirect to login
        localStorage.removeItem('domaAlert_token')
        delete apiClient.defaults.headers.common['Authorization']
        window.location.href = '/login'
      }
    }

    // Handle network errors
    if (!error.response) {
      error.message = 'Network error. Please check your connection.'
    }

    return Promise.reject(error)
  }
)

// API service object
export const apiService = {
  // Set auth token
  setAuthToken: (token) => {
    if (token) {
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`
    } else {
      delete apiClient.defaults.headers.common['Authorization']
    }
  },

  // Authentication endpoints
  auth: {
    login: (credentials) => apiClient.post('/auth/login', credentials),
    register: (userData) => apiClient.post('/auth/register', userData),
    logout: () => apiClient.post('/auth/logout'),
    me: () => apiClient.get('/auth/me'),
    refresh: (data) => apiClient.post('/auth/refresh', data),
    updateProfile: (data) => apiClient.patch('/auth/profile', data),
  },

  // Alerts endpoints
  alerts: {
    list: (params) => apiClient.get('/alerts', { params }),
    get: (id) => apiClient.get(`/alerts/${id}`),
    create: (data) => apiClient.post('/alerts', data),
    update: (id, data) => apiClient.put(`/alerts/${id}`, data),
    delete: (id) => apiClient.delete(`/alerts/${id}`),
    toggle: (id) => apiClient.patch(`/alerts/${id}/toggle`),
    stats: () => apiClient.get('/alerts/stats'),
  },

  // Domains endpoints
  domains: {
    search: (query, params) => apiClient.get('/domains/search', { params: { query, ...params } }),
    info: (domain) => apiClient.get(`/domains/info/${domain}`),
    history: (domain, params) => apiClient.get(`/domains/history/${domain}`, { params }),
    trending: (params) => apiClient.get('/domains/trending', { params }),
  },

  // Subscriptions endpoints
  subscriptions: {
    status: () => apiClient.get('/subscriptions'),
    upgrade: (data) => apiClient.post('/subscriptions/upgrade', data),
    cancel: () => apiClient.post('/subscriptions/cancel'),
    history: () => apiClient.get('/subscriptions/history'),
  },

  // Auto-actions endpoints
  autoActions: {
    list: () => apiClient.get('/auto-actions'),
    create: (data) => apiClient.post('/auto-actions', data),
    update: (id, data) => apiClient.put(`/auto-actions/${id}`, data),
    delete: (id) => apiClient.delete(`/auto-actions/${id}`),
    logs: (id, params) => apiClient.get(`/auto-actions/${id}/logs`, { params }),
  },

  // Analytics endpoints
  analytics: {
    dashboard: () => apiClient.get('/analytics/dashboard'),
    alerts: (params) => apiClient.get('/analytics/alerts', { params }),
    domains: (params) => apiClient.get('/analytics/domains', { params }),
  },

  // Utilities
  utils: {
    health: () => apiClient.get('/health'),
    validateDomain: (domain) => apiClient.get(`/utils/validate-domain/${domain}`),
    estimateGas: (operation) => apiClient.get(`/utils/estimate-gas/${operation}`),
  },
}

// Helper functions
export const handleApiError = (error) => {
  if (error.response) {
    // Server responded with error status
    return {
      message: error.response.data?.error?.message || 'An error occurred',
      status: error.response.status,
      details: error.response.data?.error?.details,
    }
  } else if (error.request) {
    // Network error
    return {
      message: 'Network error. Please check your connection.',
      status: 0,
    }
  } else {
    // Other error
    return {
      message: error.message || 'An unexpected error occurred',
      status: -1,
    }
  }
}

export const isNetworkError = (error) => {
  return !error.response || error.code === 'NETWORK_ERROR'
}

export const isAuthError = (error) => {
  return error.response?.status === 401
}

export const isValidationError = (error) => {
  return error.response?.status === 400
}

// WebSocket connection (for real-time updates)
export const createWebSocketConnection = (token) => {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsHost = window.location.host
  const wsUrl = `${wsProtocol}//${wsHost}/ws?token=${token}`

  const ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    console.log('WebSocket connected')
  }

  ws.onclose = () => {
    console.log('WebSocket disconnected')
  }

  ws.onerror = (error) => {
    console.error('WebSocket error:', error)
  }

  return ws
}

export default apiService