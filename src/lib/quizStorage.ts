import { Question } from './types';
import { sanitizeQuestions, extractJsonFromText } from './parser';

export interface SavedQuiz {
  id: string;
  title: string;
  description?: string;
  questionCount: number;
  createdAt: string;
  questions: Question[];
  source?: 'downloaded_session' | 'custom_upload' | 'demo';
}

const STORAGE_KEY = 'kahoot_local_saved_quizzes';

// High-quality built-in demo quizzes for immediate solo practice
export const DEMO_QUIZZES: SavedQuiz[] = [
  {
    id: 'demo-direito-constitucional',
    title: 'Direito Constitucional: Direitos Fundamentais',
    description: 'Questões discursivas sobre remédios constitucionais, princípios e direitos e garantias fundamentais.',
    questionCount: 3,
    createdAt: new Date().toISOString(),
    source: 'demo',
    questions: [
      {
        index: 0,
        type: 'short_answer',
        prompt: 'Qual é o remédio constitucional cabível para proteger direito líquido e certo não amparado por habeas corpus ou habeas data?',
        canonical_answers: ['Mandado de Segurança', 'Mandado de seguranca', 'MS'],
        reference_answer: 'Mandado de Segurança individual ou coletivo previsto no artigo 5º, inciso LXIX da Constituição Federal.',
        embedding_ref: [],
        required_keywords: ['mandado', 'seguranca'],
        thresholds: { full: 0.80, partial: 0.60 },
        rubric_explanation: 'O candidato deve identificar expressamente o Mandado de Segurança como garantia constitucional residual contra atos de autoridade pública.',
        timeLimit: 60
      },
      {
        index: 1,
        type: 'fill_blank',
        prompt: 'O princípio da _____ determina que a lei não prejudicará o direito adquirido, o ato jurídico perfeito e a coisa julgada.',
        canonical_answers: ['segurança jurídica', 'seguranca juridica', 'irretroatividade', 'irretroatividade da lei'],
        reference_answer: 'Segurança jurídica (ou irretroatividade da lei), garantindo estabilidade às relações consolidadas.',
        embedding_ref: [],
        required_keywords: ['seguranca', 'juridica'],
        thresholds: { full: 0.82, partial: 0.65 },
        rubric_explanation: 'Preencher com segurança jurídica ou irretroatividade da lei.',
        timeLimit: 45
      },
      {
        index: 2,
        type: 'short_answer',
        prompt: 'Explique resumidamente o que é o princípio da presunção de inocência (ou não culpabilidade).',
        canonical_answers: ['Ninguém será considerado culpado até o trânsito em julgado de sentença penal condenatória'],
        reference_answer: 'Princípio segundo o qual ninguém será considerado culpado até o trânsito em julgado de sentença penal condenatória, cabendo à acusação o ônus probatório integral.',
        embedding_ref: [],
        required_keywords: ['transito', 'julgado', 'culpado'],
        thresholds: { full: 0.75, partial: 0.55 },
        rubric_explanation: 'Mencionar a necessidade de sentença penal condenatória transitada em julgado para a consideração de culpa.',
        timeLimit: 90
      }
    ]
  },
  {
    id: 'demo-biologia-celular',
    title: 'Biologia Celular & Metabolismo',
    description: 'Questões curtas sobre estrutura celular, organelas e bioenergética.',
    questionCount: 3,
    createdAt: new Date().toISOString(),
    source: 'demo',
    questions: [
      {
        index: 0,
        type: 'short_answer',
        prompt: 'Qual é a organela citoplasmática responsável pela síntese de ATP por meio da fosforilação oxidativa em células eucarióticas?',
        canonical_answers: ['Mitocôndria', 'Mitocondria', 'Mitocôndrias'],
        reference_answer: 'A mitocôndria é a organela responsável pela respiração celular aeróbia e fosforilação oxidativa geradora de ATP.',
        embedding_ref: [],
        required_keywords: ['mitocondria'],
        thresholds: { full: 0.85, partial: 0.65 },
        rubric_explanation: 'A resposta central é a mitocôndria.',
        timeLimit: 45
      },
      {
        index: 1,
        type: 'fill_blank',
        prompt: 'O modelo do mosaico fluido descreve a estrutura dinâmica da _____ celular, composta por bicamada fosfolipídica e proteínas integrais e periféricas.',
        canonical_answers: ['membrana plasmática', 'membrana plasmatica', 'membrana celular', 'membrana'],
        reference_answer: 'Membrana plasmática (ou membrana celular).',
        embedding_ref: [],
        required_keywords: ['membrana'],
        thresholds: { full: 0.85, partial: 0.65 },
        rubric_explanation: 'Termo correto: membrana plasmática ou membrana celular.',
        timeLimit: 45
      },
      {
        index: 2,
        type: 'short_answer',
        prompt: 'Qual a principal diferença entre transporte ativo e transporte passivo através da membrana biológica?',
        canonical_answers: ['O transporte ativo consome energia celular (ATP) contra o gradiente de concentração, enquanto o passivo não gasta energia e ocorre a favor do gradiente.'],
        reference_answer: 'O transporte ativo requer gasto energético metabólico (como quebra de ATP) e ocorre contra o gradiente eletroquímico, enquanto o transporte passivo ocorre espontaneamente a favor do gradiente sem gasto de energia.',
        embedding_ref: [],
        required_keywords: ['energia', 'gradiente', 'atp'],
        thresholds: { full: 0.72, partial: 0.55 },
        rubric_explanation: 'Comparar o gasto de energia (ATP) e a direção em relação ao gradiente de concentração.',
        timeLimit: 90
      }
    ]
  }
];

