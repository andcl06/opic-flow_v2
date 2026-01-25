
import { MASTER_SPREADSHEET_ID, MASTER_SHEET_NAME, SURVEY_DB_SHEET_NAME, QUESTION_DB_SHEET_NAME, CONFIG_SETTINGS_SHEET_NAME } from '../constants';
import { GoogleUser, UserStudyContext, SurveyData, UnitProgress, StudyLogEntry, VocabularyEntry } from '../types';

const extractId = (input: string | undefined): string | null => {
  if (!input || typeof input !== 'string') return null;
  const val = input.trim();
  if (!val) return null;
  const match = val.match(/\/d\/([a-zA-Z0-9-_]+)/) || 
                val.match(/\/folders\/([a-zA-Z0-9-_]+)/) || 
                val.match(/id=([a-zA-Z0-9-_]+)/);
  return match ? match[1] : (val.includes('/') ? null : val);
};

const getHeaderMap = (headerRow: string[]) => {
  const map: Record<string, number> = {};
  if (!headerRow) return map;
  headerRow.forEach((name, index) => {
    if (name) map[name.trim().toLowerCase()] = index;
  });
  return map;
};

const buildRowFromMap = (headerMap: Record<string, number>, data: Record<string, string>) => {
  const maxIdx = Math.max(...Object.values(headerMap), -1);
  if (maxIdx === -1) return [];
  const row = new Array(maxIdx + 1).fill("");
  Object.entries(data).forEach(([key, val]) => {
    const idx = headerMap[key.toLowerCase()];
    if (idx !== undefined) row[idx] = val;
  });
  return row;
};

export const fetchConfigSettings = async (accessToken: string): Promise<Record<string, string>> => {
  try {
    const range = `${CONFIG_SETTINGS_SHEET_NAME}!A2:B10`; 
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error("Config fetch failed");
    const data = await res.json();
    const rows = data.values || [];
    const config: Record<string, string> = {};
    rows.forEach((row: any[]) => {
      if (row[0] && row[1]) {
        config[row[0].trim()] = row[1].trim();
      }
    });
    return config;
  } catch (error) {
    console.error("fetchConfigSettings error:", error);
    return {};
  }
};

export const fetchSurveyDatabase = async (accessToken: string) => {
  const range = `${SURVEY_DB_SHEET_NAME}!A1:H200`; 
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error("Survey DB fetch failed");
  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  const h = getHeaderMap(rows[0]);
  return rows.slice(1).map((row: any[]) => ({
    id: row[h['id']],
    step: row[h['step']],
    question: row[h['question']],
    option: row[h['option']],
    nextId: row[h['next_id']],
    type: row[h['type']],
    strategyGuide: row[h['strategy_guide']] || "",
    isRecommended: (row[h['is_recommended']] || "").toString().toUpperCase() === 'TRUE'
  }));
};

export const fetchQuestionDatabase = async (accessToken: string) => {
  const range = `${QUESTION_DB_SHEET_NAME}!A1:K1000`; 
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error("Question DB fetch failed");
  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  const h = getHeaderMap(rows[0]);
  
  const fullIdKey = h['full_id'] ?? 0;
  const unitIdKey = h['unit_id'] ?? 1;
  const categoryKey = h['대분류'] ?? 2;
  const topicKey = h['유닛/주제'] ?? 4;
  const essenceKey = h['질문요지'] ?? 7;
  const strategyKey = h['유형공략명'] ?? 8;
  const triggerKey = h['trigger_id'] ?? 9;
  const targetKey = h['target_option'] ?? 10;

  return rows.slice(1).map((row: any[]) => ({
    fullId: (row[fullIdKey] || "").toString().trim(),
    unitId: (row[unitIdKey] || "").toString().trim(),
    category: (row[categoryKey] || "").toString().trim(),
    topic: (row[topicKey] || "").toString().trim(),
    essence: (row[essenceKey] || "").toString().trim(),
    strategy: (row[strategyKey] || "").toString().trim(),
    triggerId: (row[triggerKey] || "").toString().trim(),
    targetOption: (row[targetKey] || "").toString().trim()
  }));
};

