
import React, { useState } from 'react';
import { GoogleUser } from '../types';

interface NameEntryProps {
  googleUser: GoogleUser;
  onConfirm: (name: string) => void;
}

const NameEntry: React.FC<NameEntryProps> = ({ googleUser, onConfirm }) => {
  const [name, setName] = useState(googleUser.name);

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#fafafa]">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-100 rounded-full blur-[120px] opacity-60"></div>
      
      <div className="relative z-10 w-full max-w-md p-8">
        <div className="bg-white rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.04)] border border-gray-100 p-10 flex flex-col items-center text-center">
          <div className="mb-6">
            <img src={googleUser.picture} className="w-20 h-20 rounded-full border-4 border-white shadow-lg mx-auto" alt="" />
          </div>
          
          <h2 className="text-2xl font-black text-gray-900 mb-2">반갑습니다!</h2>
          <p className="text-gray-500 mb-8 leading-relaxed">
            학습 리포트와 시트에 기록될<br /><strong>성함</strong>을 확인해 주세요.
          </p>
          
          <div className="w-full space-y-4">
            <div className="text-left">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-4 mb-1 block">Your Name</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:bg-white focus:border-blue-600 focus:ring-4 focus:ring-blue-50 outline-none transition-all text-lg font-semibold text-gray-800"
                placeholder="성함을 입력하세요"
              />
            </div>
            
            <button 
              onClick={() => onConfirm(name)}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-200 active:scale-95 flex items-center justify-center space-x-2"
            >
              <span>확인 및 학습 시작</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          
          <div className="mt-8 flex items-center space-x-2 text-[11px] text-gray-400 font-medium">
            <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>마스터 시트에 안전하게 등록됩니다</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NameEntry;
