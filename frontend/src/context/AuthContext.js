/**
 * Archivo: frontend/src/context/AuthContext.js
 * Función: Contexto global de autenticación: guarda el token JWT (localStorage) y el usuario actual, expone login/logout y la URL base de la API (REACT_APP_BACKEND_URL + /api) usada por todos los módulos.
 * Trabaja con: backend/app/routers/auth/router.py (/api/auth/login, /me, /logout), App.js, todos los modules/*
 */
import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("fibraz_token") || "");
  const [loading, setLoading] = useState(true);

  const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

  // Si el backend responde 401 (sesión inválida/expirada) se cierra la sesión automáticamente
  useEffect(() => {
    const id = axios.interceptors.response.use(
      (res) => res,
      (error) => {
        if (error?.response?.status === 401 && !String(error?.config?.url || "").includes("/auth/login")) {
          localStorage.removeItem("fibraz_token");
          setUser(false);
          setToken("");
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(id);
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      const savedToken = localStorage.getItem("fibraz_token");
      if (savedToken) {
        try {
          const res = await axios.get(`${API}/auth/me`, {
            headers: { Authorization: `Bearer ${savedToken}` },
            withCredentials: true,
          });
          setUser(res.data.user);
          setToken(savedToken);
        } catch (e) {
          localStorage.removeItem("fibraz_token");
          setUser(false);
          setToken("");
        }
      } else {
        setUser(false);
      }
      setLoading(false);
    };
    checkAuth();
  }, [API]);

  const login = async (email, password) => {
    const res = await axios.post(
      `${API}/auth/login`,
      { email, password },
      { withCredentials: true }
    );
    const { token: newToken, user: userData } = res.data;
    localStorage.setItem("fibraz_token", newToken);
    setToken(newToken);
    setUser(userData);
    return userData;
  };

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    } catch (e) {}
    localStorage.removeItem("fibraz_token");
    setUser(false);
    setToken("");
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, API }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