export const syncUserWithMasterSheet = async (user: GoogleUser, accessToken: string, onlyCheck: boolean = false): Promise<UserStudyContext> => {
  try {
    const range = `${MASTER_SHEET_NAME}!A1:Z1000`; 
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Master fetch failed: ${res.status}`);
    
    const data = await res.json();
    const rows: string[][] = data.values || [];
    if (rows.length === 0) return { status: 'NEW' };
    
    const h = getHeaderMap(rows[0]);
    const emailIdx = h['user email'] ?? 0;
    const targetEmail = user.email.toLowerCase().trim();
    const existingRow = rows.slice(1).find(row => (row[emailIdx] || '').toLowerCase().trim() === targetEmail);
    
    if (existingRow) {
      const sheetId = extractId(existingRow[h['individual sheet id']]);
      const folderVal = existingRow[h['folder_id']];
      if (sheetId) {
        return { 
          status: 'READY', 
          individualSheetId: sheetId, 
          individualFolderId: extractId(folderVal) || undefined 
        };
      }
      return { status: 'PROVISIONING' };
    } else {
      if (onlyCheck) return { status: 'NEW' };
      const rowData = { 
        "user email": user.email, 
        "user name": user.name, 
        "individual sheet id": "", 
        "progress (%)": "0%", 
        "last access": new Date().toLocaleDateString(), 
        "status": "WAITING", 
        "folder_id": "" 
      };
      const newRow = buildRowFromMap(h, rowData);
      
      const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(MASTER_SHEET_NAME)}!A2:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${accessToken}`, 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [newRow] })
      });
      
      if (!appendRes.ok) throw new Error("Master registration failed");
      
      return { status: 'PROVISIONING' };
    }
  } catch (error) { 
    console.error("syncUserWithMasterSheet error:", error);
    return { status: 'NEW' }; 
  }
};

export const checkSheetStatus = async (email: string, accessToken: string): Promise<UserStudyContext> => {
  try {
    const range = `${MASTER_SHEET_NAME}!A1:Z1000`;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const rows: string[][] = data.values || [];
    if (rows.length < 2) return { status: 'PROVISIONING' }; 
    const h = getHeaderMap(rows[0]);
    const emailIdx = h['user email'] ?? 0;
    const targetEmail = email.toLowerCase().trim();
    const row = rows.slice(1).find(r => (r[emailIdx] || '').toLowerCase().trim() === targetEmail);
    if (row) {
      const sheetId = extractId(row[h['individual sheet id']]);
      const folderId = extractId(row[h['folder_id']]);
      if (sheetId) return { status: 'READY', individualSheetId: sheetId, individualFolderId: folderId || undefined };
    }
    return { status: 'PROVISIONING' };
  } catch (err) { return { status: 'PROVISIONING' }; }
};

export const fetchAllUsersProgress = async (accessToken: string): Promise<any[]> => {
  try {
    const range = `${MASTER_SHEET_NAME}!A1:Z1000`;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error("Failed to fetch all users progress");
    const data = await res.json();
    const rows = data.values || [];
    if (rows.length < 2) return [];

    const h = getHeaderMap(rows[0]);
    return rows.slice(1).map((row: any[]) => ({
      email: row[h['user email']] || "",
      name: row[h['user name']] || "",
      progress: row[h['progress (%)']] || "0%",
      lastAccess: row[h['last access']] || "-",
      status: row[h['status']] || ""
    })).filter(u => u.email !== "");
  } catch (e) {
    console.error("fetchAllUsersProgress error", e);
    return [];
  }
};

export const uploadAudioToDrive = async (audioBlob: Blob, fileName: string, folderId: string, accessToken: string): Promise<string | null> => {
  const metadata = { name: fileName, parents: [folderId], mimeType: audioBlob.type };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', audioBlob);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
};

export const deleteFileFromDrive = async (fileUrl: string, accessToken: string): Promise<boolean> => {
  const fileId = extractId(fileUrl);
  if (!fileId) return false;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.status === 204;
};

export const saveStudyLog = async (sheetId: string, log: StudyLogEntry, accessToken: string): Promise<boolean> => {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Study_Log!A:A:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[
      log.sessionId, log.date, log.unit, log.type, log.question, log.keywords, 
      log.rawAnswer, log.rawAudioLink, log.grade, log.correction, log.translatedAnswer, log.feedback, log.audioLink
    ]] })
  });
  return res.ok;
};

export const updateStudyLog = async (sheetId: string, log: StudyLogEntry, accessToken: string): Promise<boolean> => {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Study_Log!A:A`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    const rows = data.values || [];
    const rowIndex = rows.findIndex((r: any[]) => r[0] === log.sessionId);
    if (rowIndex === -1) return false;
    const sheetRow = rowIndex + 1;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Study_Log!B${sheetRow}:M${sheetRow}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[
        log.date, log.unit, log.type, log.question, log.keywords, 
        log.rawAnswer, log.rawAudioLink, log.grade, log.correction, log.translatedAnswer, log.feedback, log.audioLink
      ]] })
    });
    return true;
  } catch (e) { return false; }
};

export const fetchStudyLogs = async (sheetId: string, accessToken: string): Promise<StudyLogEntry[]> => {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Study_Log!A2:M1000`, { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const data = await res.json();
    return (data.values || []).map((row: any[]) => ({
      sessionId: row[0] || "", date: row[1] || "", unit: row[2] || "", type: row[3] || "", 
      question: row[4] || "", keywords: row[5] || "", rawAnswer: row[6] || "", 
      rawAudioLink: row[7] || "", grade: row[8] || "", correction: row[9] || "", 
      translatedAnswer: row[10] || "", feedback: row[11] || "", audioLink: row[12] || ""
    }));
  } catch (e) { return []; }
};

