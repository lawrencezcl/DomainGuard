import React, { createContext, useContext, useReducer, useEffect } from 'react'
import { apiService } from '../services/api'
import toast from 'react-hot-toast'

// Auth context
const AuthContext = createContext(null)

// Auth reducer
const authReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: !!action.payload,
        isLoading: false
      }
    case 'SET_TOKEN':
      return { ...state, token: action.payload }
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false
      }
    case 'UPDATE_USER':
      return {
        ...state,
        user: { ...state.user, ...action.payload }
      }
    default:
      return state
  }
}

// Initial state
const initialState = {
  user: null,
  token: localStorage.getItem('domaAlert_token'),
  isAuthenticated: false,
  isLoading: true
}

// Auth provider component
export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState)

  // Initialize auth on app load
  useEffect(() => {
    initializeAuth()
  }, [])

  const initializeAuth = async () => {
    const token = localStorage.getItem('domaAlert_token')
    
    if (!token) {
      dispatch({ type: 'SET_LOADING', payload: false })
      return
    }

    try {
      // Set token in API service
      apiService.setAuthToken(token)
      
      // Verify token and get user
      const response = await apiService.auth.me()
      
      dispatch({ type: 'SET_USER', payload: response.data.user })
      dispatch({ type: 'SET_TOKEN', payload: token })
    } catch (error) {
      console.error('Token verification failed:', error)
      // Clear invalid token
      localStorage.removeItem('domaAlert_token')
      apiService.setAuthToken(null)
      dispatch({ type: 'LOGOUT' })
    }
  }

  const login = async (credentials) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      const response = await apiService.auth.login(credentials)
      const { user, token } = response.data
      
      // Store token
      localStorage.setItem('domaAlert_token', token)
      apiService.setAuthToken(token)
      
      // Update state
      dispatch({ type: 'SET_USER', payload: user })
      dispatch({ type: 'SET_TOKEN', payload: token })
      
      toast.success(`Welcome back, ${user.username}!`)
      return { success: true }
    } catch (error) {
      dispatch({ type: 'SET_LOADING', payload: false })
      const message = error.response?.data?.error?.message || 'Login failed'
      toast.error(message)
      return { success: false, error: message }
    }
  }

  const register = async (userData) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true })
      
      const response = await apiService.auth.register(userData)
      const { user, token } = response.data
      
      // Store token
      localStorage.setItem('domaAlert_token', token)
      apiService.setAuthToken(token)
      
      // Update state
      dispatch({ type: 'SET_USER', payload: user })
      dispatch({ type: 'SET_TOKEN', payload: token })
      
      toast.success(`Welcome to DomaAlert, ${user.username}!`)
      return { success: true }
    } catch (error) {
      dispatch({ type: 'SET_LOADING', payload: false })
      const message = error.response?.data?.error?.message || 'Registration failed'
      toast.error(message)
      return { success: false, error: message }
    }
  }

  const logout = () => {
    // Clear token
    localStorage.removeItem('domaAlert_token')
    apiService.setAuthToken(null)
    
    // Update state
    dispatch({ type: 'LOGOUT' })
    
    toast.success('Logged out successfully')
  }

  const updateUser = (updates) => {
    dispatch({ type: 'UPDATE_USER', payload: updates })
  }

  const refreshToken = async () => {
    try {
      const response = await apiService.auth.refresh({ token: state.token })
      const newToken = response.data.token
      
      localStorage.setItem('domaAlert_token', newToken)
      apiService.setAuthToken(newToken)
      dispatch({ type: 'SET_TOKEN', payload: newToken })
      
      return newToken
    } catch (error) {
      console.error('Token refresh failed:', error)
      logout()
      throw error
    }
  }

  const connectWallet = async (walletAddress) => {
    try {
      // Update user with wallet address
      const response = await apiService.auth.updateProfile({ walletAddress })
      
      dispatch({ type: 'UPDATE_USER', payload: { walletAddress } })
      toast.success('Wallet connected successfully!')
      
      return { success: true }
    } catch (error) {
      const message = error.response?.data?.error?.message || 'Failed to connect wallet'
      toast.error(message)
      return { success: false, error: message }
    }
  }

  const value = {
    ...state,
    login,
    register,
    logout,
    updateUser,
    refreshToken,
    connectWallet
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext