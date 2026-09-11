import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  FileCode2,
  HelpCircle,
  Play,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Users,
  XCircle
} from 'lucide-react';
import { Question, GradingResult } from '../lib/types';
import { gradeShortAnswerAsync } from '../lib/grading';
import {
  SavedQuiz,
  getSavedQuizzes,
  saveQuiz,
  deleteSavedQuiz,
  getSavedQuizById,
  downloadQuizAsJson,
  parseImportedQuiz,
  DEMO_QUIZZES
} from '../lib/quizStorage';

type SoloScreen = 'select' | 'playing' | 'revealed' | 'summary';

interface AnswerRecord {
  questionIndex: number;
  question: Question;
  studentAnswer: string;
  gradingResult: GradingResult;
  score: number;
  timeSpentSeconds: number;
}

export default function Solo() {
  const navigate = useNavigate();
  const { quizId } = useParams<{ quizId?: string }>();

  // Storage & Quiz selection state
  const [savedQuizzes, setSavedQuizzes] = useState<SavedQuiz[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<SavedQuiz | null>(null);
  const [currentScreen, setCurrentScreen] = useState<SoloScreen>('select');

  // Import modal / input state
  const [isImporting, setIsImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Practice state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [studentInput, setStudentInput] = useState('');
  const [isGrading, setIsGrading] = useState(false);
  const [currentGrading, setCurrentGrading] = useState<GradingResult | null>(null);
  const [answerHistory, setAnswerHistory] = useState<AnswerRecord[]>([]);
  
  // Settings
  const [enableTimer, setEnableTimer] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const timerIntervalRef = useRef<any>(null);

  // Load saved quizzes on mount
  useEffect(() => {
    const list = getSavedQuizzes();
    setSavedQuizzes(list);

    if (quizId) {
      const found = getSavedQuizById(quizId);
      if (found) {
        startQuiz(found);
      }
    }
  }, [quizId]);

  // Clean up timer
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const refreshSavedQuizzes = () => {
    setSavedQuizzes(getSavedQuizzes());
  };

  const startQuiz = (quiz: SavedQuiz, customQuestions?: Question[]) => {
    const questionsToUse = customQuestions || quiz.questions;
    if (!questionsToUse || questionsToUse.length === 0) {
      alert('Este quiz não possui questões para praticar.');
      return;
    }

    const preparedQuiz: SavedQuiz = {
      ...quiz,
      questions: questionsToUse
    };

    setActiveQuiz(preparedQuiz);
    setCurrentIndex(0);
    setStudentInput('');
    setCurrentGrading(null);
    setAnswerHistory([]);
    setCurrentScreen('playing');

    setupQuestionTimer(questionsToUse[0]);
  };

  const setupQuestionTimer = (question: Question) => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setQuestionStartTime(Date.now());

    if (enableTimer && question.timeLimit && question.timeLimit > 0) {
      setSecondsRemaining(question.timeLimit);
      timerIntervalRef.current = setInterval(() => {
        setSecondsRemaining(prev => {
          if (prev === null || prev <= 1) {
            clearInterval(timerIntervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setSecondsRemaining(null);
    }
  };

  // Handle Answer Submission
  const handleSubmitAnswer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGrading || !activeQuiz) return;

    const currentQ = activeQuiz.questions[currentIndex];
    if (!currentQ) return;

    const trimmed = studentInput.trim();
    if (!trimmed) {
      alert('Por favor, digite sua resposta antes de enviar para correção.');
      return;
    }

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    setIsGrading(true);

    try {
      // Local evaluation with all-MiniLM-L6-v2 + lexical + keyword checking
      const gradingResult = await gradeShortAnswerAsync(trimmed, currentQ);
      setCurrentGrading(gradingResult);

      const elapsed = Math.max(1, Math.round((Date.now() - questionStartTime) / 1000));
      const record: AnswerRecord = {
        questionIndex: currentIndex,
        question: currentQ,
        studentAnswer: trimmed,
        gradingResult,
        score: gradingResult.score,
        timeSpentSeconds: elapsed
      };

      setAnswerHistory(prev => {
        const filtered = prev.filter(r => r.questionIndex !== currentIndex);
        return [...filtered, record];
      });

      setCurrentScreen('revealed');
    } catch (err: any) {
      console.error('Erro ao avaliar resposta solo:', err);
      alert('Ocorreu um erro ao avaliar sua resposta. Tente novamente.');
    } finally {
      setIsGrading(false);
    }
  };

  const handleNextQuestion = () => {
    if (!activeQuiz) return;
    const nextIdx = currentIndex + 1;

    if (nextIdx < activeQuiz.questions.length) {
      setCurrentIndex(nextIdx);
      setStudentInput('');
      setCurrentGrading(null);
      setCurrentScreen('playing');
      setupQuestionTimer(activeQuiz.questions[nextIdx]);
    } else {
      // Quiz finished
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      setCurrentScreen('summary');
    }
  };

  const handleRetryQuestion = () => {
    if (!activeQuiz) return;
    setStudentInput('');
    setCurrentGrading(null);
    setCurrentScreen('playing');
    setupQuestionTimer(activeQuiz.questions[currentIndex]);
  };

  // Import File / JSON handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        processRawImport(text, file.name.replace(/\.[^/.]+$/, ''));
      } catch (err: any) {
        setImportError(`Erro ao ler o arquivo: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const processRawImport = (rawText: string, fallbackTitle?: string) => {
    try {
      setImportError(null);
      const { title, questions } = parseImportedQuiz(rawText);
      if (questions.length === 0) {
        throw new Error('Nenhuma questão válida encontrada no arquivo fornecido.');
      }

      const saved = saveQuiz({
        title: title || fallbackTitle || 'Quiz Importado',
        questions,
        source: 'custom_upload'
      });

      refreshSavedQuizzes();
      setIsImporting(false);
      setImportText('');
      
      // Immediately start or show in list
      if (confirm(`Quiz "${saved.title}" com ${saved.questionCount} questões importado com sucesso! Deseja começar o treino agora?`)) {
        startQuiz(saved);
      }
    } catch (err: any) {
      setImportError(err.message || 'Formato inválido de JSON de questões.');
    }
  };

  const handleDeleteQuiz = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Tem certeza de que deseja excluir este quiz salvo no navegador?')) {
      deleteSavedQuiz(id);
      refreshSavedQuizzes();
    }
  };

  const handleDownloadQuiz = (quiz: SavedQuiz, e: React.MouseEvent) => {
    e.stopPropagation();
    downloadQuizAsJson(quiz.title, quiz.questions);
  };

  const handleHostWithQuiz = (quiz: SavedQuiz, e: React.MouseEvent) => {
    e.stopPropagation();
    // Save to temporary session storage and navigate to host
    sessionStorage.setItem('kahoot_preloaded_quiz', JSON.stringify({
      title: quiz.title,
      questions: quiz.questions
    }));
    navigate('/host');
  };

  const handleRetryMissedOnly = () => {
    if (!activeQuiz) return;
    const missedQuestions = answerHistory
      .filter(r => r.score < 0.70)
      .map(r => r.question);

    if (missedQuestions.length === 0) {
      alert('Parabéns! Você não errou nenhuma questão com nota inferior a 70%.');
      return;
    }

    startQuiz({
      ...activeQuiz,
      title: `${activeQuiz.title} (Revisão de Erros)`
    }, missedQuestions);
  };

  // Keyboard shortcut: Ctrl + Enter / Cmd + Enter to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmitAnswer();
    }
  };

  // Compute summary stats
  const totalQuestions = answerHistory.length;
  const avgScore = totalQuestions > 0
    ? Math.round((answerHistory.reduce((acc, r) => acc + r.score, 0) / totalQuestions) * 100)
    : 0;
  const perfectCount = answerHistory.filter(r => r.score >= 0.8).length;
  const partialCount = answerHistory.filter(r => r.score >= 0.5 && r.score < 0.8).length;
  const lowCount = answerHistory.filter(r => r.score < 0.5).length;

  // -------------------------------------------------------------
  // SCREEN 1: SELECTION & IMPORT LOBBY
  // -------------------------------------------------------------
  if (currentScreen === 'select') {
    return (
      <div className="min-h-screen bg-neutral-900 text-white font-sans p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 pb-5">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/')}
                className="w-10 h-10 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 flex items-center justify-center transition-colors cursor-pointer"
                title="Voltar ao Início"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-black text-white flex items-center gap-2">
                  <BookOpen className="w-7 h-7 text-indigo-400" />
                  Treino Dissertativo Solo
                </h1>
                <p className="text-xs text-neutral-400">
                  Pratique no seu ritmo com avaliação semântica local imediata e offline.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsImporting(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/20 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Importar Quiz (JSON)
              </button>
            </div>
          </div>

          {/* Quick Info Banner */}
          <div className="bg-neutral-800/60 border border-neutral-700/80 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                Como funciona o Treino Individual
              </div>
              <p className="text-neutral-300 text-xs leading-relaxed max-w-xl">
                Baixe as perguntas de qualquer sessão que você participou ou crie seu próprio banco. O avaliador local compara sua resposta com o gabarito oficial usando similaridade semântica e palavras-chave.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400">
              <span className="bg-neutral-800 px-3 py-1.5 rounded-lg border border-neutral-700 font-mono">
                {savedQuizzes.length} {savedQuizzes.length === 1 ? 'quiz salvo' : 'quizzes salvos'}
              </span>
            </div>
          </div>

          {/* Saved Quizzes Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>Meus Quizzes Salvos no Navegador</span>
              </h2>
            </div>

            {savedQuizzes.length === 0 ? (
              <div className="bg-neutral-800/40 border-2 border-dashed border-neutral-700/80 rounded-2xl p-8 text-center space-y-3">
                <FileCode2 className="w-10 h-10 text-neutral-500 mx-auto" />
                <h3 className="text-sm font-bold text-neutral-300">Nenhum quiz salvo localmente ainda</h3>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                  Você pode importar um arquivo JSON de perguntas, salvar as perguntas durante uma partida ao vivo, ou treinar com os exemplos abaixo.
                </p>
                <button
                  onClick={() => setIsImporting(true)}
                  className="bg-neutral-700 hover:bg-neutral-600 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors inline-flex items-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Importar Arquivo JSON
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {savedQuizzes.map((quiz) => (
                  <div
                    key={quiz.id}
                    className="bg-neutral-800/90 hover:bg-neutral-800 border border-neutral-700/80 hover:border-indigo-500/50 rounded-2xl p-5 transition-all space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-base text-neutral-100 line-clamp-1">{quiz.title}</h3>
                        <span className="text-[11px] font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full shrink-0">
                          {quiz.questionCount} {quiz.questionCount === 1 ? 'questão' : 'questões'}
                        </span>
                      </div>
                      {quiz.description && (
                        <p className="text-xs text-neutral-400 line-clamp-2">{quiz.description}</p>
                      )}
                      <p className="text-[10px] text-neutral-500 font-mono">
                        Salvo em: {new Date(quiz.createdAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-neutral-700/60 gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => handleDownloadQuiz(quiz, e)}
                          title="Baixar JSON deste quiz"
                          className="p-2 text-neutral-400 hover:text-white bg-neutral-700/50 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleHostWithQuiz(quiz, e)}
                          title="Hostear sala ao vivo com este quiz"
                          className="p-2 text-neutral-400 hover:text-indigo-400 bg-neutral-700/50 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Users className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteQuiz(quiz.id, e)}
                          title="Excluir do navegador"
                          className="p-2 text-neutral-400 hover:text-red-400 bg-neutral-700/50 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        onClick={() => startQuiz(quiz)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-indigo-600/20 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        Iniciar Treino
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Built-in Demo Quizzes */}
          <div className="space-y-4 pt-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-400" />
              <span>Quizzes de Exemplo (Prontos para Praticar)</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {DEMO_QUIZZES.map((demo) => (
                <div
                  key={demo.id}
                  className="bg-neutral-800/70 border border-neutral-700 hover:border-emerald-500/50 rounded-2xl p-5 space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-base text-neutral-100">{demo.title}</h3>
                      <span className="text-[11px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full shrink-0">
                        {demo.questionCount} questões
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400">{demo.description}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-neutral-700/60">
                    <button
                      onClick={(e) => handleDownloadQuiz(demo, e)}
                      title="Baixar JSON deste exemplo"
                      className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Baixar Modelo JSON
                    </button>

                    <button
                      onClick={() => startQuiz(demo)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Treinar com Exemplo
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* IMPORT MODAL */}
        {isImporting && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-neutral-850 border border-neutral-700 max-w-lg w-full rounded-3xl p-6 space-y-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-neutral-700 pb-3">
                <h3 className="font-bold text-lg text-white flex items-center gap-2">
                  <Upload className="w-5 h-5 text-indigo-400" />
                  Importar Quiz de Perguntas
                </h3>
                <button
                  onClick={() => {
                    setIsImporting(false);
                    setImportError(null);
                  }}
                  className="text-neutral-400 hover:text-white text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* File Upload Box */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-neutral-700 hover:border-indigo-500 rounded-2xl p-6 text-center space-y-2 cursor-pointer transition-colors bg-neutral-900/50"
                >
                  <FileCode2 className="w-8 h-8 text-indigo-400 mx-auto" />
                  <p className="text-sm font-bold text-neutral-200">
                    Clique para selecionar um arquivo .json
                  </p>
                  <p className="text-xs text-neutral-500">
                    Aceita o arquivo baixado de uma sessão anterior ou exportado pelo ChatGPT/Claude.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json,text/plain"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>

                <div className="relative text-center">
                  <span className="px-2 bg-neutral-850 text-xs font-bold text-neutral-500 uppercase">Ou Cole o Texto JSON</span>
                </div>

                {/* Paste Area */}
                <div>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="Cole aqui o conteúdo JSON com as perguntas..."
                    rows={6}
                    className="w-full bg-neutral-900 border border-neutral-700 focus:border-indigo-500 rounded-xl p-3 text-xs text-neutral-200 font-mono outline-none"
                  />
                </div>

                {importError && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-3 rounded-xl text-xs space-y-1">
                    <p className="font-bold">Falha ao importar:</p>
                    <p>{importError}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setIsImporting(false);
                    setImportError(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => processRawImport(importText)}
                  disabled={!importText.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
                >
                  Processar e Salvar Quiz
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // SCREEN 2: ACTIVE QUESTION / ANSWERING VIEW
  // -------------------------------------------------------------
  const currentQ = activeQuiz?.questions[currentIndex];

  if ((currentScreen === 'playing' || currentScreen === 'revealed') && currentQ) {
    const isAnswered = currentScreen === 'revealed' && currentGrading !== null;
    const progressPercent = Math.round(((currentIndex + 1) / (activeQuiz?.questions.length || 1)) * 100);

    return (
      <div className="min-h-screen bg-neutral-900 text-white font-sans flex flex-col">
        {/* Top Sticky Bar */}
        <div className="bg-neutral-850 border-b border-neutral-800 px-4 py-3 sticky top-0 z-30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (confirm('Deseja interromper o treino e voltar à lista de quizzes?')) {
                  setCurrentScreen('select');
                }
              }}
              className="p-2 text-neutral-400 hover:text-white bg-neutral-800 rounded-lg transition-colors cursor-pointer"
              title="Sair do Treino"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-sm font-bold text-white line-clamp-1 max-w-xs sm:max-w-md">
                {activeQuiz?.title}
              </h2>
              <span className="text-[11px] text-neutral-400 font-mono">
                Questão {currentIndex + 1} de {activeQuiz?.questions.length}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Timer Toggle or Indicator */}
            {secondsRemaining !== null ? (
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border ${
                secondsRemaining <= 10
                  ? 'bg-red-500/10 border-red-500/40 text-red-400 animate-pulse'
                  : 'bg-neutral-800 border-neutral-700 text-indigo-300'
              }`}>
                <Clock className="w-3.5 h-3.5" />
                <span>{secondsRemaining}s</span>
              </div>
            ) : (
              <button
                onClick={() => setEnableTimer(!enableTimer)}
                className="text-[11px] text-neutral-400 hover:text-neutral-200 bg-neutral-800 px-2.5 py-1 rounded-lg border border-neutral-700 cursor-pointer"
              >
                Modo Estudo Sem Pressa
              </button>
            )}

            <button
              onClick={() => downloadQuizAsJson(activeQuiz?.title || 'quiz', activeQuiz?.questions || [])}
              title="Baixar este quiz em JSON"
              className="p-2 text-neutral-400 hover:text-white bg-neutral-800 rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-neutral-800 h-1">
          <div
            className="bg-indigo-500 h-1 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 max-w-3xl w-full mx-auto p-4 md:p-6 flex flex-col justify-center space-y-6">
          {/* Question Card */}
          <div className="bg-neutral-800/90 border border-neutral-700 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between gap-2 border-b border-neutral-700/60 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                {currentQ.type === 'fill_blank' ? 'Preenchimento de Lacuna' : 'Resposta Curta Dissertativa'}
              </span>
              <span className="text-xs text-neutral-400 font-mono">
                {currentQ.timeLimit ? `${currentQ.timeLimit}s limite padrão` : 'Sem limite'}
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-xl md:text-2xl font-black text-white leading-relaxed">
                {currentQ.prompt}
              </h3>
              {currentQ.rubric_explanation && (
                <p className="text-xs text-neutral-400 italic">
                  Critério: {currentQ.rubric_explanation}
                </p>
              )}
            </div>

            {/* If NOT answered yet: show input form */}
            {!isAnswered ? (
              <form onSubmit={handleSubmitAnswer} className="space-y-4">
                {currentQ.type === 'fill_blank' ? (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">
                      Termo ou Conceito da Lacuna
                    </label>
                    <input
                      type="text"
                      value={studentInput}
                      onChange={(e) => setStudentInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Digite o termo que preenche a lacuna..."
                      autoFocus
                      disabled={isGrading}
                      className="w-full bg-neutral-900 border-2 border-neutral-700 focus:border-indigo-500 rounded-2xl p-4 text-base font-semibold text-white placeholder-neutral-500 outline-none transition-colors"
                    />
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400">
                        Sua Resposta Dissertativa
                      </label>
                      <span className="text-xs text-neutral-500 font-mono">
                        {studentInput.trim().split(/\s+/).filter(Boolean).length} palavras
                      </span>
                    </div>
                    <textarea
                      value={studentInput}
                      onChange={(e) => setStudentInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Escreva de 1 a 3 frases explicando o conceito com suas próprias palavras..."
                      rows={4}
                      autoFocus
                      disabled={isGrading}
                      className="w-full bg-neutral-900 border-2 border-neutral-700 focus:border-indigo-500 rounded-2xl p-4 text-sm text-white placeholder-neutral-500 outline-none transition-colors leading-relaxed"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 pt-2">
                  <span className="text-[11px] text-neutral-500 hidden sm:inline">
                    Pressione <kbd className="bg-neutral-700 px-1.5 py-0.5 rounded text-neutral-300">Ctrl + Enter</kbd> para enviar
                  </span>

                  <button
                    type="submit"
                    disabled={isGrading || !studentInput.trim()}
                    className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-bold text-sm px-6 py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer ml-auto"
                  >
                    {isGrading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Avaliando Resposta com IA Local...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Enviar e Corrigir</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* If ANSWERED: show detailed grading result */
              <div className="space-y-6 pt-2">
                {/* Result Header Banner */}
                <div className={`p-4 rounded-2xl border flex items-center justify-between gap-4 ${
                  currentGrading.score >= 0.8
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : currentGrading.score >= 0.5
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                  <div className="flex items-center gap-3">
                    {currentGrading.score >= 0.8 ? (
                      <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0" />
                    ) : currentGrading.score >= 0.5 ? (
                      <Award className="w-7 h-7 text-amber-400 shrink-0" />
                    ) : (
                      <XCircle className="w-7 h-7 text-red-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-black text-lg">
                        {currentGrading.score >= 0.8
                          ? 'Excelente! Resposta Correta'
                          : currentGrading.score >= 0.5
                          ? 'Resposta Parcial'
                          : 'Resposta Insuficiente'}
                      </div>
                      <p className="text-xs opacity-90">
                        {currentGrading.details.reason || 'Avaliação semântica concluída.'}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-2xl font-black font-mono">
                      {Math.round(currentGrading.score * 100)}%
                    </span>
                    <span className="block text-[10px] uppercase font-bold opacity-80">Nota</span>
                  </div>
                </div>

                {/* Answers Comparison */}
                <div className="space-y-3">
                  <div className="bg-neutral-900/80 p-4 rounded-xl border border-neutral-700/80 space-y-1">
                    <span className="text-[10px] uppercase font-bold text-neutral-400">Sua Resposta:</span>
                    <p className="text-sm text-neutral-200 font-medium italic">
                      "{studentInput}"
                    </p>
                  </div>

                  <div className="bg-neutral-900/80 p-4 rounded-xl border border-emerald-500/30 space-y-1">
                    <span className="text-[10px] uppercase font-bold text-emerald-400">Resposta-Modelo do Gabarito:</span>
                    <p className="text-sm text-neutral-100 font-medium">
                      "{currentQ.reference_answer}"
                    </p>
                  </div>
                </div>

                {/* Keywords & Diagnostics */}
                {currentGrading.details && (
                  <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-700/60 space-y-3 text-xs">
                    {/* Found / Missing keywords */}
                    {Array.isArray(currentGrading.details.foundKeywords) && currentGrading.details.foundKeywords.length > 0 && (
                      <div>
                        <span className="text-neutral-400 block mb-1.5 font-bold">Palavras-chave encontradas:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {currentGrading.details.foundKeywords.map((kw, i) => (
                            <span key={i} className="bg-emerald-950 text-emerald-300 px-2.5 py-0.5 rounded text-[11px] font-mono border border-emerald-800">
                              ✓ {String(kw)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(currentGrading.details.missingKeywords) && currentGrading.details.missingKeywords.length > 0 && (
                      <div>
                        <span className="text-neutral-400 block mb-1.5 font-bold">Palavras-chave ausentes sugeridas:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {currentGrading.details.missingKeywords.map((kw, i) => (
                            <span key={i} className="bg-red-950 text-red-300 px-2.5 py-0.5 rounded text-[11px] font-mono border border-red-800">
                              ✗ {String(kw)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-neutral-700/60 text-[11px]">
                      <div>
                        <span className="text-neutral-500 block">Modo:</span>
                        <span className="font-bold text-neutral-300 uppercase">
                          {currentGrading.mode === 'exact' ? 'Exato' : currentGrading.mode === 'semantic' ? 'Semântico' : 'Léxico'}
                        </span>
                      </div>
                      {typeof currentGrading.details.cosineSimilarity === 'number' && (
                        <div>
                          <span className="text-neutral-500 block">Similaridade Vetorial:</span>
                          <span className="font-mono font-bold text-indigo-300">
                            {(currentGrading.details.cosineSimilarity * 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                      {typeof currentGrading.details.lexicalSimilarity === 'number' && (
                        <div>
                          <span className="text-neutral-500 block">Similaridade Léxica:</span>
                          <span className="font-mono font-bold text-neutral-300">
                            {(currentGrading.details.lexicalSimilarity * 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Bottom Navigation Buttons */}
                <div className="flex items-center justify-between gap-3 pt-2 border-t border-neutral-700/60">
                  <button
                    onClick={handleRetryQuestion}
                    className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold text-xs px-4 py-2.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Tentar Novamente</span>
                  </button>

                  <button
                    onClick={handleNextQuestion}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-600/20 cursor-pointer"
                  >
                    <span>
                      {currentIndex + 1 < activeQuiz.questions.length ? 'Próxima Questão →' : 'Ver Resultado Final 🏆'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // SCREEN 3: QUIZ SUMMARY & PERFORMANCE REVIEW
  // -------------------------------------------------------------
  if (currentScreen === 'summary' && activeQuiz) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white font-sans p-4 md:p-8">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Header Card */}
          <div className="bg-neutral-800/90 border border-neutral-700 rounded-3xl p-8 shadow-2xl text-center space-y-5">
            <div className="w-16 h-16 bg-indigo-600/20 border border-indigo-500/40 rounded-2xl flex items-center justify-center mx-auto text-indigo-400">
              <Award className="w-9 h-9" />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">
                Treino Concluído com Sucesso
              </span>
              <h1 className="text-3xl font-black text-white">{activeQuiz.title}</h1>
              <p className="text-xs text-neutral-400">
                Você respondeu a todas as {totalQuestions} questões com correção semântica local.
              </p>
            </div>

            {/* Score Big Display */}
            <div className="bg-neutral-900/80 border border-neutral-700 rounded-2xl p-6 max-w-sm mx-auto space-y-1">
              <div className="text-4xl font-black font-mono text-indigo-400">
                {avgScore}%
              </div>
              <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
                Desempenho Geral Médio
              </span>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-3 gap-3 max-w-md mx-auto text-center pt-2">
              <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-xl">
                <span className="text-xl font-bold font-mono text-emerald-400">{perfectCount}</span>
                <span className="block text-[10px] text-emerald-300 font-semibold uppercase">Excelentes (≥80%)</span>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl">
                <span className="text-xl font-bold font-mono text-amber-400">{partialCount}</span>
                <span className="block text-[10px] text-amber-300 font-semibold uppercase">Parciais (50-79%)</span>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl">
                <span className="text-xl font-bold font-mono text-red-400">{lowCount}</span>
                <span className="block text-[10px] text-red-300 font-semibold uppercase">Revisar (&lt;50%)</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-neutral-700/60">
              <button
                onClick={() => startQuiz(activeQuiz)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-3 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/20 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Refazer Todo o Quiz</span>
              </button>

              {lowCount + partialCount > 0 && (
                <button
                  onClick={handleRetryMissedOnly}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-5 py-3 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-amber-600/20 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Treinar Apenas as que Preciso Melhorar</span>
                </button>
              )}

              <button
                onClick={() => downloadQuizAsJson(activeQuiz.title, activeQuiz.questions)}
                className="bg-neutral-700 hover:bg-neutral-600 text-white font-bold text-xs px-4 py-3 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Quiz (.json)</span>
              </button>

              <button
                onClick={() => handleHostWithQuiz(activeQuiz, {} as any)}
                className="bg-neutral-700 hover:bg-neutral-600 text-indigo-300 font-bold text-xs px-4 py-3 rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
              >
                <Users className="w-4 h-4" />
                <span>Hostear como Sala Coletiva</span>
              </button>

              <button
                onClick={() => setCurrentScreen('select')}
                className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold text-xs px-4 py-3 rounded-xl transition-colors cursor-pointer"
              >
                Voltar à Lista de Quizzes
              </button>
            </div>
          </div>

          {/* Question by Question Review */}
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">Revisão Detalhada das Respostas</h2>

            <div className="space-y-3">
              {answerHistory.map((record, i) => (
                <div
                  key={i}
                  className="bg-neutral-800/80 border border-neutral-700/80 rounded-2xl p-5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold uppercase text-indigo-400 font-mono">
                        Questão {i + 1}
                      </span>
                      <h4 className="font-bold text-sm text-neutral-100">{record.question.prompt}</h4>
                    </div>

                    <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full border ${
                      record.score >= 0.8
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : record.score >= 0.5
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}>
                      {Math.round(record.score * 100)}%
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="bg-neutral-900/60 p-3 rounded-xl border border-neutral-700/60 space-y-1">
                      <span className="text-[10px] text-neutral-400 font-bold uppercase">Sua Resposta:</span>
                      <p className="text-neutral-200 italic">"{record.studentAnswer}"</p>
                    </div>

                    <div className="bg-neutral-900/60 p-3 rounded-xl border border-emerald-500/30 space-y-1">
                      <span className="text-[10px] text-emerald-400 font-bold uppercase">Gabarito Oficial:</span>
                      <p className="text-neutral-200">"{record.question.reference_answer}"</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