export const deleteStudyLogBySessionId = async (sheetId: string, sessionId: string, accessToken: string): Promise<boolean> => {
  try {
    const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Study_Log!A1:A1000`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const valData = await valRes.json();
    const rows = valData.values || [];
    const rowIndex = rows.findIndex((r: any[]) => r[0] === sessionId);
    if (rowIndex === -1) return false;
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const metaData = await metaRes.json();
    const tabId = metaData.sheets.find((s: any) => s.properties.title === "Study_Log")?.properties.sheetId;
    const deleteRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          deleteDimension: { range: { sheetId: tabId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } }
        }]
      })
    });
    return deleteRes.ok;
  } catch (e) { return false; }
};

export const saveVocabularyEntry = async (sheetId: string, entry: VocabularyEntry, accessToken: string): Promise<boolean> => {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Vocabulary_Bank!A:A:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[
      entry.id, entry.expression, entry.meaning, entry.usageExample, entry.unitSource, entry.addedDate, entry.status
    ]] })
  });
  return res.ok;
};

export const fetchVocabularyBank = async (sheetId: string, accessToken: string): Promise<VocabularyEntry[]> => {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Vocabulary_Bank!A2:G1000`, { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const data = await res.json();
    return (data.values || []).map((row: any[]) => ({
      id: row[0] || "",
      expression: row[1] || "",
      meaning: row[2] || "",
      usageExample: row[3] || "",
      unitSource: row[4] || "",
      addedDate: row[5] || "",
      status: row[6] || ""
    }));
  } catch (e) { return []; }
};

export const deleteVocabularyEntry = async (sheetId: string, vocabId: string, accessToken: string): Promise<boolean> => {
  try {
    const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Vocabulary_Bank!A1:A1000`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const valData = await valRes.json();
    const rows = valData.values || [];
    const rowIndex = rows.findIndex((r: any[]) => r[0] === vocabId);
    if (rowIndex === -1) return false;
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const metaData = await metaRes.json();
    const tabId = metaData.sheets.find((s: any) => s.properties.title === "Vocabulary_Bank")?.properties.sheetId;
    const deleteRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          deleteDimension: { range: { sheetId: tabId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } }
        }]
      })
    });
    return deleteRes.ok;
  } catch (e) { return false; }
};

export const updateUnitStatus = async (
  sheetId: string, 
  unitIndex: number, 
  accessToken: string, 
  status: string = "완료",
  grade: string = "-",
  lastPractice: string = "-"
): Promise<void> => {
  const rowIdx = unitIndex + 2;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Progress!E${rowIdx}:G${rowIdx}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[status, grade, lastPractice]] }) 
  });
};

export const updateMasterProgress = async (
  userEmail: string,
  individualSheetId: string,
  accessToken: string
): Promise<void> => {
  try {
    const units = await fetchProgressFromIndividualSheet(individualSheetId, accessToken);
    if (units.length === 0) return;
    
    const completedCount = units.filter(u => u.status === "완료").length;
    const progressPercent = Math.round((completedCount / units.length) * 100) + "%";
    const lastAccess = new Date().toLocaleDateString();

    const range = `${MASTER_SHEET_NAME}!A1:Z1000`;
    const masterRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const masterData = await masterRes.json();
    const rows = masterData.values || [];
    if (rows.length < 2) return;

    const h = getHeaderMap(rows[0]);
    const emailIdx = h['user email'] ?? 0;
    const progressIdx = h['progress (%)'];
    const lastAccessIdx = h['last access'];
    
    const targetEmail = userEmail.toLowerCase().trim();
    const rowIndex = rows.findIndex(r => (r[emailIdx] || "").toLowerCase().trim() === targetEmail);
    if (rowIndex === -1 || progressIdx === undefined || lastAccessIdx === undefined) return;
    
    const sheetRow = rowIndex + 1;
    const colProgress = String.fromCharCode(65 + progressIdx);
    const colLastAccess = String.fromCharCode(65 + lastAccessIdx);

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${MASTER_SHEET_NAME}!${colProgress}${sheetRow}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[progressPercent]] })
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${MASTER_SHEET_NAME}!${colLastAccess}${sheetRow}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[lastAccess]] })
    });

  } catch (error) {
    console.error("updateMasterProgress error:", error);
  }
};

export const fetchProgressFromIndividualSheet = async (sheetId: string, accessToken: string): Promise<UnitProgress[]> => {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Progress!A2:G500`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  return (data.values || []).map((row: any[]) => ({ 
    fullId: row[0] || "",
    unitId: row[1] || "",
    topic: row[2] || "", 
    essence: row[3] || "",
    status: row[4] || "미완료", 
    grade: row[5] || "-",
    lastPractice: row[6] || "-" 
  }));
};

export const generateProgressFromSurvey = async (sheetId: string, detailedAnswers: any[], accessToken: string): Promise<boolean> => {
  try {
    const [existingProgress, questionDb] = await Promise.all([
      fetchProgressFromIndividualSheet(sheetId, accessToken),
      fetchQuestionDatabase(accessToken)
    ]);
    
    const statusMap = new Map<string, {status: string, grade: string, last: string}>();
    existingProgress.forEach(p => statusMap.set(p.fullId, {status: p.status, grade: p.grade, last: p.lastPractice}));

    const curriculumRows: any[][] = [];

    questionDb.forEach(q => {
      let isMatch = false;
      if (q.triggerId.toUpperCase() === "ALL") {
        isMatch = true;
      } else {
        const surveyAns = detailedAnswers.find(a => a.questionId === q.triggerId);
        if (surveyAns && surveyAns.selection) {
          // targetOption을 콤마로 구분하여 배열로 만들고 트림 처리
          const targetList = q.targetOption.split(',').map(opt => opt.trim()).filter(opt => opt !== "");
          // 사용자가 선택한 항목 중 하나라도 targetList에 포함되어 있는지 확인
          isMatch = surveyAns.selection.some((s: string) => targetList.includes(s.trim()));
        }
      }

      if (isMatch) {
        const existing = statusMap.get(q.fullId);
        curriculumRows.push([
          q.fullId, 
          q.unitId, 
          q.topic, 
          q.essence, 
          existing?.status || "미완료", 
          existing?.grade || "-", 
          existing?.last || "-"
        ]);
      }
    });

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Progress!A2:G500?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: new Array(499).fill(new Array(7).fill("")) })
    });

    if (curriculumRows.length > 0) {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Progress!A2:G${curriculumRows.length + 1}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: curriculumRows })
      });
      return res.ok;
    }
    return true;
  } catch (error) { return false; }
};

