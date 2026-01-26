
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleUser, FullUser } from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import NameEntry from './components/NameEntry';
import { syncUserWithMasterSheet } from './services/api';
import { GOOGLE_CLIENT_ID } from './constants';

const SESSION_KEY = 'OPICFLOW_AUTH_SESSION_V2';

const App: React.FC = () => {
  const [googleAuth, setGoogleAuth] = useState<{ user: GoogleUser, token: string, expiresAt: number } | null>(null);
  const [user, setUser] = useState<FullUser | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenClientRef = useRef<any>(null);

  // 사일런트 리프레시 로직
  const refreshAccessTokenSilently = useCallback(() => {
    if (!window.google) return;

    console.log("App: Refreshing token...");
    
    if (!tokenClientRef.current) {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        prompt: 'none',
        callback: (response: any) => {
          if (response.error) {
            console.warn("App: Silent refresh skipped:", response.error);
            return;
          }
          
          const expiresInSeconds = parseInt(response.expires_in) || 3600;
          const newExpiresAt = Date.now() + (expiresInSeconds * 1000);
          const newToken = response.access_token;
          
          console.log("App: Session extended silently.");
          
          setGoogleAuth(prev => {
            if (!prev) return null;
            const updated = { ...prev, token: newToken, expiresAt: newExpiresAt };
            localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
            return updated;
          });
          
          setUser(prev => prev ? { ...prev, accessToken: newToken } : null);

          // API 레이어에 갱신 완료 알림 발송
          window.dispatchEvent(new CustomEvent('TOKEN_REFRESHED_SUCCESS', { detail: { token: newToken } }));
        }
      });
    }

    tokenClientRef.current.requestAccessToken();
  }, []);

  // API 레이어에서 401 감지 시 호출되는 리스너
  useEffect(() => {
    const handleRefreshRequest = () => {
      console.log("App: Refresh requested by API layer.");
      refreshAccessTokenSilently();
    };
    window.addEventListener('NEED_TOKEN_REFRESH', handleRefreshRequest);
    return () => window.removeEventListener('NEED_TOKEN_REFRESH', handleRefreshRequest);
  }, [refreshAccessTokenSilently]);

  // 토큰 수명 모니터링
  useEffect(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    if (googleAuth) {
      const timeUntilExpiry = googleAuth.expiresAt - Date.now();
      const refreshBuffer = 10 * 60 * 1000; 
      const delay = Math.max(timeUntilExpiry - refreshBuffer, 0);

      refreshTimerRef.current = setTimeout(() => {
        refreshAccessTokenSilently();
      }, delay);
    }

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [googleAuth, refreshAccessTokenSilently]);

  const handleLoginSuccess = useCallback(async (googleUser: GoogleUser, accessToken: string, expiresAt: number, persist = true) => {
    setIsSyncing(true);
    
    try {
      // 신규 유저인지 체크할 때 만료 토큰이면 authenticatedFetch가 자동으로 refreshAccessTokenSilently를 트리거함
      const context = await syncUserWithMasterSheet(googleUser, accessToken, true);
      
      const authData = { 
        user: googleUser, 
        token: accessToken,
        expiresAt: expiresAt 
      };

      if (persist) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(authData));
      }
      
      setGoogleAuth(authData);

      if (context.status === 'READY' || context.status === 'PROVISIONING' || context.status === 'SURVEY_REQUIRED') {
        setUser({ ...googleUser, accessToken, context });
      }
    } catch (error) {
      console.error("App: Sync error during session restoration", error);
      // 단순 에러면 로그인 페이지로 쫓아내지 않고 유지 (재시도 등)
    } finally {
      setIsSyncing(false);
      setIsInitialLoading(false);
    }
  }, []);

  // 세션 복구
  useEffect(() => {
    const savedSession = localStorage.getItem(SESSION_KEY);
    if (savedSession) {
      try {
        const { user: savedUser, token: savedToken, expiresAt } = JSON.parse(savedSession);
        if (savedUser && savedToken) {
          handleLoginSuccess(savedUser, savedToken, expiresAt, false);
        } else {
          setIsInitialLoading(false);
        }
      } catch (e) {
        localStorage.removeItem(SESSION_KEY);
        setIsInitialLoading(false);
      }
    } else {
      setIsInitialLoading(false);
    }
  }, [handleLoginSuccess]);

  const handleNameConfirm = async (confirmedName: string) => {
    if (!googleAuth) return;
    setIsSyncing(true);
    try {
      const updatedGoogleUser = { ...googleAuth.user, name: confirmedName };
      const context = await syncUserWithMasterSheet(updatedGoogleUser, googleAuth.token, false);
      const updatedAuth = { ...googleAuth, user: updatedGoogleUser };
      
      localStorage.setItem(SESSION_KEY, JSON.stringify(updatedAuth));
      setGoogleAuth(updatedAuth);
      setUser({ ...updatedGoogleUser, accessToken: googleAuth.token, context });
    } catch (error) {
      alert("등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setGoogleAuth(null);
  };

  if (isInitialLoading || isSyncing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6 text-center">
        <div className="w-16 h-16 relative mb-8">
          <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2 italic uppercase tracking-tighter">
          OPIc<span className="text-blue-600">FLOW</span>
        </h2>
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-widest">
          {isInitialLoading ? "Verifying Session" : "Syncing Data"}
        </p>
      </div>
    );
  }

  if (!user && !googleAuth) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (!user && googleAuth) {
    return <NameEntry googleUser={googleAuth.user} onConfirm={handleNameConfirm} />;
  }

  return <Dashboard user={user!} onLogout={handleLogout} />;
};

export default App;
