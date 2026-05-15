import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, [token]);

  async function fetchUser() {
    try {
      console.log('Fetching user with token:', token?.substring(0, 20) + '...');
      const response = await fetch('/api/v1/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      console.log('fetchUser response:', { status: response.status, data });
      if (response.ok) {
        setUser(data);
      } else {
        logout();
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password) {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    console.log('Login response:', { status: response.status, data });

    if (!response.ok) {
      throw new Error(data.message || 'Login failed');
    }

    // Backend returns user data flat, not nested under 'user'
    const userObj = { id: data.id, email: data.email, plan: data.plan };
    console.log('Setting user:', userObj, 'token:', data.token?.substring(0, 20) + '...');
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(userObj);
    return data;
  }

  async function signup(email, password, company_name) {
    const response = await fetch('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, company_name }),
    });

    const data = await response.json();
    console.log('Signup response:', { status: response.status, data });

    if (!response.ok) {
      throw new Error(data.message || 'Signup failed');
    }

    // Backend returns user data flat, not nested under 'user'
    const userObj = { id: data.id, email: data.email, plan: data.plan };
    console.log('Setting user:', userObj, 'token:', data.token?.substring(0, 20) + '...');
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(userObj);
    return data;
  }

  function logout() {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
