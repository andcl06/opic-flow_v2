
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FullUser, SurveyData, OPIcQuestion, UnitProgress, StudyLogEntry, VocabularyEntry } from '../types';
import { 
  fetchSurveyFromIndividualSheet, 
  fetchProgressFromIndividualSheet, 
  updateUnitStatus, 
  saveStudyLog, 
  updateStudyLog,
  fetchStudyLogs, 
  uploadAudioToDrive,
  deleteFileFromDrive,
  deleteStudyLogBySessionId,
  saveSurveyAndGenerateProgress,
  fetchQuestionDatabase,
  fetchConfigSettings,
  updateMasterProgress,
  fetchAllUsersProgress,
  saveVocabularyEntry,
  fetchVocabularyBank,
  deleteVocabularyEntry
} from '../services/api';
import SheetProvisioning from './SheetProvisioning';
import Survey from './Survey';
import { GoogleGenAI, Modality } from "@google/genai";

// 파트 구분을 위한 특수 문자열
const PART_DELIMITER = " [PART] ";

type AnswerDirection = 'EASY' | 'NATIVE' | 'STORYTELLER' | null;
type GenerationMode = 'AI' | 'MANUAL';

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function cleanAiText(text: string): string {
  return text ? text.replace(/[*_`#]/g, '').replace(/\[|\]/g, '').replace(/\s+/g, " ").trim() : "";
}

async function decodeRawPcm(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
  return buffer;
}

const extractFileId = (url: string) => {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/id=([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user}***@${domain}`;
  return `${user.substring(0, 2)}***@${domain}`;
};

interface DashboardProps { user: FullUser; onLogout: () => void; }

const Dashboard: React.FC<DashboardProps> = ({ user: initialUser, onLogout }) => {
  const [user, setUser] = useState<FullUser>(initialUser);
  const [units, setUnits] = useState<UnitProgress[]>([]);
  const [masterQuestionDb, setMasterQuestionDb] = useState<any[]>([]); 
  const [unitHistory, setUnitHistory] = useState<StudyLogEntry[]>([]);
  const [selectedUnitIdx, setSelectedUnitIdx] = useState<number | null>(null);
  
  const [geminiApiKey, setGeminiApiKey] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  const [isUnitPreview, setIsUnitPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<OPIcQuestion | null>(null);
  const [userKeywords, setUserKeywords] = useState("");
  
  // New States for Question Generation
  const [genMode, setGenMode] = useState<GenerationMode>('AI');
  const [aiGenKeyword, setAiGenKeyword] = useState("");
  const [manualQuestionText, setManualQuestionText] = useState("");

  const [selectedDirection, setSelectedDirection] = useState<AnswerDirection>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [analysisStep, setAnalysisStep] = useState("");
  const [showTranslation, setShowTranslation] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ 
    transcript: string, 
    correction: string, 
    correctionParts?: { intro: string, body: string, conclusion: string },
    translationParts?: { intro: string, body: string, conclusion: string },
    feedback: string, 
    predictedLevel: string, 
    rawAudioLink?: string,
    audioLink?: string,
    date?: string
  } | null>(null);
  const [isRestudyMode, setIsRestudyMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEditingSurvey, setIsEditingSurvey] = useState(false);

  const [isGlobalProgressOpen, setIsGlobalProgressOpen] = useState(false);
  const [allUsersProgress, setAllUsersProgress] = useState<any[]>([]);
  const [isFetchingRanking, setIsFetchingRanking] = useState(false);

  const [isHistoryPrintModalOpen, setIsHistoryPrintModalOpen] = useState(false);
  const [allLogsForPrint, setAllLogsForPrint] = useState<StudyLogEntry[]>([]);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [isFetchingAllLogs, setIsFetchingAllLogs] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const [isVocabularyView, setIsVocabularyView] = useState(false);
  const [savedVocabList, setSavedVocabList] = useState<VocabularyEntry[]>([]);
  const [isLoadingVocab, setIsLoadingVocab] = useState(false);
  const [extractedVocab, setExtractedVocab] = useState<any[]>([]);
  const [isExtractingVocab, setIsExtractingVocab] = useState(false);
  const [savingVocabIds, setSavingVocabIds] = useState<Set<string>>(new Set());

  const localTtsCache = useRef<Map<string, Uint8Array>>(new Map());
  const [ttsState, setTtsState] = useState<{ id: string, status: 'playing' | 'loading' } | null>(null);
  const activeAudioSource = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const isCancellingRef = useRef(false);
  
  const syncingCorrectionSessionId = useRef<string | null>(null);

  const structuredCurriculum = useMemo(() => {
    const categories: Record<string, { 
      topicGroups: Record<string, { units: UnitProgress[], originalIndexes: number[] }>,
      directUnits: { unit: UnitProgress, originalIndex: number }[]
    }> = {};

    units.forEach((unit, idx) => {
      const meta = masterQuestionDb.find(q => q.fullId === unit.fullId);
      const categoryName = meta?.category || "기타";
      const isStrategy = unit.unitId === 'STRATEGY';

      if (!categories[categoryName]) {
        categories[categoryName] = { topicGroups: {}, directUnits: [] };
      }

      if (isStrategy) {
        categories[categoryName].directUnits.push({ unit, originalIndex: idx });
      } else {
        const topicName = unit.topic;
        if (!categories[categoryName].topicGroups[topicName]) {
          categories[categoryName].topicGroups[topicName] = { units: [], originalIndexes: [] };
        }
        categories[categoryName].topicGroups[topicName].units.push(unit);
        categories[categories[categoryName].topicGroups[topicName].originalIndexes.push(idx)];
      }
    });

    return categories;
  }, [units, masterQuestionDb]);

  const loadAllData = useCallback(async (sheetId: string) => {
    setIsLoadingData(true);
    try {
      const [survey, progress, questionDb, config] = await Promise.all([
        fetchSurveyFromIndividualSheet(sheetId, user.accessToken),
        fetchProgressFromIndividualSheet(sheetId, user.accessToken),
        fetchQuestionDatabase(user.accessToken),
        fetchConfigSettings(user.accessToken)
      ]);
      
      if (config['Gemini_API_Key']) setGeminiApiKey(config['Gemini_API_Key']);

      setUser(prev => ({ 
        ...prev, 
        context: { 
          ...prev.context, 
          survey,
          status: survey ? 'READY' : 'SURVEY_REQUIRED'
        } 
      })); 
      setUnits(progress);
      setMasterQuestionDb(questionDb);
    } catch (e) { console.error("Load fail", e); } finally { setIsLoadingData(false); }
  }, [user.accessToken]);

  const openGlobalRanking = async () => {
    setAllUsersProgress([]);
    setIsGlobalProgressOpen(true);
    setIsFetchingRanking(true);
    try {
      const data = await fetchAllUsersProgress(user.accessToken);
      const sorted = data.sort((a, b) => {
        const progA = parseInt(a.progress) || 0;
        const progB = parseInt(b.progress) || 0;
        return progB - progA;
      });
      setAllUsersProgress(sorted);
    } catch (e) {
      console.error("Master_Dashboard refresh failed", e);
    } finally {
      setIsFetchingRanking(false);
    }
  };

  const openHistoryPrintModal = async () => {
    setAllLogsForPrint([]);
    setSelectedLogIds(new Set());
    setIsHistoryPrintModalOpen(true);
    setIsFetchingAllLogs(true);
    try {
      const logs = await fetchStudyLogs(user.context.individualSheetId!, user.accessToken);
      const sortedLogs = logs.reverse();
      setAllLogsForPrint(sortedLogs);
      setSelectedLogIds(new Set(sortedLogs.map(l => l.sessionId)));
    } catch (e) {
      console.error("Fetch all logs failed", e);
    } finally {
      setIsFetchingAllLogs(false);
    }
  };

  const handleExcelDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const logs = await fetchStudyLogs(user.context.individualSheetId!, user.accessToken);
      if (logs.length === 0) {
        alert("다운로드할 학습 내역이 없습니다.");
        return;
      }

      // CSV 헤더 설정
      const headers = ["ID", "날짜", "유닛", "유형", "질문", "키워드", "내 답변", "녹음링크", "성적", "AI 모범답안", "한글번역", "피드백", "모범답안 오디오"];
      
      // 데이터 행 생성
      const csvRows = logs.map(log => [
        log.sessionId,
        log.date,
        log.unit,
        log.type,
        log.question.replace(/"/g, '""'),
        (log.keywords || "").replace(/"/g, '""'),
        (log.rawAnswer || "").replace(/"/g, '""'),
        log.rawAudioLink || "",
        log.grade || "",
        (log.correction || "").replace(/"/g, '""'),
        (log.translatedAnswer || "").replace(/"/g, '""'),
        (log.feedback || "").replace(/"/g, '""'),
        log.audioLink || ""
      ].map(val => `"${val}"`).join(","));

      // UTF-8 BOM 추가 (엑셀 한글 깨짐 방지)
      const csvContent = "\uFEFF" + [headers.join(","), ...csvRows].join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `OPIcFlow_StudyLog_${user.name}_${new Date().toLocaleDateString()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error("Excel download failed", e);
      alert("데이터를 가져오는 중 오류가 발생했습니다.");
    } finally {
      setIsDownloading(false);
    }
  };

  const toggleLogSelection = (id: string) => {
    setSelectedLogIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  useEffect(() => { 
    if (user.context.individualSheetId && units.length === 0) {
      loadAllData(user.context.individualSheetId); 
    }
  }, [user.context.individualSheetId, units.length, loadAllData]);

  const toggleCategory = (cat: string) => {
    const next = new Set(expandedCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setExpandedCategories(next);
  };

  const toggleTopic = (topic: string) => {
    const next = new Set(expandedTopics);
    if (next.has(topic)) next.delete(topic); else next.add(topic);
    setExpandedTopics(next);
  };

  const selectUnit = async (idx: number) => {
    stopAllAudio();
    setIsVocabularyView(false);
    const currentUnit = units[idx];
    const meta = masterQuestionDb.find(q => q.fullId === currentUnit.fullId);
    
    if (meta) {
      const nextCats = new Set(expandedCategories);
      nextCats.add(meta.category);
      setExpandedCategories(nextCats);
      if (currentUnit.unitId !== 'STRATEGY') {
        const nextTopics = new Set(expandedTopics);
        nextTopics.add(currentUnit.topic);
        setExpandedTopics(nextTopics);
      }
    }

    setSelectedUnitIdx(idx);
    setIsUnitPreview(true);
    setCurrentQuestion(null);
    setExtractedVocab([]);
    setIsRestudyMode(false);
    setIsSidebarOpen(false);
    setAiGenKeyword("");
    setManualQuestionText("");
    setGenMode('AI');
    
    const logs = await fetchStudyLogs(user.context.individualSheetId!, user.accessToken);
    const filtered = logs.filter(l => {
      const logUnit = l.unit || "";
      return logUnit.includes(`[${currentUnit.fullId}]`) || 
             logUnit === currentUnit.essence || 
             logUnit === currentUnit.topic;
    }).reverse();
    setUnitHistory(filtered);
  };

  const handleSurveyComplete = async (detailedAnswers: any[]) => {
    if (!user.context.individualSheetId) return;
    const success = await saveSurveyAndGenerateProgress(user.context.individualSheetId, detailedAnswers, user.accessToken);
    if (success) {
      setIsEditingSurvey(false);
      loadAllData(user.context.individualSheetId);
    } else {
      alert("서베이 및 커리큘럼 생성 중 오류가 발생했습니다.");
    }
  };

  const stopAllAudio = () => {
    if (activeAudioSource.current) { 
      try { activeAudioSource.current.stop(); } catch(e) {}
      activeAudioSource.current = null; 
    }
    window.speechSynthesis.cancel();
    setTtsState(null);
  };

  const getAiInstance = () => {
    const key = (geminiApiKey && geminiApiKey.trim()) || process.env.API_KEY;
    return new GoogleGenAI({ apiKey: key });
  };

  const playHighQualityAudio = async (text: string, id: string, driveUrl?: string) => {
    if (ttsState?.id === id) { stopAllAudio(); return; }
    stopAllAudio();

    const cleanText = (text || "").split(PART_DELIMITER).join(" ").trim();

    if (id === 'q' && cleanText) {
      setTtsState({ id, status: 'playing' });
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'en-US';
      utterance.rate = 0.9; 
      utterance.onend = () => setTtsState(null);
      utterance.onerror = () => setTtsState(null);
      window.speechSynthesis.speak(utterance);
      return;
    }

    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

    const cacheKey = cleanText;
    if (cleanText && localTtsCache.current.has(cacheKey)) {
      setTtsState({ id, status: 'playing' });
      const source = audioContextRef.current.createBufferSource();
      source.buffer = await decodeRawPcm(localTtsCache.current.get(cacheKey)!, audioContextRef.current);
      source.connect(audioContextRef.current.destination);
      source.onended = () => setTtsState(null);
      activeAudioSource.current = source;
      source.start();
      return;
    }

    if (id === 'correction' && syncingCorrectionSessionId.current && !driveUrl) {
      setTtsState({ id, status: 'loading' });
      const waitInterval = setInterval(() => {
        if (localTtsCache.current.has(cacheKey)) {
           clearInterval(waitInterval);
           playHighQualityAudio(text, id, driveUrl);
        }
      }, 1000);
      return;
    }

    setTtsState({ id, status: 'loading' });
    try {
      let buffer: AudioBuffer;
      const fileId = driveUrl ? extractFileId(driveUrl) : null;
      if (fileId) {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { Authorization: `Bearer ${user.accessToken}` }
        });
        const arrayBuffer = await res.arrayBuffer();
        if (id.includes('model') || id === 'correction' || (driveUrl && driveUrl.includes('AL_MODEL'))) {
          const bytes = new Uint8Array(arrayBuffer);
          if (cleanText) localTtsCache.current.set(cleanText, bytes);
          buffer = await decodeRawPcm(bytes, audioContextRef.current);
        } else {
          buffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        }
      } else {
        if (!cleanText) throw new Error("Text is empty");
        const ai = getAiInstance();
        const res = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: cleanText }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
          }
        });
        const audioData = decodeBase64(res.candidates![0].content.parts[0].inlineData!.data);
        if (cleanText) localTtsCache.current.set(cleanText, audioData);
        buffer = await decodeRawPcm(audioData, audioContextRef.current);
      }
      setTtsState({ id, status: 'playing' });
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setTtsState(null);
      activeAudioSource.current = source;
      source.start();
    } catch (e) { 
      console.error("TTS Error:", e);
      setTtsState(null); 
    }
  };

  const playNativeTts = (text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const startRecording = async () => {
    try {
      setRecordedBlob(null);
      setFeedbackResult(null);
      setShowTranslation(false);
      setExtractedVocab([]);
      setIsPaused(false);
      isCancellingRef.current = false;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 2.5; 
      const destination = audioCtx.createMediaStreamDestination();
      source.connect(gainNode);
      gainNode.connect(destination);
      const recorder = new MediaRecorder(destination.stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        if (isCancellingRef.current) {
          isCancellingRef.current = false;
          stream.getTracks().forEach(t => t.stop());
          audioCtx.close();
          return;
        }
        const finalBlob = new Blob(chunks, { type: 'audio/webm' });
        setRecordedBlob(finalBlob);
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        analyzeAudio(finalBlob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (e) { alert("마이크 권한 필요"); }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setIsPaused(false);
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
  };

  const togglePauseRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const cancelRecording = () => {
    if (!mediaRecorderRef.current) return;
    isCancellingRef.current = true;
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    setIsPaused(false);
  };

  const analyzeAudio = async (blob: Blob) => {
    if (isAnalyzing) return; 
    setIsAnalyzing(true);
    const dateObj = new Date();
    const timestamp = dateObj.getTime();
    const sessionId = `SESS_${timestamp}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const currentUnit = units[selectedUnitIdx!];
    const practiceTime = dateObj.toLocaleString();
    
    let directionInstructions = "";
    if (selectedDirection === 'EASY') {
      directionInstructions = `
        Focus on maximum preservation of the user's original expressions and sentence structures. 
        If the user's speech is logically sound and indicates an IH or AL level (relatively fluent and idiomatic), DO NOT rewrite it into a standard or 'better' style. 
        Keep their original voice. ONLY correct:
        1. Critical grammatical errors (subject-verb agreement, tense misuse).
        2. Phrases that are extremely unnatural or broken to the point of hindering understanding.
        Otherwise, maintain the user's vocabulary and flow as much as possible. 
        The goal is a 'polished' version of THEIR OWN words, not a new answer.
      `.trim();
    } else if (selectedDirection === 'NATIVE') {
      directionInstructions = "Focus on idiomatic expressions. Upgrade vocabulary to natural spoken 'Native idioms' (e.g., 'Blow off some steam' instead of 'stress relief'). Strengthen emotional adjectives and exclamations.";
    } else if (selectedDirection === 'STORYTELLER') {
      directionInstructions = "Focus on detailed storytelling. Add specific details using the 5W1H principle. Describe the atmosphere, weather, or exact feelings at that moment to make it sensory and vivid.";
    } else {
      directionInstructions = "Focus on providing a high-quality, balanced OPIc AL level response with natural flow and clear structure.";
    }

    try {
      setAnalysisStep("사용자 녹음본을 전용 폴더에 업로드 중입니다...");
      const rawDriveUrl = await uploadAudioToDrive(blob, `USER_RAW_${sessionId}.webm`, user.context.individualFolderId!, user.accessToken);

      setAnalysisStep("Ava가 답변을 분석 중입니다...");
      const ai = getAiInstance();
      const res = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: await blobToBase64(blob), mimeType: blob.type } },
            { text: `You are a professional OPIc AL Grader. Perform the following two tasks strictly:

TASK 1: Objective Evaluation
Analyze the user's audio based SOLELY on standard OPIc evaluation criteria. DO NOT let the selected style preference (${selectedDirection || 'none'}) affect the grading.
1. transcript: Exact transcription of the user's speech.
2. predictedLevel: Objective level (AL, IH, IH, IM3, IM2, IM1, NH) based on the audio performance.
3. feedback: Constructive advice for the user in KOREAN based on standard criteria.

TASK 2: Stylized Model Answer
Generate a perfect OPIc AL level model answer incorporating the user's keywords: "${userKeywords}" based on the given question.
Target Question: "${currentQuestion!.question}"

4. correctionParts: A high-quality model answer in 3 parts (intro, body, conclusion). ONLY FOR THIS PART, strictly follow these style guidelines: ${directionInstructions}.
5. translationParts: Korean translation of the model answer.

Output as JSON: {"transcript":string,"correctionParts":{"intro":string,"body":string,"conclusion":string},"translationParts":{"intro":string,"body":string,"conclusion":string},"feedback":string,"predictedLevel":string}` }
          ]
        },
        config: { responseMimeType: "application/json" }
      });
      const data = JSON.parse(res.text!);
      
      const pIntro = cleanAiText(data.correctionParts.intro);
      const pBody = cleanAiText(data.correctionParts.body);
      const pConclusion = cleanAiText(data.correctionParts.conclusion);

      const tIntro = cleanAiText(data.translationParts.intro);
      const tBody = cleanAiText(data.translationParts.body);
      const tConclusion = cleanAiText(data.translationParts.conclusion);

      const result = {
        transcript: cleanAiText(data.transcript),
        correction: `${pIntro}${PART_DELIMITER}${pBody}${PART_DELIMITER}${pConclusion}`,
        translatedAnswer: `${tIntro}${PART_DELIMITER}${tBody}${PART_DELIMITER}${tConclusion}`,
        correctionParts: { intro: pIntro, body: pBody, conclusion: pConclusion },
        translationParts: { intro: tIntro, body: tBody, conclusion: tConclusion },
        feedback: cleanAiText(data.feedback),
        predictedLevel: data.predictedLevel || "IM",
        rawAudioLink: rawDriveUrl || "",
        audioLink: "",
        date: practiceTime
      };
      
      setFeedbackResult(result);
      
      const initialLog: StudyLogEntry = {
        sessionId,
        date: practiceTime,
        unit: `[${currentUnit.fullId}] ${currentUnit.topic} - ${currentUnit.essence}`, 
        type: currentQuestion!.type || masterQuestionDb.find(q => q.fullId === currentUnit.fullId)?.strategy || "General",
        question: currentQuestion!.question,
        keywords: userKeywords,
        rawAnswer: result.transcript,
        rawAudioLink: result.rawAudioLink, 
        grade: result.predictedLevel,
        correction: result.correction, 
        translatedAnswer: result.translatedAnswer,
        feedback: result.feedback,
        audioLink: "" 
      };
      
      await saveStudyLog(user.context.individualSheetId!, initialLog, user.accessToken);
      setUnitHistory(prev => [initialLog, ...prev]);

      await updateUnitStatus(user.context.individualSheetId!, selectedUnitIdx!, user.accessToken, "완료", result.predictedLevel, practiceTime);
      updateMasterProgress(user.email, user.context.individualSheetId!, user.accessToken);
      setUnits(prev => prev.map((u, i) => i === selectedUnitIdx ? { ...u, status: "완료", grade: result.predictedLevel, lastPractice: practiceTime } : u));

      processOnlyModelMedia(initialLog);
    } catch (e) { console.error(e); alert("분석 실패"); } finally { setIsAnalyzing(false); }
  };

  const processOnlyModelMedia = async (log: StudyLogEntry) => {
    try {
      syncingCorrectionSessionId.current = log.sessionId; 
      const plainCorrection = (log.correction || "").split(PART_DELIMITER).join(" ").trim();
      if (!plainCorrection) return;

      const ai = getAiInstance();
      const ttsRes = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: plainCorrection }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
        }
      });
      const ttsData = decodeBase64(ttsRes.candidates![0].content.parts[0].inlineData!.data);
      
      localTtsCache.current.set(plainCorrection, ttsData); 
      
      const modelDriveUrl = await uploadAudioToDrive(new Blob([ttsData], { type: 'audio/pcm' }), `AL_MODEL_${log.sessionId}.pcm`, user.context.individualFolderId!, user.accessToken);
      
      const updatedLog = { ...log, audioLink: modelDriveUrl || "" };
      await updateStudyLog(user.context.individualSheetId!, updatedLog, user.accessToken);
      
      setFeedbackResult(prev => prev ? { ...prev, audioLink: modelDriveUrl || "" } : null);
      setUnitHistory(prev => prev.map(h => h.sessionId === log.sessionId ? updatedLog : h));
    } catch (e) { 
      console.error("Model media sync fail", e); 
    } finally {
      syncingCorrectionSessionId.current = null; 
    }
  };

  const startNewSession = async () => {
    setIsGenerating(true);
    stopAllAudio();
    setIsRestudyMode(false);
    setShowTranslation(false);
    setExtractedVocab([]);
    const meta = masterQuestionDb.find(q => q.fullId === units[selectedUnitIdx!].fullId);
    try {
      const ai = getAiInstance();
      const keywordContext = aiGenKeyword ? `Reflect this specific context or keyword in the question generation: "${aiGenKeyword}". ` : "";
      const prompt = meta 
        ? `As an OPIc expert, generate a realistic exam question based on these: Topic: ${meta.topic}, Essence: ${meta.essence}, Strategy: ${meta.strategy}. ${keywordContext} Output JSON: {"unit":string,"type":string,"question":string,"description":string}`
        : `Generate OPIc question for "${units[selectedUnitIdx!].topic}". ${keywordContext} JSON: {"unit":string,"type":string,"question":string,"description":string}`;
      const res = await ai.models.generateContent({ model: "gemini-3-flash-preview", contents: prompt, config: { responseMimeType: "application/json" } });
      setCurrentQuestion(JSON.parse(res.text!));
      setUserKeywords("");
      setFeedbackResult(null);
      setIsUnitPreview(false);
    } catch (e) { alert("질문 생성 실패"); } finally { setIsGenerating(false); }
  };

  const startManualSession = () => {
    if (!manualQuestionText.trim()) {
      alert("질문을 입력해주세요.");
      return;
    }
    stopAllAudio();
    setIsRestudyMode(false);
    setShowTranslation(false);
    setExtractedVocab([]);
    const currentUnit = units[selectedUnitIdx!];
    setCurrentQuestion({
      unit: currentUnit.topic,
      type: "Direct Input",
      question: manualQuestionText.trim(),
      description: "User provided manual question"
    });
    setUserKeywords("");
    setFeedbackResult(null);
    setIsUnitPreview(false);
  };

  const restudyLog = (log: StudyLogEntry) => {
    stopAllAudio();
    setIsVocabularyView(false);
    setIsUnitPreview(false);
    setIsRestudyMode(true);
    setShowTranslation(false);
    setExtractedVocab([]);
    setCurrentQuestion({ unit: log.unit, type: log.type, question: log.question, description: "" });
    
    let correctionParts = undefined;
    if (log.correction && log.correction.includes(PART_DELIMITER)) {
      const parts = log.correction.split(PART_DELIMITER);
      correctionParts = { intro: parts[0] || "", body: parts[1] || "", conclusion: parts[2] || "" };
    }

    let translationParts = undefined;
    if (log.translatedAnswer && log.translatedAnswer.includes(PART_DELIMITER)) {
      const parts = log.translatedAnswer.split(PART_DELIMITER);
      translationParts = { intro: parts[0] || "", body: parts[1] || "", conclusion: parts[2] || "" };
    }

    setFeedbackResult({ 
      transcript: log.rawAnswer, 
      correction: log.correction, 
      translatedAnswer: log.translatedAnswer,
      correctionParts,
      translationParts,
      feedback: log.feedback, 
      predictedLevel: log.grade || "",
      rawAudioLink: log.rawAudioLink,
      audioLink: log.audioLink,
      date: log.date
    });
    setUserKeywords(log.keywords || "");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteLog = async (log: StudyLogEntry) => {
    if (!confirm("삭제하시겠습니까?")) return;
    setDeletingId(log.sessionId);
    try {
      if (log.audioLink) await deleteFileFromDrive(log.audioLink, user.accessToken);
      if (log.rawAudioLink) await deleteFileFromDrive(log.rawAudioLink, user.accessToken);
      const success = await deleteStudyLogBySessionId(user.context.individualSheetId!, log.sessionId, user.accessToken);
      if (success) {
        const remainingLogs = unitHistory.filter(h => h.sessionId !== log.sessionId);
        setUnitHistory(remainingLogs);
        if (remainingLogs.length === 0) {
          await updateUnitStatus(user.context.individualSheetId!, selectedUnitIdx!, user.accessToken, "미완료", "-", "-");
          setUnits(prev => prev.map((u, i) => i === selectedUnitIdx ? { ...u, status: "미완료", grade: "-", lastPractice: "-" } : u));
        }
        updateMasterProgress(user.email, user.context.individualSheetId!, user.accessToken);
      }
    } finally { setDeletingId(null); }
  };

  const openVocabularyBank = async () => {
    setIsVocabularyView(true);
    setIsSidebarOpen(false);
    setSelectedUnitIdx(null);
    setIsUnitPreview(false);
    setIsLoadingVocab(true);
    try {
      const data = await fetchVocabularyBank(user.context.individualSheetId!, user.accessToken);
      setSavedVocabList(data.reverse());
    } catch (e) {
      console.error("Fetch Vocab Fail", e);
    } finally {
      setIsLoadingVocab(false);
    }
  };

  const extractKeyVocab = async () => {
    if (!feedbackResult || isExtractingVocab) return;
    setIsExtractingVocab(true);
    const modelAnswer = feedbackResult.correction.split(PART_DELIMITER).join(" ");
    try {
      const ai = getAiInstance();
      const res = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are an OPIc expert. From the provided model answer, extract exactly 10 essential expressions or phrases that are critical for achieving an AL (Advanced Low) grade.
        For each expression, provide:
        1. expression (the phrase in English)
        2. meaning (Korean translation)
        3. usageExample (a short natural English sentence using the expression)
        Output MUST be a JSON array of objects like: [{"expression": "...", "meaning": "...", "usageExample": "..."}]
        
        Model Answer: "${modelAnswer}"`,
        config: { responseMimeType: "application/json" }
      });
      const data = JSON.parse(res.text!);
      setExtractedVocab(data);
    } catch (e) {
      console.error("Vocab Extraction Fail", e);
      alert("표현 추출에 실패했습니다.");
    } finally {
      setIsExtractingVocab(false);
    }
  };

  const handleSaveVocabEntry = async (item: any) => {
    const vocabId = `V_${Date.now()}_${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    const entry: VocabularyEntry = {
      id: vocabId,
      expression: item.expression,
      meaning: item.meaning,
      usageExample: item.usageExample,
      unitSource: units[selectedUnitIdx!]?.essence || "General",
      addedDate: new Date().toLocaleDateString(),
      status: "Learning"
    };

    setSavingVocabIds(prev => new Set(prev).add(item.expression));
    try {
      const success = await saveVocabularyEntry(user.context.individualSheetId!, entry, user.accessToken);
      if (success) {
      }
    } catch (e) {
      alert("저장 실패");
    } finally {
      setSavingVocabIds(prev => {
        const next = new Set(prev);
        next.delete(item.expression);
        return next;
      });
    }
  };

  const handleDeleteVocab = async (vId: string) => {
    if (!confirm("단어장에서 삭제하시겠습니까?")) return;
    try {
      const success = await deleteVocabularyEntry(user.context.individualSheetId!, vId, user.accessToken);
      if (success) {
        setSavedVocabList(prev => prev.filter(v => v.id !== vId));
      }
    } catch (e) {
      alert("삭제 실패");
    }
  };

  const renderSpeakerIcon = (id: string, color: string = "text-blue-600") => {
    const s = ttsState?.id === id ? ttsState.status : null;
    if (s === 'loading') return <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>;
    if (s === 'playing') return (
      <svg className="w-4 h-4 text-red-500 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
      </svg>
    );
    return (
      <svg className={`w-4 h-4 ${color} hidden-print`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
      </svg>
    );
  };

  const toggleDirection = (dir: AnswerDirection) => {
    setSelectedDirection(prev => prev === dir ? null : dir);
  };

  const handleProvisioningReady = (sheetId: string) => {
    setUser(prev => ({ ...prev, context: { ...prev.context, status: 'SURVEY_REQUIRED', individualSheetId: sheetId } }));
    loadAllData(sheetId);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleBatchPrintTrigger = () => {
    if (selectedLogIds.size === 0) {
      alert("출력할 학습 내역을 최소 하나 선택해 주세요.");
      return;
    }
    setIsHistoryPrintModalOpen(false);
    
    // 배치 인쇄 모드 활성화 (CSS 분기용)
    document.body.classList.add('is-printing-batch');
    
    setTimeout(() => {
      window.print();
      // 인쇄창이 닫힌 후(혹은 취소 후) 클래스 제거
      setTimeout(() => {
        document.body.classList.remove('is-printing-batch');
      }, 1000);
    }, 500);
  };

  if (!user.context.individualSheetId) return <SheetProvisioning user={user} onReady={handleProvisioningReady} />;
  if (isLoadingData) return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
      <h2 className="text-xl font-black">학습 데이터를 불러오는 중...</h2>
    </div>
  );
  if (!user.context.survey || isEditingSurvey) return <Survey initialData={user.context.survey} onComplete={handleSurveyComplete} onCancel={user.context.survey ? () => setIsEditingSurvey(false) : undefined} accessToken={user.accessToken} />;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {isGlobalProgressOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 hidden-print">
          <div className="bg-white w-full max-w-2xl max-h-[85vh] rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="bg-slate-900 px-8 py-6 flex justify-between items-center text-white shrink-0">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-600 p-2 rounded-xl">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2-2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                </div>
                <div>
                  <h2 className="text-xl font-black italic uppercase tracking-tighter">Class Ranking</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Real-time Progress Leaderboard</p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <button onClick={openGlobalRanking} className="p-2 hover:bg-white/10 rounded-full transition-colors text-blue-400" title="새로고침">
                  <svg className={`w-5 h-5 ${isFetchingRanking ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                </button>
                <button onClick={() => setIsGlobalProgressOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
            <div className="flex-grow overflow-y-auto p-6 lg:p-10 custom-scrollbar space-y-4">
              {isFetchingRanking ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="font-bold text-slate-400">최신 학습 현황을 불러오는 중...</p>
                </div>
              ) : allUsersProgress.length === 0 ? (
                <div className="text-center py-20 text-slate-400 font-bold">참여 중인 학습자가 없습니다.</div>
              ) : (
                allUsersProgress.map((u, i) => {
                  const isMe = u.email.toLowerCase() === user.email.toLowerCase();
                  const progressValue = parseInt(u.progress) || 0;
                  return (
                    <div key={i} className={`group flex items-center p-4 rounded-2xl border transition-all ${isMe ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-slate-50 hover:bg-slate-50'}`}>
                      <div className="w-10 flex items-center justify-center shrink-0">
                        {i < 3 ? <span className="text-xl font-black">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span> : <span className="text-sm font-black text-slate-300">#{i + 1}</span>}
                      </div>
                      <div className="flex-grow px-4 overflow-hidden">
                        <div className="flex items-center space-x-2 mb-1.5">
                          <h4 className="font-black text-sm text-slate-800 truncate">{u.name}</h4>
                          <span className="text-[10px] text-slate-400 font-medium">{maskEmail(u.email)}</span>
                          {isMe && <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 rounded-full uppercase tracking-widest italic">Me</span>}
                        </div>
                        <div className="flex items-center space-x-3">
                          <div className="flex-grow h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full transition-all duration-1000 ${progressValue >= 80 ? 'bg-green-500' : progressValue >= 40 ? 'bg-blue-500' : 'bg-amber-400'}`} style={{ width: u.progress }}></div>
                          </div>
                          <span className="text-xs font-black text-slate-600 italic shrink-0 w-8">{u.progress}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {isHistoryPrintModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 hidden-print">
          <div className="bg-white w-full max-w-2xl max-h-[85vh] rounded-[40px] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 duration-500">
            <div className="bg-blue-600 px-8 py-6 flex justify-between items-center text-white shrink-0">
              <div className="flex items-center space-x-3">
                <div className="bg-white/20 p-2 rounded-xl">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                </div>
                <div>
                  <h2 className="text-xl font-black italic uppercase tracking-tighter">Report Print</h2>
                  <p className="text-[10px] text-blue-100 font-bold uppercase tracking-widest">출력할 학습 내역을 선택하세요</p>
                </div>
              </div>
              <button onClick={() => setIsHistoryPrintModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="flex-grow overflow-y-auto p-6 custom-scrollbar">
              {isFetchingAllLogs ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="font-bold text-slate-400">학습 히스토리를 불러오고 있습니다...</p>
                </div>
              ) : allLogsForPrint.length === 0 ? (
                <div className="text-center py-20 text-slate-400 font-bold">학습 기록이 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-4 px-2">
                    <span className="text-[11px] font-black text-slate-400 uppercase">전체 {allLogsForPrint.length}건</span>
                    <button 
                      onClick={() => setSelectedLogIds(selectedLogIds.size === allLogsForPrint.length ? new Set() : new Set(allLogsForPrint.map(l => l.sessionId)))}
                      className="text-[10px] font-black text-blue-600 uppercase hover:underline"
                    >
                      {selectedLogIds.size === allLogsForPrint.length ? "전체 해제" : "전체 선택"}
                    </button>
                  </div>
                  {allLogsForPrint.map((log) => (
                    <div 
                      key={log.sessionId} 
                      onClick={() => toggleLogSelection(log.sessionId)}
                      className={`flex items-center p-4 rounded-2xl border cursor-pointer transition-all ${selectedLogIds.has(log.sessionId) ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-slate-100 hover:bg-slate-50'}`}
                    >
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 mr-4 transition-all ${selectedLogIds.has(log.sessionId) ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200'}`}>
                        {selectedLogIds.has(log.sessionId) && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>}
                      </div>
                      <div className="flex-grow overflow-hidden">
                        <div className="flex items-center space-x-2 mb-0.5">
                           <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter">{log.date}</span>
                           <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 rounded italic uppercase">{log.grade}</span>
                        </div>
                        <h4 className="font-bold text-sm text-slate-800 truncate">{log.unit}</h4>
                        <p className="text-[10px] text-slate-500 truncate italic">Q: {log.question}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-50 bg-slate-50 shrink-0">
               <button 
                onClick={handleBatchPrintTrigger}
                disabled={selectedLogIds.size === 0}
                className={`w-full py-5 rounded-[24px] font-black text-lg shadow-xl transition-all flex items-center justify-center space-x-3 ${selectedLogIds.size > 0 ? 'bg-slate-900 text-white hover:bg-blue-600' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                 <span>선택한 {selectedLogIds.size}개 항목 인쇄하기</span>
               </button>
            </div>
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur flex items-center justify-center p-6 hidden-print">
          <div className="bg-white p-8 rounded-[32px] shadow-2xl text-center max-w-xs w-full">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-black italic">AI Ava Thinking...</h2>
          </div>
        </div>
      )}
      
      <nav className="bg-white border-b px-4 py-3 flex justify-between items-center sticky top-0 z-50 hidden-print">
        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => { setSelectedUnitIdx(null); setIsSidebarOpen(false); setIsVocabularyView(false); }}>
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-md">
            <span className="text-white text-xs font-black italic">OF</span>
          </div>
          <span className="text-base font-black italic">OPIC<span className="text-blue-600">FLOW</span></span>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={openHistoryPrintModal} className="hidden md:flex items-center space-x-2 px-4 py-2 bg-blue-50 text-blue-600 border border-blue-100 rounded-full text-[11px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-sm active:scale-95">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
            <span>종합 리포트 출력</span>
          </button>
          
          <button onClick={handleExcelDownload} disabled={isDownloading} className="hidden md:flex items-center space-x-2 px-4 py-2 bg-green-50 text-green-700 border border-green-100 rounded-full text-[11px] font-black uppercase tracking-widest hover:bg-green-600 hover:text-white transition-all shadow-sm active:scale-95 disabled:opacity-50">
            {isDownloading ? (
              <div className="w-3.5 h-3.5 border-2 border-green-700 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            )}
            <span>엑셀 다운로드</span>
          </button>

          <button onClick={openGlobalRanking} className="hidden md:flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white rounded-full text-[11px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all shadow-lg active:scale-95">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2-2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            <span>클래스 랭킹</span>
          </button>
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="lg:hidden p-2 text-slate-500 hover:text-blue-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7" /></svg>
          </button>
          <img src={user.picture} className="w-8 h-8 rounded-full border border-slate-100" />
          <button onClick={onLogout} className="text-[10px] font-black text-slate-300 hover:text-red-500 uppercase tracking-tighter">Logout</button>
        </div>
      </nav>

      <div className="hidden print-only-header mb-8 pb-4 border-b-2 border-slate-900">
          <div className="flex justify-between items-end">
              <div>
                <h1 className="text-2xl font-black italic uppercase tracking-tighter">OPIc<span className="text-blue-600">FLOW</span> Study Report</h1>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">AI-Powered OPIc Learning Analysis</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold text-slate-900">{user.name} ({maskEmail(user.email)})</p>
                <p className="text-[9px] text-slate-400 font-medium">Report Generated: {new Date().toLocaleString()}</p>
              </div>
          </div>
      </div>

      <main className="container flex flex-col flex-grow gap-6 px-4 py-4 mx-auto max-w-7xl lg:py-6 lg:flex-row printable-area">
        <aside className={`fixed lg:static inset-y-0 left-0 z-[70] lg:z-0 w-72 lg:w-80 bg-white lg:bg-transparent transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} p-6 lg:p-0 border-r lg:border-none hidden-print`}>
          <div className="flex flex-col h-full p-2 overflow-hidden bg-white shadow-sm rounded-3xl lg:border lg:sticky lg:top-24 lg:max-h-[85vh]">
            <div className="flex flex-col p-4 mb-2 shrink-0 border-b border-slate-50">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Curriculum</h2>
                <div className="flex items-center space-x-1">
                  <span className="text-[10px] font-bold text-blue-600">{units.filter(u => u.status === '완료').length}/{units.length}</span>
                  <span className="text-[10px] text-slate-300 font-bold italic">Clear</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setIsEditingSurvey(true)}
                  className="py-2 px-3 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center space-x-1 border border-slate-100"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 00-2 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  <span>서베이 수정</span>
                </button>
                <button 
                  onClick={openVocabularyBank}
                  className={`py-2 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center space-x-1 border ${isVocabularyView ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-slate-50 hover:bg-slate-100 text-slate-500 border-slate-100'}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                  <span>단어장</span>
                </button>
              </div>
            </div>
            <div className="flex-grow space-y-3 overflow-y-auto custom-scrollbar p-3">
              {(Object.entries(structuredCurriculum) as [string, any][]).map(([category, content]) => {
                const isCatExpanded = expandedCategories.has(category);
                return (
                  <div key={category} className="flex flex-col space-y-1">
                    <button onClick={() => toggleCategory(category)} className={`flex items-center justify-between p-3 rounded-xl transition-all ${isCatExpanded ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
                      <div className="flex items-center justify-between overflow-hidden text-left">
                        <div className="flex items-center space-x-2">
                          <svg className={`w-3 h-3 transition-transform shrink-0 ${isCatExpanded ? 'rotate-180 text-blue-400' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                          <span className="text-[11px] font-black truncate uppercase tracking-tight">{category}</span>
                        </div>
                      </div>
                    </button>
                    {isCatExpanded && (
                      <div className="pl-1 pt-1 space-y-2 animate-in slide-in-from-top-2 duration-300">
                        {content.directUnits.map((item: any) => {
                          const isSelected = !isVocabularyView && selectedUnitIdx === item.originalIndex;
                          const u = item.unit;
                          return (
                            <button key={u.fullId} onClick={() => selectUnit(item.originalIndex)} className={`w-full text-left p-3 rounded-xl border transition-all ${isSelected ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-100'}`}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className={`text-[7px] font-black uppercase ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>{u.fullId}</span>
                                <div className="flex items-center space-x-1">
                                  {u.grade !== "-" && <span className={`text-[7px] font-black px-1 rounded ${isSelected ? 'bg-white/20' : 'bg-blue-100 text-blue-700'}`}>{u.grade}</span>}
                                  {u.status === '완료' && <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-green-400'}`}></div>}
                                </div>
                              </div>
                              <h4 className="text-[10px] font-bold truncate leading-tight">{u.topic}</h4>
                            </button>
                          );
                        })}
                        {(Object.entries(content.topicGroups) as [string, any][]).map(([topic, group]) => {
                          const isTopicExpanded = expandedTopics.has(topic);
                          return (
                            <div key={topic} className="flex flex-col space-y-1 ml-1">
                              <button onClick={() => toggleTopic(topic)} className={`flex items-center justify-between p-2 rounded-lg transition-all ${isTopicExpanded ? 'bg-blue-50 text-blue-700' : 'bg-white border border-slate-100 text-slate-500'}`}>
                                <div className="flex items-center space-x-2 overflow-hidden">
                                  <svg className={`w-2.5 h-2.5 transition-transform shrink-0 ${isTopicExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                                  <span className="text-[10px] font-bold truncate">{topic}</span>
                                </div>
                                <span className="text-[9px] font-bold px-2">{group.units.filter((u: any) => u.status === '완료').length}/{group.units.length}</span>
                              </button>
                              {isTopicExpanded && (
                                <div className="pl-2 space-y-1 mt-1">
                                  {group.units.map((u: any, i: number) => {
                                    const isSelected = !isVocabularyView && selectedUnitIdx === group.originalIndexes[i];
                                    return (
                                      <button key={u.fullId} onClick={() => selectUnit(group.originalIndexes[i])} className={`w-full text-left p-2.5 rounded-lg border transition-all ${isSelected ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-50'}`}>
                                        <div className="flex items-center justify-between mb-0.5">
                                          <span className={`text-[7px] font-black uppercase ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>{u.fullId}</span>
                                          <div className="flex items-center space-x-1">
                                            {u.grade !== "-" && <span className={`text-[7px] font-black px-1 rounded ${isSelected ? 'bg-white/20' : 'bg-blue-100 text-blue-700'}`}>{u.grade}</span>}
                                            {u.status === '완료' && <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-green-400'}`}></div>}
                                          </div>
                                        </div>
                                        <h4 className="text-[10px] font-bold truncate leading-tight">{i + 1}. {u.essence}</h4>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="flex flex-col flex-grow min-w-0">
          <div className="bg-white rounded-[24px] lg:rounded-[40px] border shadow-sm flex flex-col min-h-[500px] lg:min-h-[600px] overflow-hidden relative">
            <div className="flex-grow p-5 overflow-y-auto lg:p-8 custom-scrollbar scroll-smooth">
              {isVocabularyView ? (
                <div className="flex flex-col h-full animate-in fade-in duration-500">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-3xl font-black italic tracking-tighter uppercase">Vocabulary Bank</h2>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">나만의 커스텀 단어장</p>
                    </div>
                    <button onClick={openVocabularyBank} className="p-2 bg-slate-100 rounded-full hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-colors hidden-print">
                      <svg className={`w-5 h-5 ${isLoadingVocab ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    </button>
                  </div>

                  {isLoadingVocab ? (
                    <div className="flex flex-col items-center justify-center py-20">
                      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <p className="font-black text-slate-400 uppercase tracking-widest text-[10px]">Loading Bank...</p>
                    </div>
                  ) : savedVocabList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
                      <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                      <p className="font-black text-slate-500 uppercase tracking-tight">저장된 단어가 없습니다.</p>
                      <p className="text-xs font-bold mt-1">학습 세션 후 모범답안에서 표현을 추출해보세요!</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {savedVocabList.map((v) => (
                        <div key={v.id} className="group p-6 bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-xl hover:border-blue-100 transition-all relative">
                          <button onClick={() => handleDeleteVocab(v.id)} className="absolute top-4 right-4 text-slate-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 hidden-print">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                          <div className="flex flex-col h-full">
                            <div className="mb-1 flex items-center space-x-2">
                              <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">{v.unitSource}</span>
                              <span className="text-[9px] font-bold text-slate-300">| {v.addedDate}</span>
                            </div>
                            <div className="flex items-center space-x-2 mb-1">
                                <h3 className="text-xl font-black text-slate-900">{v.expression}</h3>
                                <button onClick={() => playNativeTts(v.expression)} className="p-1.5 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-600 hover:text-white transition-all hidden-print">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                                    </svg>
                                </button>
                            </div>
                            <p className="text-sm font-bold text-blue-600 mb-4">{v.meaning}</p>
                            <div className="mt-auto pt-4 border-t border-slate-50 italic text-[11px] text-slate-500 leading-relaxed font-medium">
                              "{v.usageExample}"
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : !selectedUnitIdx && selectedUnitIdx !== 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                  <div className="w-16 h-16 lg:w-20 lg:h-20 bg-blue-50 rounded-[32px] lg:rounded-[40px] flex items-center justify-center text-blue-600 mb-6 shadow-inner animate-pulse"><svg className="w-8 h-8 lg:w-10 lg:h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></div>
                  <h2 className="px-4 text-2xl font-black italic tracking-tight lg:text-3xl">Select a Topic to Start</h2>
                  <p className="px-4 mt-2 font-medium text-slate-400">좌측 커리큘럼에서 학습할 주제를 선택해 주세요.</p>
                </div>
              ) : isUnitPreview ? (
                <div className="flex flex-col h-full">
                  <div className="flex flex-col items-center justify-center flex-grow py-6 text-center">
                    <div className="bg-slate-900 text-white text-[9px] font-black px-4 py-2 rounded-lg uppercase mb-4 tracking-widest shadow-lg">{units[selectedUnitIdx].unitId}</div>
                    <h2 className="px-2 mb-2 text-3xl font-black leading-tight tracking-tighter lg:text-4xl">{units[selectedUnitIdx].topic}</h2>
                    <p className="text-lg text-slate-500 font-bold mb-6 italic max-w-lg mx-auto leading-relaxed">"{units[selectedUnitIdx].essence}"</p>
                    {units[selectedUnitIdx].status === "완료" && (
                      <div className="mb-10 p-4 bg-blue-50 border border-blue-100 rounded-2xl inline-flex items-center space-x-6">
                        <div className="text-center">
                          <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Grade</p>
                          <p className="text-xl font-black text-blue-700 italic">{units[selectedUnitIdx].grade}</p>
                        </div>
                        <div className="w-[1px] h-8 bg-blue-200"></div>
                        <div className="text-center">
                          <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Last Practice</p>
                          <p className="text-[11px] font-bold text-blue-700">{units[selectedUnitIdx].lastPractice.split(',')[0]}</p>
                        </div>
                      </div>
                    )}
                    
                    {/* New Generation Choice UI */}
                    <div className="w-full max-w-xl mx-auto bg-slate-50 border border-slate-200 rounded-[32px] overflow-hidden shadow-sm mb-8 hidden-print">
                      <div className="flex border-b border-slate-200">
                        <button 
                          onClick={() => setGenMode('AI')} 
                          className={`flex-1 py-4 text-xs font-black uppercase tracking-widest transition-all ${genMode === 'AI' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          AI 질문 생성
                        </button>
                        <button 
                          onClick={() => setGenMode('MANUAL')} 
                          className={`flex-1 py-4 text-xs font-black uppercase tracking-widest transition-all ${genMode === 'MANUAL' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          직접 입력
                        </button>
                      </div>
                      
                      <div className="p-6">
                        {genMode === 'AI' ? (
                          <div className="space-y-4 animate-in fade-in duration-300">
                            <div className="text-left">
                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">상황/키워드 추가 (선택사항)</label>
                              <input 
                                type="text" 
                                value={aiGenKeyword}
                                onChange={(e) => setAiGenKeyword(e.target.value)}
                                placeholder="ex) 친구와 약속, 주말 여행, 장비 고장 등" 
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:border-blue-400 transition-all font-bold text-sm"
                              />
                            </div>
                            <button onClick={startNewSession} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all flex items-center justify-center space-x-2">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                              <span>AI 질문 생성 시작</span>
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4 animate-in fade-in duration-300">
                            <div className="text-left">
                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 block">질문 내용 입력</label>
                              <textarea 
                                value={manualQuestionText}
                                onChange={(e) => setManualQuestionText(e.target.value)}
                                placeholder="연습하고 싶은 질문을 여기에 붙여넣으세요." 
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:border-blue-400 transition-all font-bold text-sm h-24"
                              />
                            </div>
                            <button onClick={startManualSession} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-lg shadow-xl hover:bg-blue-600 transition-all flex items-center justify-center space-x-2">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 00-2 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                              <span>이 질문으로 학습 시작</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {unitHistory.length > 0 && (
                    <div className="pt-8 pb-6 mt-10 border-t hidden-print">
                      <h3 className="flex items-center mb-6 space-x-2 text-base font-black text-slate-800"><svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span>최근 학습 이력 <span className="text-blue-600">({unitHistory.length})</span></span></h3>
                      <div className="grid gap-4">
                        {unitHistory.map((h) => (
                          <div key={h.sessionId} className="flex flex-col gap-4 p-5 transition-all border bg-slate-50 rounded-2xl border-slate-100 lg:flex-row hover:bg-white hover:shadow-lg">
                            <div className="flex-grow">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-tighter">{h.date}</span>
                                  {h.grade && h.grade !== "-" && (
                                    <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter">{h.grade}</span>
                                  )}
                                </div>
                                <div className="flex space-x-1">
                                  <button onClick={() => restudyLog(h)} className="px-3 py-1 bg-white text-blue-600 border border-blue-100 rounded-full text-[9px] font-black hover:bg-blue-600 hover:text-white transition-all shadow-sm">복습</button>
                                  <button onClick={() => handleDeleteLog(h)} className="p-1 transition-colors text-slate-200 hover:text-red-500">{deletingId === h.sessionId ? "..." : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>}</button>
                                </div>
                              </div>
                              <p className="mb-3 text-xs font-bold italic text-slate-800 line-clamp-2">"{h.question}"</p>
                              <div className="flex flex-wrap gap-2">
                                {h.rawAudioLink && <button onClick={() => playHighQualityAudio("", `user-${h.sessionId}`, h.rawAudioLink)} className="flex items-center space-x-2 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full text-[9px] font-black border border-blue-100">{renderSpeakerIcon(`user-${h.sessionId}`, "text-blue-500")}<span>내 답변 듣기</span></button>}
                                {h.audioLink && <button onClick={() => playHighQualityAudio(h.correction, `model-${h.sessionId}`, h.audioLink)} className="flex items-center space-x-2 bg-green-50 text-green-600 px-3 py-1.5 rounded-full text-[9px] font-black border border-green-100">{renderSpeakerIcon(`model-${h.sessionId}`, "text-green-500")}<span>AL 모범답안</span></button>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col h-full space-y-5 lg:space-y-6">
                  {currentQuestion && (
                    <>
                      {isRestudyMode && <div className="flex items-center space-x-2 text-blue-600 font-black text-[9px] uppercase mb-1 bg-blue-50 px-4 py-2 rounded-full w-fit hidden-print"><span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse"></span><span>Review Mode</span></div>}
                      
                      {/* 인쇄용 세션 헤더 (종합 리포트 스타일) */}
                      {feedbackResult && (
                        <div className="hidden print:block mb-4">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                              Study Report | {feedbackResult.date || new Date().toLocaleString()}
                            </span>
                            <span className="bg-slate-900 text-white text-[10px] font-black px-2 py-0.5 rounded italic">
                              Level: {feedbackResult.predictedLevel}
                            </span>
                          </div>
                          <h3 className="text-xl font-black text-slate-800 leading-tight">
                            [{units[selectedUnitIdx!].fullId}] {units[selectedUnitIdx!].topic} - {units[selectedUnitIdx!].essence}
                          </h3>
                        </div>
                      )}

                      <div className="p-5 transition-all border bg-slate-50 rounded-2xl lg:p-8 border-slate-100 flex items-start gap-4 hover:bg-white hover:shadow-sm print:shadow-none print:border-slate-300 print:bg-white print:p-4 print:rounded-xl print:mb-4">
                        <div className="flex-grow">
                          <span className="text-[8px] font-black text-blue-600 uppercase tracking-widest mb-1 block print:text-slate-400 print:text-[8px]">Question ({units[selectedUnitIdx!].essence})</span>
                          <h2 className="text-lg font-bold leading-snug tracking-tight lg:text-xl text-slate-800 print:text-sm print:italic">"{currentQuestion.question}"</h2>
                        </div>
                        <button onClick={() => playHighQualityAudio(currentQuestion.question, 'q')} className={`p-3 lg:p-4 rounded-xl shadow-md transition-all shrink-0 hidden-print ${ttsState?.id === 'q' ? 'bg-blue-600 text-white' : 'bg-white text-slate-400'}`}>{renderSpeakerIcon('q', ttsState?.id === 'q' ? 'text-white' : 'text-slate-400')}</button>
                      </div>
                      
                      {feedbackResult ? (
                        <div className="pb-10 space-y-5 lg:space-y-6 animate-in zoom-in-95 duration-500 print:space-y-4 print:pb-0">
                          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm printable-model-answer print:border-slate-300 print:shadow-none print:rounded-lg">
                            <div className="bg-blue-600 px-6 py-3 flex justify-between items-center text-white hidden-print-bg print:bg-slate-50 print:text-slate-800 print:border-b print:border-slate-200">
                              <div className="flex items-center space-x-2">
                                <span className="text-xs font-black italic tracking-widest uppercase print:text-[10px]">AL Model Answer Structure</span>
                                {feedbackResult.predictedLevel && <span className="bg-white/20 text-[9px] font-bold px-2 py-0.5 rounded uppercase print:bg-slate-200 print:text-slate-700">Level: {feedbackResult.predictedLevel}</span>}
                              </div>
                              <div className="flex items-center space-x-2">
                                <button 
                                  onClick={() => setShowTranslation(!showTranslation)}
                                  className={`px-3 py-1 rounded-full text-[9px] font-black transition-all hidden-print ${showTranslation ? 'bg-white text-blue-600' : 'bg-blue-700 text-white hover:bg-blue-800'}`}
                                >
                                  {showTranslation ? '원문만 보기' : '해석 보기'}
                                </button>
                                <button onClick={() => playHighQualityAudio(feedbackResult.correction, 'correction', feedbackResult.audioLink)} className={`p-2 rounded-full transition-all hidden-print ${ttsState?.id === 'correction' ? 'bg-white text-blue-600' : 'bg-blue-500 text-white hover:bg-blue-400'}`}>{renderSpeakerIcon('correction', ttsState?.id === 'correction' ? 'text-blue-600' : 'text-white')}</button>
                              </div>
                            </div>
                            
                            <div className="divide-y divide-slate-100 print:divide-slate-200">
                              {feedbackResult.correctionParts ? (
                                <>
                                  <div className="flex flex-col break-inside-avoid">
                                    <div className="flex flex-col sm:flex-row">
                                      <div className="w-full sm:w-32 bg-slate-50 px-6 py-4 flex items-center shrink-0 border-r border-slate-100 print-bg-none print:w-24 print:px-4 print:py-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter print:text-[8px]">소개/특징</span>
                                      </div>
                                      <div className="flex-grow px-6 py-4 print:px-4 print:py-2">
                                        <p className="text-[13px] font-bold text-slate-700 leading-relaxed italic print:text-xs">"{feedbackResult.correctionParts.intro}"</p>
                                        {(showTranslation || window.matchMedia('print').matches) && feedbackResult.translationParts && (
                                          <p className="mt-2 text-[12px] font-medium text-blue-600 leading-relaxed bg-blue-50/50 p-2 rounded-lg print-bg-none print-text-black print:text-[10px] print:mt-1 print:p-0">
                                            {feedbackResult.translationParts.intro}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex flex-col break-inside-avoid">
                                    <div className="flex flex-col sm:flex-row">
                                      <div className="w-full sm:w-32 bg-slate-50 px-6 py-4 flex items-center shrink-0 border-r border-slate-100 print-bg-none print:w-24 print:px-4 print:py-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter print:text-[8px]">세부 묘사</span>
                                      </div>
                                      <div className="flex-grow px-6 py-4 print:px-4 print:py-2">
                                        <p className="text-[13px] font-bold text-slate-700 leading-relaxed italic print:text-xs">"{feedbackResult.correctionParts.body}"</p>
                                        {(showTranslation || window.matchMedia('print').matches) && feedbackResult.translationParts && (
                                          <p className="mt-2 text-[12px] font-medium text-blue-600 leading-relaxed bg-blue-50/50 p-2 rounded-lg print-bg-none print-text-black print:text-[10px] print:mt-1 print:p-0">
                                            {feedbackResult.translationParts.body}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex flex-col break-inside-avoid">
                                    <div className="flex flex-col sm:flex-row">
                                      <div className="w-full sm:w-32 bg-slate-50 px-6 py-4 flex items-center shrink-0 border-r border-slate-100 print-bg-none print:w-24 print:px-4 print:py-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter print:text-[8px]">결론/느낌</span>
                                      </div>
                                      <div className="flex-grow px-6 py-4 print:px-4 print:py-2">
                                        <p className="text-[13px] font-bold text-slate-700 leading-relaxed italic print:text-xs">"{feedbackResult.correctionParts.conclusion}"</p>
                                        {(showTranslation || window.matchMedia('print').matches) && feedbackResult.translationParts && (
                                          <p className="mt-2 text-[12px] font-medium text-blue-600 leading-relaxed bg-blue-50/50 p-2 rounded-lg print-bg-none print-text-black print:text-[10px] print:mt-1 print:p-0">
                                            {feedbackResult.translationParts.conclusion}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="px-6 py-8 print:px-4 print:py-4 break-inside-avoid">
                                  <p className="text-lg font-bold leading-relaxed text-slate-700 italic print:text-sm">"{feedbackResult.correction.split(PART_DELIMITER).join(" ")}"</p>
                                  {(showTranslation || window.matchMedia('print').matches) && feedbackResult.translatedAnswer && (
                                    <p className="mt-4 text-base font-medium text-blue-600 leading-relaxed border-t pt-4 print-text-black print:text-xs print:mt-2 print:pt-2">
                                      {feedbackResult.translatedAnswer.split(PART_DELIMITER).join(" ")}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 hidden-print">
                            {!extractedVocab.length ? (
                              <button 
                                onClick={extractKeyVocab}
                                disabled={isExtractingVocab}
                                className="w-full py-4 border-2 border-dashed border-blue-200 rounded-3xl text-blue-600 font-black text-sm hover:bg-blue-50 transition-all flex items-center justify-center space-x-2"
                              >
                                {isExtractingVocab ? (
                                  <>
                                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Ava가 핵심 표현을 골라내는 중...</span>
                                  </>
                                ) : (
                                  <>
                                    <span>💡 핵심 표현 추출하기</span>
                                    <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">New</span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <div className="animate-in slide-in-from-top-4 duration-500">
                                <div className="flex items-center justify-between mb-4 px-2">
                                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center">
                                    <svg className="w-3 h-3 mr-1.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                    AL Essential Expressions
                                  </h4>
                                  <button onClick={() => setExtractedVocab([])} className="text-[10px] font-bold text-slate-300 hover:text-slate-500">접기</button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-x-auto pb-4 custom-scrollbar">
                                  {extractedVocab.map((item, idx) => {
                                    const isSaving = savingVocabIds.has(item.expression);
                                    return (
                                      <div key={idx} className="bg-white border border-slate-100 p-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col min-w-[200px]">
                                        <div className="flex items-start justify-between mb-2">
                                          <div className="flex-grow pr-6">
                                            <h5 className="text-sm font-black text-slate-900 leading-tight">{item.expression}</h5>
                                            <p className="text-[11px] font-bold text-blue-600 mt-0.5">{item.meaning}</p>
                                          </div>
                                          <button 
                                            onClick={() => handleSaveVocabEntry(item)}
                                            disabled={isSaving}
                                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0 ${isSaving ? 'bg-slate-50 text-slate-300' : 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white shadow-sm'}`}
                                            title="단어장에 추가"
                                          >
                                            {isSaving ? (
                                              <div className="w-3 h-3 border-2 border-slate-300 border-t-transparent rounded-full animate-spin"></div>
                                            ) : (
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"/></svg>
                                            )}
                                          </button>
                                        </div>
                                        <p className="mt-auto pt-2 border-t border-slate-50 text-[9px] font-medium text-slate-400 leading-relaxed italic">"{item.usageExample}"</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="grid gap-4 lg:grid-cols-2 printable-feedback print:grid-cols-1 print:gap-2">
                            <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm relative lg:p-7 print:border-slate-300 print:p-4 break-inside-avoid">
                              <div className="flex items-center justify-between mb-4 print:mb-2"><h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest print:text-[8px]">Your Transcript</h4>{feedbackResult.rawAudioLink && <button onClick={() => playHighQualityAudio("", 'raw-user', feedbackResult.rawAudioLink)} className="flex items-center space-x-1.5 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full text-[8px] font-black border border-blue-50 hidden-print">{renderSpeakerIcon('raw-user', "text-blue-500")}<span>다시듣기</span></button>}</div>
                              <p className="text-xs font-bold leading-relaxed italic border-slate-600 lg:text-sm text-slate-600 print:text-[10px]">"{feedbackResult.transcript}"</p>
                            </div>
                            <div className="p-5 bg-slate-50 border border-slate-100 rounded-2xl shadow-sm lg:p-7 print-bg-none print:border-slate-300 print:p-4 break-inside-avoid"><h4 className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3 print:mb-2 print:text-[8px]">Ava's Coaching</h4><p className="text-xs font-medium leading-relaxed text-slate-700 whitespace-pre-wrap lg:text-sm print:text-[10px]">{feedbackResult.feedback}</p></div>
                          </div>
                          
                          <div className="flex flex-col gap-3 pt-4 border-t sm:flex-row border-slate-50 hidden-print">
                            <button onClick={() => setIsUnitPreview(true)} className="w-full py-4 text-sm font-black flex-1 bg-slate-100 text-slate-600 rounded-2xl hover:bg-slate-200 transition-all">단원 홈</button>
                            <button onClick={handlePrint} className="w-full py-4 text-sm font-black flex-1 bg-blue-50 text-blue-600 border border-blue-200 rounded-2xl hover:bg-blue-100 transition-all flex items-center justify-center space-x-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                                <span>리포트 PDF 저장</span>
                            </button>
                            <button onClick={startNewSession} className="w-full py-4 text-sm font-black text-white shadow-xl flex-[2] bg-slate-900 rounded-2xl hover:bg-blue-600 transition-all">다음 문제 도전</button>
                          </div>
                        </div>
                      ) : isAnalyzing ? (
                        <div className="flex flex-col items-center justify-center flex-grow py-16 text-center"><div className="relative mb-6"><div className="w-16 h-16 border-[5px] border-blue-50 rounded-full"></div><div className="absolute inset-0 w-16 h-16 border-[5px] border-blue-600 border-t-transparent rounded-full animate-spin"></div></div><h3 className="text-lg font-bold lg:text-xl text-slate-800">{analysisStep}</h3><p className="mt-2 text-xs text-slate-400">텍스트 분석 및 모범 답안 해석을 생성 중입니다.</p></div>
                      ) : (
                        <div className="flex flex-col flex-grow space-y-5 lg:space-y-6">
                          <div className="flex flex-col flex-grow"><label className="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-2 ml-1">Keywords & Notes</label><textarea value={userKeywords} onChange={(e) => setUserKeywords(e.target.value)} placeholder="답변에 넣고 싶은 단어를 메모하세요." className="w-full p-6 lg:p-8 bg-slate-50 border border-slate-100 rounded-2xl lg:rounded-[40px] focus:bg-white focus:border-blue-400 outline-none transition-all text-base lg:text-lg font-bold placeholder:text-slate-300 shadow-inner h-32 lg:h-40"/></div>
                          
                          <div className="flex flex-col">
                            <label className="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-3 ml-1">Model Answer Style Direction</label>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <button 
                                onClick={() => toggleDirection('EASY')}
                                className={`p-4 rounded-2xl border-2 text-left transition-all ${selectedDirection === 'EASY' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`text-[10px] font-black uppercase tracking-tight ${selectedDirection === 'EASY' ? 'text-blue-600' : 'text-slate-400'}`}>Easy & Smooth</span>
                                  {selectedDirection === 'EASY' && <div className="w-2 h-2 bg-blue-600 rounded-full animate-in zoom-in"></div>}
                                </div>
                                <p className="text-[11px] font-bold text-slate-700 leading-snug">어휘 수준 존중 & 문법 수정 위주</p>
                              </button>
                              
                              <button 
                                onClick={() => toggleDirection('NATIVE')}
                                className={`p-4 rounded-2xl border-2 text-left transition-all ${selectedDirection === 'NATIVE' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`text-[10px] font-black uppercase tracking-tight ${selectedDirection === 'NATIVE' ? 'text-blue-600' : 'text-slate-400'}`}>Native Vibe</span>
                                  {selectedDirection === 'NATIVE' && <div className="w-2 h-2 bg-blue-600 rounded-full animate-in zoom-in"></div>}
                                </div>
                                <p className="text-[11px] font-bold text-slate-700 leading-snug">구어체 관용구 & 감정 표현 강화</p>
                              </button>
                              
                              <button 
                                onClick={() => toggleDirection('STORYTELLER')}
                                className={`p-4 rounded-2xl border-2 text-left transition-all ${selectedDirection === 'STORYTELLER' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`text-[10px] font-black uppercase tracking-tight ${selectedDirection === 'STORYTELLER' ? 'text-blue-600' : 'text-slate-400'}`}>Pro Storyteller</span>
                                  {selectedDirection === 'STORYTELLER' && <div className="w-2 h-2 bg-blue-600 rounded-full animate-in zoom-in"></div>}
                                </div>
                                <p className="text-[11px] font-bold text-slate-700 leading-snug">육하원칙에 따른 세부 묘사 추가</p>
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col items-center gap-4 py-2 pb-6">
                            {!isRecording ? (
                              <button onClick={startRecording} className="w-full py-5 text-lg font-black text-white transition-all shadow-2xl sm:max-w-sm lg:py-6 lg:text-xl bg-red-600 rounded-full flex items-center justify-center space-x-3 active:scale-95">
                                <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse"></div>
                                <span>답변 녹음 시작</span>
                              </button>
                            ) : (
                              <div className="flex items-center space-x-3 w-full sm:max-w-md">
                                <button onClick={stopRecording} className="flex-grow py-5 text-lg font-black text-white transition-all shadow-xl bg-slate-900 rounded-[24px] flex items-center justify-center space-x-2 active:scale-95">
                                  <div className="w-2 h-2 bg-red-500 rounded-sm"></div>
                                  <span>종료 및 분석</span>
                                </button>
                                
                                <button 
                                  onClick={togglePauseRecording} 
                                  className={`p-5 rounded-[24px] shadow-lg transition-all active:scale-90 ${isPaused ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                  title={isPaused ? "재개" : "일시정지"}
                                >
                                  {isPaused ? (
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                  ) : (
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                  )}
                                </button>

                                <button 
                                  onClick={cancelRecording} 
                                  className="p-5 bg-slate-200 text-slate-500 rounded-[24px] shadow-lg hover:bg-red-50 hover:text-red-500 transition-all active:scale-90"
                                  title="취소"
                                >
                                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <div ref={historyEndRef} />
            </div>
          </div>
        </section>
      </main>

      <div className="hidden print-batch-view printable-area space-y-12">
        {allLogsForPrint.filter(l => selectedLogIds.has(l.sessionId)).map((log, index) => {
          const parts = log.correction ? log.correction.split(PART_DELIMITER) : [];
          const transParts = log.translatedAnswer ? log.translatedAnswer.split(PART_DELIMITER) : [];
          return (
            <div key={log.sessionId} className="break-inside-avoid pt-4 border-t-2 border-slate-100 first:border-none">
              <div className="mb-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Report #{index + 1} | {log.date}</span>
                  <span className="bg-slate-900 text-white text-[10px] font-black px-2 py-0.5 rounded italic">Level: {log.grade}</span>
                </div>
                <h3 className="text-xl font-black text-slate-800 leading-tight mb-2">{log.unit}</h3>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Question</p>
                  <p className="text-sm font-bold text-slate-700 italic">"{log.question}"</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-300 overflow-hidden mb-6">
                <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 text-[10px] font-black uppercase text-slate-800">AL Model Answer Structure</div>
                <div className="divide-y divide-slate-100">
                  <div className="flex">
                    <div className="w-24 bg-slate-50/50 px-4 py-3 shrink-0 border-r border-slate-100 text-[9px] font-black text-slate-500 uppercase flex items-center">소개</div>
                    <div className="flex-grow px-4 py-3">
                      <p className="text-xs font-bold text-slate-800 italic leading-relaxed">"{parts[0] || ""}"</p>
                      <p className="text-[10px] font-medium text-blue-600 mt-1">{transParts[0] || ""}</p>
                    </div>
                  </div>
                  <div className="flex">
                    <div className="w-24 bg-slate-50/50 px-4 py-3 shrink-0 border-r border-slate-100 text-[9px] font-black text-slate-500 uppercase flex items-center">묘사</div>
                    <div className="flex-grow px-4 py-3">
                      <p className="text-xs font-bold text-slate-800 italic leading-relaxed">"{parts[1] || ""}"</p>
                      <p className="text-[10px] font-medium text-blue-600 mt-1">{transParts[1] || ""}</p>
                    </div>
                  </div>
                  <div className="flex">
                    <div className="w-24 bg-slate-50/50 px-4 py-3 shrink-0 border-r border-slate-100 text-[9px] font-black text-slate-500 uppercase flex items-center">결론</div>
                    <div className="flex-grow px-4 py-3">
                      <p className="text-xs font-bold text-slate-800 italic leading-relaxed">"{parts[2] || ""}"</p>
                      <p className="text-[10px] font-medium text-blue-600 mt-1">{transParts[2] || ""}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-slate-200 rounded-xl">
                  <h4 className="text-[8px] font-black text-slate-400 uppercase mb-2">My Transcript</h4>
                  <p className="text-[10px] font-bold text-slate-600 leading-relaxed italic">"{log.rawAnswer}"</p>
                </div>
                <div className="p-4 bg-slate-50/50 border border-slate-200 rounded-xl">
                  <h4 className="text-[8px] font-black text-slate-500 uppercase mb-2">Ava's Coaching</h4>
                  <p className="text-[10px] font-medium text-slate-700 leading-relaxed">{log.feedback}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; } 
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 10px; } 
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

        @media print {
            body { background-color: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .hidden-print { display: none !important; }
            .printable-area { display: block !important; margin: 0 !important; padding: 0 !important; max-width: 100% !important; overflow: visible !important; }
            .print-only-header { display: block !important; }
            .bg-slate-50, .bg-blue-50, .bg-slate-900, .bg-blue-600 { background-color: white !important; }
            .text-white { color: black !important; }
            .border, .border-slate-100, .border-slate-200 { border-color: #ddd !important; }
            .shadow-sm, .shadow-md, .shadow-xl, .shadow-2xl { shadow: none !important; box-shadow: none !important; }
            section { width: 100% !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
            .printable-model-answer { border: 1px solid #ddd !important; border-radius: 8px !important; }
            .hidden-print-bg { background: none !important; border-bottom: 1px solid #eee !important; }
            .print-bg-none { background: none !important; }
            .print-text-black { color: #000 !important; }
            .printable-feedback { grid-template-columns: 1fr !important; }
            .break-inside-avoid { page-break-inside: avoid; break-inside: avoid; }
            
            /* 단일 출력 모드일 때 (기본) 히스토리 배치 뷰 숨김 */
            body:not(.is-printing-batch) .print-batch-view { display: none !important; }
            
            /* 배치 출력 모드일 때 메인 대시보드 강제 숨김 */
            body.is-printing-batch main { display: none !important; }
            body.is-printing-batch .print-batch-view { display: block !important; }
            
            @page { margin: 1.5cm; }
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
