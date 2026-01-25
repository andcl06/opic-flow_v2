
import React, { useEffect, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '../constants';
import { GoogleUser } from '../types';

interface LoginProps {
  onLoginSuccess: (user: GoogleUser, accessToken: string, expiresAt: number) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = () => {
    setIsLoading(true);
    setError(null);
    
    if (!window.google || !window.google.accounts) {
      setError("구글 라이브러리를 불러오는 중입니다. 잠시 후 버튼을 다시 눌러주세요.");
      setIsLoading(false);
      return;
    }

    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: async (response: any) => {
          if (response.error) {
            setError(`인증 실패: ${response.error}`);
            setIsLoading(false);
            return;
          }

          try {
            const expiresInSeconds = parseInt(response.expires_in) || 3600;
            const expiresAt = Date.now() + (expiresInSeconds * 1000);

            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
              headers: { Authorization: `Bearer ${response.access_token}` }
            });
            
            if (!userInfoRes.ok) throw new Error("사용자 정보를 가져올 수 없습니다.");
            
            const userInfo = await userInfoRes.json();
            onLoginSuccess({
              email: userInfo.email,
              email_verified: userInfo.verified_email,
              family_name: userInfo.family_name,
              given_name: userInfo.given_name,
              name: userInfo.name,
              picture: userInfo.picture,
              sub: userInfo.id
            }, response.access_token, expiresAt);
          } catch (err: any) {
            setError(`프로필 로드 중 오류가 발생했습니다.`);
            setIsLoading(false);
          }
        }
      });

      client.requestAccessToken();
    } catch (e) {
      setError("인증 초기화 중 오류가 발생했습니다.");
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#FDFDFF] overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-100 rounded-full blur-[160px] opacity-40 animate-pulse"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-indigo-100 rounded-full blur-[160px] opacity-40 animate-pulse" style={{ animationDelay: '3s' }}></div>
      
      <div className="relative z-10 w-full max-w-lg p-6">
        <div className="bg-white/80 backdrop-blur-3xl rounded-[56px] shadow-[0_40px_100px_rgba(0,0,0,0.05)] border border-white/50 p-10 sm:p-16 flex flex-col items-center text-center">
          
          <div className="mb-12 relative">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-[32px] rotate-12 flex items-center justify-center shadow-2xl shadow-blue-200 hover:rotate-0 transition-transform duration-500">
              <svg className="w-12 h-12 text-white -rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="absolute -bottom-2 -right-2 bg-white p-2 rounded-full shadow-lg">
                <div className="w-4 h-4 bg-green-500 rounded-full"></div>
            </div>
          </div>

          <div className="mb-12">
            <h1 className="text-5xl font-black text-slate-900 tracking-tighter mb-4 italic">
              OPIc<span className="text-blue-600">FLOW</span>
            </h1>
            <p className="text-slate-400 font-bold leading-relaxed text-base uppercase tracking-widest">
              AI Powered Learning Assistant
            </p>
          </div>

          <div className="w-full space-y-4 mb-10">
            <div className="bg-slate-50 rounded-3xl p-6 text-left border border-slate-100">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Cloud Connection</h3>
                <ul className="space-y-2">
                    <li className="flex items-center text-[12px] font-bold text-slate-600">
                        <svg className="w-4 h-4 mr-2 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                        학습 데이터 자동 동기화
                    </li>
                    <li className="flex items-center text-[12px] font-bold text-slate-600">
                        <svg className="w-4 h-4 mr-2 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                        개인화된 분석 리포트 생성
                    </li>
                </ul>
            </div>
          </div>

          {error && (
            <div className="mb-8 w-full p-4 bg-red-50 rounded-2xl border border-red-100 animate-bounce">
              <p className="text-red-600 text-[13px] font-bold">{error}</p>
            </div>
          )}

          <button 
            onClick={handleAuth}
            disabled={isLoading}
            className="w-full group relative overflow-hidden bg-slate-900 text-white py-6 rounded-[28px] hover:bg-slate-800 transition-all active:scale-[0.98] shadow-2xl shadow-slate-200 disabled:opacity-70"
          >
            <div className="relative z-10 flex items-center justify-center space-x-4">
              {isLoading ? (
                <div className="flex items-center space-x-3">
                    <div className="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                    <span className="font-black text-lg">Authorizing...</span>
                </div>
              ) : (
                <>
                    <div className="bg-white p-1 rounded-full shadow-sm">
                        <svg className="w-6 h-6" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                    </div>
                    <span className="font-black text-lg tracking-tight">Google 계정으로 계속하기</span>
                </>
              )}
            </div>
          </button>

          <p className="mt-12 text-[10px] text-slate-300 font-black uppercase tracking-[0.4em]">
            Secure Identity via Google GIS
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
