
export interface GoogleUser {
  email: string;
  email_verified: boolean;
  family_name: string;
  given_name: string;
  name: string;
  picture: string;
  sub: string;
}

export interface FullUser extends GoogleUser {
  accessToken: string;
  context: UserStudyContext;
}

export interface UnitProgress {
  fullId: string;    // 시트의 full_id (A)
  unitId: string;    // 시트의 unit_id (B)
  topic: string;     // 유닛/주제 (C)
  essence: string;   // 질문요지 (D)
  status: string;    // 진도 (E)
  grade: string;     // 성적 (F)
  lastPractice: string; // 최종 학습 일시 (G)
}

export interface StudyLogEntry {
  sessionId: string;      
  date: string;
  unit: string;
  type: string;
  question: string;
  keywords: string;
  rawAnswer: string;      
  rawAudioLink: string;   
  grade: string;          
  correction: string;     
  translatedAnswer: string; 
  feedback: string;
  audioLink: string;      
}

export interface VocabularyEntry {
  id: string;
  expression: string;
  meaning: string;
  usageExample: string;
  unitSource: string;
  addedDate: string;
  status: string;
}

export interface UserStudyContext {
  status: 'NEW' | 'PROVISIONING' | 'READY' | 'SURVEY_REQUIRED';
  individualSheetId?: string;
  individualSheetUrl?: string;
  individualFolderId?: string;
  individualFolderUrl?: string;
  progress?: number;
  survey?: SurveyData;
  units?: UnitProgress[];
}

export interface SurveyData {
  job: string;
  studentStatus: string;
  residence: string;
  activities: string[];
}

export interface OPIcQuestion {
  unit: string;
  type: string;
  question: string;
  description: string;
}

export interface CredentialResponse {
  credential: string;
  select_by: string;
}

declare global {
  interface Window {
    google: any;
    webkitSpeechRecognition: any;
  }
}
