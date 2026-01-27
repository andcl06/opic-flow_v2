
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleUser, FullUser } from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import NameEntry from './components/NameEntry';
import { syncUserWithMasterSheet } from './services/api';
import { GOOGLE_CLIENT_ID } from './constants';

const SESSION_KEY = 'OPICFLOW_AUTH_SESSION_V2';

// 모바일 환경 감지 유틸리티
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

const App: React.FC = () => {
  const [googleAuth, setGoogleAuth] = useState<{ user: GoogleUser, token: string, expiresAt: number } | null>(null);
  const [user, setUser] = useState<FullUser | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenClientRef = useRef<any>(null);

  // 구글 토큰 갱신 메인 로직
  const refreshAccessTokenSilently = useCallback((isManualTrigger = false) => {
    if (!window.google || !window.google.accounts) return;

    const isMobile = isMobileDevice();
    console.log(`App: Refreshing token (isMobile: ${isMobile}, manual: ${isManualTrigger})`);
    
    // 토큰 클라이언트 초기화
    if (!tokenClientRef.current) {
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        prompt: 'none',
        callback: (response: any) => {
          if (response.error) {
            console.warn("App: Token refresh error:", response.error);
            
            // 모바일 환경에서 silent refresh 실패 시
            if (isMobile && (response.error === 'immediate_failed' || response.error === 'interaction_required')) {
              // 초기 로딩 중이라면 경고창 없이 세션을 날리고 로그인으로 유도
              if (isInitialLoading) {
                console.log("App: Mobile silent refresh failed during initial load. Clearing session.");
                localStorage.removeItem(SESSION_KEY);
                setGoogleAuth(null);
                setUser(null);
                setIsInitialLoading(false);
                return;
              }

              // 사용 중인 상태라면 사용자에게 알림
              if (!isManualTrigger) {
                alert("보안 정책으로 인해 세션 연장이 필요합니다. 확인을 누르시면 로그인 창이 표시됩니다.");
                tokenClientRef.current.requestAccessToken({ prompt: '' });
              }
              return;
            }
            return;
          }
          
          const expiresInSeconds = parseInt(response.expires_in) || 3600;
          const newExpiresAt = Date.now() + (expiresInSeconds * 1000);
          const newToken = response.access_token;
          
          console.log("App: Session extended successfully.");
          
          setGoogleAuth(prev => {
            if (!prev) return null;
            const updated = { ...prev, token: newToken, expiresAt: newExpiresAt };
            localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
            return updated;
          });
          
          setUser(prev => prev ? { ...prev, accessToken: newToken } : null);
          window.dispatchEvent(new CustomEvent('TOKEN_REFRESHED_SUCCESS', { detail: { token: newToken } }));
        }
      });
    }

    tokenClientRef.current.requestAccessToken({ prompt: isManualTrigger ? '' : 'none' });
  }, [isInitialLoading]);

  // API 레이어에서 401 감지 시 호출되는 리스너
  useEffect(() => {
    const handleRefreshRequest = () => {
      console.log("App: Refresh requested by API layer.");
      refreshAccessTokenSilently();
    };
    window.addEventListener('NEED_TOKEN_REFRESH', handleRefreshRequest);
    return () => window.removeEventListener('NEED_TOKEN_REFRESH', handleRefreshRequest);
  }, [refreshAccessTokenSilently]);

  // 브라우저 탭 활성화 시 토큰 체크 (모바일 백그라운드 복귀 대응)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && googleAuth) {
        const timeUntilExpiry = googleAuth.expiresAt - Date.now();
        const refreshBuffer = 10 * 60 * 1000; 
        
        if (timeUntilExpiry < refreshBuffer) {
          console.log("App: Tab visible and token near expiry. Refreshing...");
          refreshAccessTokenSilently();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [googleAuth, refreshAccessTokenSilently]);

  // 토큰 수명 타이머 기반 모니터링
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
      const context = await syncUserWithMasterSheet(googleUser, accessToken, true);
      const authData = { user: googleUser, token: accessToken, expiresAt: expiresAt };

      if (persist) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(authData));
      }
      
      setGoogleAuth(authData);

      if (context.status === 'READY' || context.status === 'PROVISIONING' || context.status === 'SURVEY_REQUIRED') {
        setUser({ ...googleUser, accessToken, context });
      }
    } catch (error) {
      console.error("App: Sync error during session restoration", error);
      // 복구 실패 시 세션 정보 삭제 (모바일 환경에서의 무한 로딩 방지)
      if (isMobileDevice()) {
        localStorage.removeItem(SESSION_KEY);
        setGoogleAuth(null);
        setUser(null);
      }
    } finally {
      setIsSyncing(false);
      setIsInitialLoading(false);
    }
  }, []);

  // 세션 복구 로직
  useEffect(() => {
    const savedSession = localStorage.getItem(SESSION_KEY);
    if (savedSession) {
      try {
        const { user: savedUser, token: savedToken, expiresAt } = JSON.parse(savedSession);
        
        if (savedUser && savedToken) {
          const isMobile = isMobileDevice();
          const timeUntilExpiry = expiresAt - Date.now();
          const refreshBuffer = 5 * 60 * 1000; // 5분 여유

          // 모바일에서 토큰이 이미 만료되었거나 5분 이내라면 silent refresh 시도하지 말고 로그인 유도
          if (isMobile && timeUntilExpiry < refreshBuffer) {
            console.log("App: Mobile token expired or near expiry. Forcing re-login.");
            localStorage.removeItem(SESSION_KEY);
            setIsInitialLoading(false);
            return;
          }

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