export function getSavedQuizzes(): SavedQuiz[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (err) {
    console.error('Erro ao ler quizzes do localStorage:', err);
    return [];
  }
}

export function saveQuiz(quiz: {
  id?: string;
  title: string;
  description?: string;
  questions: Question[];
  source?: 'downloaded_session' | 'custom_upload' | 'demo';
}): SavedQuiz {
  const currentList = getSavedQuizzes();
  const quizId = quiz.id || `quiz_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const newEntry: SavedQuiz = {
    id: quizId,
    title: quiz.title.trim() || `Quiz ${new Date().toLocaleDateString('pt-BR')}`,
    description: quiz.description,
    questionCount: quiz.questions.length,
    createdAt: new Date().toISOString(),
    questions: quiz.questions.map((q, idx) => ({
      ...q,
      index: idx,
      // We strip heavy embedding vectors when saving to local storage to stay well under 5MB limit
      embedding_ref: q.embedding_ref && q.embedding_ref.length > 0 ? q.embedding_ref : []
    })),
    source: quiz.source || 'custom_upload'
  };

  // Replace existing or prepend
  const filtered = currentList.filter(item => item.id !== quizId);
  const updated = [newEntry, ...filtered];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Falha de cota no localStorage ao salvar quiz completo. Tentando versão otimizada sem vetores:', err);
    // Strip all embedding_refs to save space
    const lightweight = updated.map(item => ({
      ...item,
      questions: item.questions.map(q => ({ ...q, embedding_ref: [] }))
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweight));
  }

  return newEntry;
}

export function deleteSavedQuiz(id: string): void {
  try {
    const currentList = getSavedQuizzes();
    const updated = currentList.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Erro ao remover quiz do localStorage:', err);
  }
}

export function getSavedQuizById(id: string): SavedQuiz | null {
  // Check user saved quizzes first
  const userQuizzes = getSavedQuizzes();
  const found = userQuizzes.find(q => q.id === id);
  if (found) return found;

  // Check built-in demo quizzes
  const demoFound = DEMO_QUIZZES.find(q => q.id === id);
  if (demoFound) return demoFound;

  return null;
}

/**
 * Downloads questions as an elegant, formatted JSON file.
 */
export function downloadQuizAsJson(
  title: string,
  questions: Question[],
  filenamePrefix = 'quiz_dissertativo'
): void {
  const cleanTitle = title.trim() || 'Treino Dissertativo';
  const cleanQuestions = questions.map((q, idx) => ({
    index: idx + 1,
    type: q.type,
    prompt: q.prompt,
    canonical_answers: q.canonical_answers || [],
    reference_answer: q.reference_answer,
    required_keywords: q.required_keywords || [],
    thresholds: q.thresholds || { full: 0.8, partial: 0.6 },
    rubric_explanation: q.rubric_explanation || '',
    timeLimit: q.timeLimit || 45
  }));

  const exportPayload = {
    title: cleanTitle,
    exportedAt: new Date().toISOString(),
    totalQuestions: cleanQuestions.length,
    app: 'Kahoot Treino Dissertativo',
    questions: cleanQuestions
  };

  const safeFilename = `${filenamePrefix}_${cleanTitle.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.json`;
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parses raw JSON string or file content into normalized Questions and title.
 */
export function parseImportedQuiz(rawText: string): { title: string; questions: Question[] } {
  const parsed = extractJsonFromText(rawText);
  let title = 'Quiz Importado';

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.title || parsed.titulo || parsed.nome || parsed.name) {
      title = parsed.title || parsed.titulo || parsed.nome || parsed.name;
    }
  }

  const sanitized = sanitizeQuestions(parsed);
  const questions: Question[] = sanitized.map((item, idx) => ({
    index: idx,
    type: item.type,
    prompt: item.prompt,
    canonical_answers: item.canonical_answers,
    reference_answer: item.reference_answer,
    embedding_ref: [],
    required_keywords: item.required_keywords,
    thresholds: item.thresholds,
    rubric_explanation: item.rubric_explanation,
    timeLimit: item.timeLimit || 45
  }));

  return { title, questions };
}
