
import React, { useEffect } from 'react';
import { checkSheetStatus } from '../services/api';
import { FullUser } from '../types';

interface SheetProvisioningProps {
  user: FullUser;
  onReady: (sheetId: string) => void;
}

const SheetProvisioning: React.FC<SheetProvisioningProps> = ({ user, onReady }) => {
  useEffect(() => {
    // 3초마다 마스터 시트를 체크하여 individualSheetId가 생성되었는지 확인
    const pollInterval = setInterval(async () => {
      console.log("Provisioning: Checking sheet status...");
      const status = await checkSheetStatus(user.email, user.accessToken);
      
      // individualSheetUrl이 아니라 individualSheetId가 있는지 확인해야 함 (API 응답 필드명 일치)
      if (status.individualSheetId && status.status === 'READY') {
        console.log("Provisioning: Sheet is ready!", status.individualSheetId);
        clearInterval(pollInterval);
        onReady(status.individualSheetId);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [user.email, user.accessToken, onReady]);

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="relative mb-12">
        <div className="w-32 h-32 bg-blue-50 rounded-[48px] animate-pulse flex items-center justify-center shadow-inner">
          <svg className="w-16 h-16 text-blue-600 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
        </div>
        <div className="absolute -top-4 -right-4 flex h-10 w-10">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-10 w-10 bg-blue-500 items-center justify-center text-white text-[10px] font-black">AI</span>
        </div>
      </div>
      
      <h2 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">학습 전용 폴더 및 시트를 생성 중입니다</h2>
      <p className="text-gray-500 max-w-sm mx-auto font-medium leading-relaxed">
        {user.given_name}님만을 위한 커스텀 드라이브 공간과<br />
        실시간 피드백 기록용 시트를 준비하고 있어요.<br />
        <span className="text-blue-500 text-sm mt-4 block font-bold">마스터 시트에 정보가 등록되면 자동으로 시작됩니다.</span>
      </p>
      
      <div className="mt-16 flex flex-col items-center space-y-4">
        <div className="flex space-x-2">
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
        </div>
        <div className="text-[11px] font-black text-slate-300 uppercase tracking-[0.2em]">Provisioning Cloud Space</div>
      </div>
    </div>
  );
};

export default SheetProvisioning;
