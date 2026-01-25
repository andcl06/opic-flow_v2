
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

  // 사일런트 리프레시: 사용자 상호작용 없이 백그라운드에서 토큰만 갱신
  const refreshAccessTokenSilently = useCallback(() => {
    if (!window.google || !googleAuth) return;

    console.log("App: Background session maintenance starting...");
    
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        prompt: 'none', // 팝업 창을 띄우지 않음
        callback: (response: any) => {
          if (response.error) {
            console.warn("App: Silent refresh skipped (will retry on next activity):", response.error);
            // 중요: 갱신 실패 시에도 사용자를 쫓아내지 않고 현재 세션을 유지함
            return;
          }
          
          const expiresInSeconds = parseInt(response.expires_in) || 3600;
          const newExpiresAt = Date.now() + (expiresInSeconds * 1000);
          
          console.log("App: Session extended silently in background.");
          
          const updatedAuth = { ...googleAuth, token: response.access_token, expiresAt: newExpiresAt };
          setGoogleAuth(updatedAuth);
          
          // 대시보드에서 사용 중인 user 객체의 토큰도 업데이트 (화면 전환 없음)
          if (user) {
            setUser(prev => prev ? { ...prev, accessToken: response.access_token } : null);
          }

          localStorage.setItem(SESSION_KEY, JSON.stringify(updatedAuth));
        }
      });
      client.requestAccessToken();
    } catch (e) {
      console.error("App: Background maintenance error", e);
    }
  }, [googleAuth, user]);

  // 토큰 수명 모니터링 및 자동 갱신 스케줄링
  useEffect(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    if (googleAuth) {
      const timeUntilExpiry = googleAuth.expiresAt - Date.now();
      // 만료 10분 전부터 갱신 시도
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
      console.error("App: Session restoration failed", error);
      // 복구 실패 시에만 로컬 스토리지 비움
      localStorage.removeItem(SESSION_KEY);
      setGoogleAuth(null);
    } finally {
      setIsSyncing(false);
      setIsInitialLoading(false);
    }
  }, []);

  // 앱 시작 시 기존 세션 복구
  useEffect(() => {
    const savedSession = localStorage.getItem(SESSION_KEY);
    if (savedSession) {
      try {
        const { user: savedUser, token: savedToken, expiresAt } = JSON.parse(savedSession);
        // 토큰이 유효하면 즉시 복구, 만료되었더라도 일단 복구 후 사일런트 리프레시가 처리하게 함
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
      alert("사용자 정보를 등록하는 중 오류가 발생했습니다.");
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
          {isInitialLoading ? "Restoring Session" : "Syncing Data"}
        </p>
      </div>
    );
  }

  // 사용자가 명확히 로그아웃 상태일 때만 로그인 페이지를 보여줌
  if (!user && !googleAuth) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // 구글 인증은 되었으나 추가 정보 입력이 필요한 경우
  if (!user && googleAuth) {
    return <NameEntry googleUser={googleAuth.user} onConfirm={handleNameConfirm} />;
  }

  // 메인 대시보드: 여기서 일어나는 모든 세션 연장은 백그라운드에서 사일런트하게 진행됨
  return <Dashboard user={user!} onLogout={handleLogout} />;
};

export default App;