export const saveSurveyAndGenerateProgress = async (sheetId: string, detailedAnswers: any[], accessToken: string): Promise<boolean> => {
  const surveySuccess = await saveSurveyData(sheetId, detailedAnswers, accessToken);
  if (!surveySuccess) return false;
  return await generateProgressFromSurvey(sheetId, detailedAnswers, accessToken);
};

export const saveSurveyData = async (sheetId: string, detailedAnswers: any[], accessToken: string): Promise<boolean> => {
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Survey!A2:H100?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: new Array(100).fill(new Array(8).fill("")) })
    });

    const timestamp = new Date().toLocaleString();
    const rows = detailedAnswers.map(ans => [
      timestamp,
      ans.step,
      ans.questionId,
      ans.questionText,
      ans.selection.join(", "),
      ans.selection.length,
      ans.isStrategic ? "Y" : "N",
      ans.memo || ""
    ]);

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Survey!A2:H${rows.length + 1}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows })
    });
    return res.ok;
  } catch (error) { return false; }
};

export const fetchSurveyFromIndividualSheet = async (sheetId: string, accessToken: string): Promise<SurveyData | undefined> => {
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Survey!A2:H100`, { 
      headers: { Authorization: `Bearer ${accessToken}` } 
    });
    const data = await res.json();
    const rows = data.values || [];
    if (rows.length === 0) return undefined;

    const survey: SurveyData = { job: "", studentStatus: "", residence: "", activities: [] };
    rows.forEach((row: any[]) => {
      const qId = row[2];
      const selection = row[4];
      if (qId === 'Q1' || qId.startsWith('Q1_')) survey.job = selection;
      if (qId === 'Q2' || qId.startsWith('Q2_')) survey.studentStatus = selection;
      if (qId === 'Q3') survey.residence = selection;
      if (['Q4', 'Q5', 'Q6', 'Q7'].includes(qId)) {
        survey.activities.push(...(selection ? selection.split(", ") : []));
      }
    });
    return survey;
  } catch (e) { return undefined; }
};
