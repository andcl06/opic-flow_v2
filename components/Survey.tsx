
import React, { useState, useEffect, useMemo } from 'react';
import { SurveyData, FullUser } from '../types';
import { fetchSurveyDatabase } from '../services/api';

interface SurveyProps {
  initialData?: SurveyData;
  onComplete: (data: any[]) => void; // 상세 데이터 배열 전달
  onCancel?: () => void;
  accessToken: string;
}

interface SurveyQuestion {
  id: string;
  step: string;
  question: string;
  option: string;
  nextId: string;
  type: 'Single' | 'Multiple';
  strategyGuide: string;
  isRecommended: boolean; // Is_Recommended 매핑 필드 추가
}

const Survey: React.FC<SurveyProps> = ({ initialData, onComplete, onCancel, accessToken }) => {
  const [db, setDb] = useState<SurveyQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentId, setCurrentId] = useState('Q1');
  const [history, setHistory] = useState<string[]>([]);
  
  // 각 질문 단계별로 선택된 옵션 객체들을 저장
  const [answerLog, setAnswerLog] = useState<Map<string, SurveyQuestion[]>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchSurveyDatabase(accessToken)
      .then(setDb)
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  const currentOptions = useMemo(() => db.filter(q => q.id === currentId), [db, currentId]);
  const currentQuestionText = currentOptions[0]?.question || "";
  const currentStep = currentOptions[0]?.step || "1";
  const isMultiple = currentOptions[0]?.type === 'Multiple';

  const totalSelectedCount = useMemo(() => {
    let count = 0;
    const multipleIds = ['Q4', 'Q5', 'Q6', 'Q7'];
    multipleIds.forEach(id => {
      count += (answerLog.get(id) || []).length;
    });
    return count;
  }, [answerLog]);

  const handleOptionClick = (option: SurveyQuestion) => {
    const newLog = new Map<string, SurveyQuestion[]>(answerLog);
    
    if (option.type === 'Single') {
      newLog.set(currentId, [option]);
      setAnswerLog(newLog);
      
      if (option.nextId === 'END') {
        handleSubmit(newLog);
      } else {
        setHistory([...history, currentId]);
        setCurrentId(option.nextId);
      }
    } else {
      const currentSelection = answerLog.get(currentId) || [];
      const alreadySelected = currentSelection.find(s => s.option === option.option);
      
      const newSelection = alreadySelected
        ? currentSelection.filter(s => s.option !== option.option)
        : [...currentSelection, option];
      
      newLog.set(currentId, newSelection);
      setAnswerLog(newLog);
    }
  };

  const handleNext = () => {
    if (isMultiple) {
      const nextId = currentOptions[0].nextId;
      if (nextId === 'END') {
        if (totalSelectedCount < 12) {
          alert(`현재 총 ${totalSelectedCount}개가 선택되었습니다. 최소 12개 이상의 항목을 선택해야 합니다.`);
          return;
        }
        handleSubmit(answerLog);
      } else {
        setHistory([...history, currentId]);
        setCurrentId(nextId);
      }
    }
  };

  const handleBack = () => {
    if (history.length > 0) {
      const prevId = history[history.length - 1];
      setHistory(history.slice(0, -1));
      setCurrentId(prevId);
    }
  };

  const handleSubmit = async (finalLog: Map<string, SurveyQuestion[]>) => {
    setIsSubmitting(true);
    try {
      const detailedAnswers = Array.from(finalLog.entries()).map(([qId, options]) => {
        return {
          step: options[0].step,
          questionId: qId,
          questionText: options[0].question,
          selection: options.map(o => o.option),
          isStrategic: options.some(o => o.isRecommended), // isRecommended 필드를 기준으로 판단
          memo: options[0].strategyGuide
        };
      });

      await onComplete(detailedAnswers);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-slate-500 tracking-tight">설문 데이터를 구성하는 중...</p>
      </div>
    );
  }

  const isNextDisabled = isMultiple && (answerLog.get(currentId) || []).length === 0;

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white rounded-[40px] shadow-2xl overflow-hidden border border-white">
        {/* Header */}
        <div className="bg-[#0F172A] px-10 py-8 text-white">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-black tracking-tight uppercase opacity-60">
              OPIc Background Survey
            </h2>
            <div className="flex flex-col items-end">
                <span className="bg-blue-600 px-4 py-1 rounded-full text-[10px] font-black uppercase mb-1 tracking-widest">
                  Step {currentStep}
                </span>
                {['Q4', 'Q5', 'Q6', 'Q7'].includes(currentId) && (
                    <span className={`text-[10px] font-bold ${totalSelectedCount >= 12 ? 'text-green-400' : 'text-blue-300 animate-pulse'}`}>
                        누적 선택: {totalSelectedCount} / 12 (필수)
                    </span>
                )}
            </div>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div 
              className="bg-blue-500 h-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
              style={{ width: `${(parseInt(currentStep) / 7) * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Content */}
        <div className="p-8 md:p-12 min-h-[500px] flex flex-col">
          <div className="flex-grow space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-2">
               <h3 className="text-2xl font-black text-gray-900 leading-tight">
                {currentQuestionText.split(' ').map((word, i) => (
                  <span key={i} className={word.includes('분야') || word.includes('활동') || word.includes('운동') || word.includes('거주') || word.includes('학생') ? 'text-blue-600 mr-1' : 'mr-1'}>
                    {word}
                  </span>
                ))}
              </h3>
              {isMultiple && (
                <p className="text-[11px] text-slate-400 font-bold italic">* 중복 선택이 가능하며, 4~7단계 합산 12개 이상 선택이 필수입니다.</p>
              )}
            </div>

            <div className={`grid gap-3 ${isMultiple ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-1'}`}>
              {currentOptions.map((option, idx) => {
                const isSelected = (answerLog.get(currentId) || []).some(s => s.option === option.option);
                const isRecommended = option.isRecommended; // API 필드 사용
                
                return (
                  <button
                    key={idx}
                    onClick={() => handleOptionClick(option)}
                    className={`relative p-5 rounded-2xl text-left border-2 transition-all flex justify-between items-center h-full
                      ${isSelected 
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold shadow-md' 
                        : 'border-gray-100 hover:border-gray-200 text-gray-500 bg-white hover:bg-slate-50'}`}
                  >
                    <span className={isMultiple ? "text-xs leading-tight" : "text-sm"}>{option.option}</span>
                    
                    {isRecommended && (
                      <span className="absolute -top-2 -right-1 bg-indigo-600 text-[8px] text-white px-1.5 py-0.5 rounded-full shadow-sm font-black uppercase tracking-tighter">AI 추천</span>
                    )}
                    
                    {isSelected && (
                      <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center shrink-0 ml-2">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="mt-10 flex justify-between items-center border-t pt-8 border-slate-50">
            <div className="flex space-x-2">
              <button 
                onClick={handleBack} 
                disabled={history.length === 0 || isSubmitting} 
                className={`font-bold text-sm px-5 py-2.5 rounded-xl transition-all ${history.length === 0 ? 'opacity-0 pointer-events-none' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}
              >
                이전 단계
              </button>
              {onCancel && history.length === 0 && (
                <button 
                  onClick={onCancel}
                  className="font-bold text-sm px-5 py-2.5 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
                >
                  수정 취소
                </button>
              )}
            </div>
            
            <div className="flex items-center">
                {isMultiple && (
                  <button 
                    onClick={handleNext} 
                    disabled={isNextDisabled || isSubmitting} 
                    className={`px-10 py-4 rounded-[20px] font-black text-sm transition-all shadow-xl flex items-center space-x-2 
                      ${isNextDisabled || isSubmitting 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none' 
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100 active:scale-95'}`}
                  >
                    <span>{currentOptions[0].nextId === 'END' ? '최종 완료' : '다음으로'}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"/>
                    </svg>
                  </button>
                )}
            </div>
          </div>
        </div>
      </div>
      
      {isSubmitting && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-white p-8 rounded-[32px] shadow-2xl text-center">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="font-black text-slate-800">커리큘럼을 생성하고 있습니다...</p>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default Survey;
