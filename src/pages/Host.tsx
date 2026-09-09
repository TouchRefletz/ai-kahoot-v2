import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, collection, onSnapshot, query, orderBy, updateDoc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore';
import { computeEmbedding } from '../lib/embeddings';
import { gradeShortAnswerAsync } from '../lib/grading';
import { Question, QuestionType, PlayerData } from '../lib/types';
import {
  extractJsonFromText, sanitizeQuestions, generateExternalAIPrompt
} from '../lib/parser';
import {
  Upload, FileText, Trash2, Play, Users, BrainCircuit, CheckCircle2,
  Copy, Check, Download, Sparkles, PlusCircle, AlertCircle, ChevronRight,
  Trophy, X, FileCode, ArrowRight, CornerDownRight, RefreshCw, Layers,
  Gamepad2, Send, Clock, FastForward, Medal
} from 'lucide-react';
import { cn } from '../lib/utils';
import confetti from 'canvas-confetti';

export default function Host() {
  const navigate = useNavigate();
  const [gameId, setGameId] = useState<string | null>(null);

  // Tabs in Host setup: 'prompt_builder' | 'import' | 'manual'
  const [activeTab, setActiveTab] = useState<'prompt_builder' | 'import' | 'manual'>('prompt_builder');

  // Prompt Generator State
  const [topic, setTopic] = useState('Biologia Celular: Estrutura da Membrana Plasmática e Transporte Celular');
  const [numQuestions, setNumQuestions] = useState(6);
  const [difficulty, setDifficulty] = useState('Ensino Médio / Vestibular');
  const [typeDistribution, setTypeDistribution] = useState('50% resposta curta e 50% preenchimento de lacunas');
  const [customPromptNotes, setCustomPromptNotes] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Import State
  const [pastedContent, setPastedContent] = useState('');
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Manual Question State
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualType, setManualType] = useState<QuestionType>('short_answer');
  const [manualCanonicals, setManualCanonicals] = useState('');
  const [manualRefAnswer, setManualRefAnswer] = useState('');
  const [manualKeywords, setManualKeywords] = useState('');
  const [manualTimeLimit, setManualTimeLimit] = useState(45);
  const [manualFullThresh, setManualFullThresh] = useState(0.82);
  const [manualPartialThresh, setManualPartialThresh] = useState(0.65);
  const [savingManual, setSavingManual] = useState(false);

  // Game State
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  // Host as Player State
  const [hostPlays, setHostPlays] = useState<boolean>(true);
  const [hostNickname, setHostNickname] = useState<string>(
    auth.currentUser?.displayName ? `Host (${auth.currentUser.displayName})` : 'Host'
  );
  const [hostAnswerText, setHostAnswerText] = useState('');
  const [isSubmittingHost, setIsSubmittingHost] = useState(false);
  const [hostGradingResult, setHostGradingResult] = useState<any>(null);

  useEffect(() => {
    if (!auth.currentUser) {
      navigate('/');
      return;
    }

    // Create session on mount
    const newGameId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setGameId(newGameId);

    const initGame = async () => {
      try {
        await setDoc(doc(db, 'games', newGameId), {
          hostUid: auth.currentUser!.uid,
          status: 'lobby',
          currentQuestionIndex: 0,
          createdAt: new Date().toISOString()
        });

        // Automatically register Host as player so the host can play and compete in the ranking
        const initialName = auth.currentUser!.displayName 
          ? `Host (${auth.currentUser!.displayName})` 
          : 'Host';

        await setDoc(doc(db, `games/${newGameId}/players`, auth.currentUser!.uid), {
          uid: auth.currentUser!.uid,
          name: initialName,
          score: 0,
          currentAnswer: null,
          lastAnswerCorrect: null,
          lastScoreAdded: 0,
          lastGradingResult: null,
          joinedAt: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `games/${newGameId}`);
      }
    };
    initGame();

    // Listeners
    const unsubGame = onSnapshot(doc(db, 'games', newGameId), (d) => {
      if (d.exists()) setGameState(d.data());
    }, (err) => handleFirestoreError(err, OperationType.GET, `games/${newGameId}`));

    const unsubPlayers = onSnapshot(collection(db, `games/${newGameId}/players`), (snap) => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() } as PlayerData)).sort((a, b) => b.score - a.score));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${newGameId}/players`));

    const unsubQuestions = onSnapshot(query(collection(db, `games/${newGameId}/questions`), orderBy('index')), (snap) => {
      setQuestions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Question)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${newGameId}/questions`));

    return () => {
      unsubGame();
      unsubPlayers();
      unsubQuestions();
    };
  }, [navigate]);

  // Reset host answer when question changes
  useEffect(() => {
    if (gameState?.status === 'question') {
      setHostAnswerText('');
      setIsSubmittingHost(false);
      setHostGradingResult(null);
    }
  }, [gameState?.currentQuestionIndex, gameState?.status]);

  const toggleHostParticipation = async (enable: boolean, customName?: string) => {
    if (!gameId || !auth.currentUser) return;
    setHostPlays(enable);
    const hostUid = auth.currentUser.uid;
    const finalName = (customName !== undefined ? customName : hostNickname).trim() || 'Host';

    try {
      if (enable) {
        await setDoc(doc(db, `games/${gameId}/players`, hostUid), {
          uid: hostUid,
          name: finalName,
          score: 0,
          currentAnswer: null,
          lastAnswerCorrect: null,
          lastScoreAdded: 0,
          lastGradingResult: null,
          joinedAt: new Date().toISOString()
        }, { merge: true });
      } else {
        await deleteDoc(doc(db, `games/${gameId}/players`, hostUid));
      }
    } catch (err) {
      console.error('Erro ao sincronizar participação do host:', err);
    }
  };

  const handleSubmitHostAnswer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmittingHost || !hostAnswerText.trim() || !gameId || !auth.currentUser) return;
    const currentQ = questions[gameState?.currentQuestionIndex];
    if (!currentQ || gameState?.status !== 'question') return;

    setIsSubmittingHost(true);
    const trimmedAnswer = hostAnswerText.trim();

    try {
      // 1. Grade the short answer locally (all-MiniLM-L6-v2 + lexical + canonical)
      const gradingResult = await gradeShortAnswerAsync(trimmedAnswer, currentQ);
      setHostGradingResult(gradingResult);

      // 2. Compute points based on score (0.0 to 1.0) and response time
      const start = gameState.questionStartTime ? new Date(gameState.questionStartTime).getTime() : Date.now();
      const now = Date.now();
      const elapsed = Math.max(0, (now - start) / 1000);
      const timeRatio = Math.min(elapsed / (currentQ.timeLimit || 45), 1);
      const timeMultiplier = Math.max(0.70, 1 - 0.30 * Math.pow(timeRatio, 2));
      const points = Math.round(gradingResult.score * 1000 * timeMultiplier);
      const isCorrect = gradingResult.score >= 0.5;

      const hostUid = auth.currentUser.uid;
      const currentHostPlayer = players.find(p => p.id === hostUid);

      // 3. Save to Firestore
      await updateDoc(doc(db, `games/${gameId}/players`, hostUid), {
        currentAnswer: trimmedAnswer,
        answeredAt: new Date().toISOString(),
        lastAnswerCorrect: isCorrect,
        lastScoreAdded: points,
        lastGradingResult: gradingResult,
        score: (currentHostPlayer?.score || 0) + points
      });
    } catch (err) {
      console.error('Erro ao avaliar resposta do host:', err);
    } finally {
      setIsSubmittingHost(false);
    }
  };

  const finalizeQuestionAndReveal = async () => {
    if (!gameId || !gameState) return;
    processedQuestionIndex.current = gameState.currentQuestionIndex;
    setTimeLeft(0);

    const currentQ = questions[gameState.currentQuestionIndex];
    try {
      const batch = writeBatch(db);

      // Make sure all players who did not answer are marked as 0 pts / unanswered
      players.forEach(p => {
        const hasAnswer = Boolean(p.currentAnswer && p.currentAnswer.trim().length > 0);
        if (!hasAnswer) {
          const pRef = doc(db, `games/${gameId}/players`, p.id!);
          batch.update(pRef, {
            currentAnswer: '',
            lastAnswerCorrect: false,
            lastScoreAdded: 0,
            lastGradingResult: {
              score: 0,
              mode: 'none',
              details: {
                normalizedStudent: '',
                normalizedReference: currentQ?.reference_answer || '',
                lexicalSimilarity: 0,
                jaccardSimilarity: 0,
                cosineSimilarity: 0,
                reason: 'Tempo esgotado - Sem resposta enviada'
              }
            }
          });
        }
      });

      batch.update(doc(db, 'games', gameId), { status: 'answer_reveal' });
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `games/${gameId}`);
    }
  };

  const forceRevealAnswer = async () => {
    await finalizeQuestionAndReveal();
  };

  const processedQuestionIndex = useRef(-1);

  // Timer logic for Host
  useEffect(() => {
    if (gameState?.status === 'question' && gameState?.questionStartTime) {
      const currentQ = questions[gameState.currentQuestionIndex];
      if (!currentQ) return;

      const interval = setInterval(async () => {
        if (processedQuestionIndex.current === gameState.currentQuestionIndex) return;

        const start = new Date(gameState.questionStartTime).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / 1000);
        const remaining = (currentQ.timeLimit || 45) - elapsed;

        const allAnswered = players.length > 0 && players.every(
          p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== ''
        );

        if (remaining <= 0 || allAnswered) {
          processedQuestionIndex.current = gameState.currentQuestionIndex;
          setTimeLeft(0);
          clearInterval(interval);
          await finalizeQuestionAndReveal();
        } else {
          setTimeLeft(remaining);
        }
      }, 500);

      return () => clearInterval(interval);
    }
  }, [gameState?.status, gameState?.questionStartTime, gameState?.currentQuestionIndex, questions, gameId, players]);

  // Generate the formatted prompt to copy
  const generatedPrompt = generateExternalAIPrompt({
    topic,
    numQuestions,
    difficulty,
    typeDistribution,
    customInstructions: customPromptNotes.trim()
  });

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(generatedPrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 3000);
  };

  const handleDownloadSampleJson = () => {
    const sampleData = [
      {
        type: "fill_blank",
        prompt: "A organela celular responsável pela respiração celular aeróbica e síntese de ATP é a _____.",
        canonical_answers: ["mitocondria", "mitocôndria", "as mitocondrias"],
        reference_answer: "A mitocôndria é a organela onde ocorrem o ciclo de Krebs e a fosforilação oxidativa para produzir ATP.",
        required_keywords: ["mitocondria"],
        thresholds: { full: 0.82, partial: 0.65 },
        rubric_explanation: "Identificar a organela mitocôndria.",
        timeLimit: 40
      },
      {
        type: "short_answer",
        prompt: "Explique sucintamente qual é a função das enzimas nas reações bioquímicas.",
        canonical_answers: [
          "catalisadores biologicos que aceleram as reacoes",
          "diminuir a energia de ativacao e acelerar a velocidade da reacao"
        ],
        reference_answer: "Enzimas atuam como catalisadores biológicos que reduzem a energia de ativação necessária, acelerando a velocidade das reações químicas sem serem consumidas.",
        required_keywords: ["catalisadores", "energia de ativacao"],
        thresholds: { full: 0.80, partial: 0.65 },
        rubric_explanation: "Explicar o papel catalítico e a redução da energia de ativação.",
        timeLimit: 45
      }
    ];

    const blob = new Blob([JSON.stringify(sampleData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_questoes_treino.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportQuestions = () => {
    if (questions.length === 0) return;
    const cleanList = questions.map(q => ({
      type: q.type,
      prompt: q.prompt,
      canonical_answers: q.canonical_answers,
      reference_answer: q.reference_answer,
      required_keywords: q.required_keywords,
      thresholds: q.thresholds,
      rubric_explanation: q.rubric_explanation,
      timeLimit: q.timeLimit
    }));

    const blob = new Blob([JSON.stringify(cleanList, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `questoes_sala_${gameId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Process text or file upload
  const processAndImportText = async (rawText: string, sourceName?: string) => {
    setImportError(null);
    setImportSuccess(null);
    setIsProcessingImport(true);

    try {
      // 1. Parse and extract JSON
      const parsed = extractJsonFromText(rawText);

      // 2. Validate and sanitize
      const sanitized = sanitizeQuestions(parsed);

      setImportProgress({ current: 0, total: sanitized.length });

      // 3. Compute local embeddings via all-MiniLM-L6-v2 in browser
      const startIndex = questions.length;
      const batch = writeBatch(db);

      for (let i = 0; i < sanitized.length; i++) {
        setImportProgress({ current: i + 1, total: sanitized.length });
        const item = sanitized[i];

        const embeddingRef = await computeEmbedding(item.reference_answer);

        const newQuestion: Question = {
          index: startIndex + i,
          type: item.type,
          prompt: item.prompt,
          canonical_answers: item.canonical_answers,
          reference_answer: item.reference_answer,
          embedding_ref: embeddingRef,
          required_keywords: item.required_keywords,
          thresholds: item.thresholds,
          rubric_explanation: item.rubric_explanation || '',
          timeLimit: item.timeLimit
        };

        const qRef = doc(collection(db, `games/${gameId}/questions`));
        batch.set(qRef, newQuestion);
      }

      await batch.commit();

      setImportSuccess(`Sucesso! ${sanitized.length} questões importadas com embeddings semânticos calculados.`);
      setPastedContent('');
      setImportedFileName(null);
    } catch (err: any) {
      console.error(err);
      setImportError(err.message || 'Erro ao processar as questões. Verifique se o formato está de acordo com o modelo.');
    } finally {
      setIsProcessingImport(false);
      setImportProgress(null);
    }
  };

  const handleFileUpload = async (file: File) => {
    setImportedFileName(file.name);
    try {
      const text = await file.text();
      await processAndImportText(text, file.name);
    } catch (err: any) {
      setImportError('Erro ao ler arquivo: ' + err.message);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDeleteQuestion = async (qId: string) => {
    try {
      await deleteDoc(doc(db, `games/${gameId}/questions`, qId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `games/${gameId}/questions/${qId}`);
    }
  };

  const handleClearAllQuestions = async () => {
    if (!confirm('Deseja realmente apagar todas as questões desta sessão?')) return;
    try {
      const batch = writeBatch(db);
      questions.forEach(q => {
        if (q.id) {
          batch.delete(doc(db, `games/${gameId}/questions`, q.id));
        }
      });
      await batch.commit();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateManualQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPrompt.trim() || !manualRefAnswer.trim()) {
      alert('Preencha pelo menos o enunciado e a resposta-modelo.');
      return;
    }

    setSavingManual(true);
    try {
      const canonicals = manualCanonicals
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);

      const keywords = manualKeywords
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const embeddingRef = await computeEmbedding(manualRefAnswer.trim());

      const newQuestion: Question = {
        index: questions.length,
        type: manualType,
        prompt: manualPrompt.trim(),
        canonical_answers: canonicals.length > 0 ? canonicals : [manualRefAnswer.trim()],
        reference_answer: manualRefAnswer.trim(),
        embedding_ref: embeddingRef,
        required_keywords: keywords,
        thresholds: {
          full: Number(manualFullThresh),
          partial: Number(manualPartialThresh)
        },
        timeLimit: Number(manualTimeLimit) || 45
      };

      const qRef = doc(collection(db, `games/${gameId}/questions`));
      await setDoc(qRef, newQuestion);

      setShowManualModal(false);
      setManualPrompt('');
      setManualCanonicals('');
      setManualRefAnswer('');
      setManualKeywords('');
    } catch (err: any) {
      alert('Erro ao cadastrar questão: ' + err.message);
    } finally {
      setSavingManual(false);
    }
  };

  const startGame = async () => {
    if (questions.length === 0) return;
    processedQuestionIndex.current = -1;
    setHostAnswerText('');
    setHostSubmitted(false);
    setHostGradingResult(null);
    try {
      const batch = writeBatch(db);
      players.forEach(p => {
        const pRef = doc(db, `games/${gameId}/players`, p.id!);
        batch.update(pRef, {
          score: 0,
          currentAnswer: null,
          lastAnswerCorrect: null,
          lastScoreAdded: 0,
          lastGradingResult: null,
          answeredAt: null
        });
      });

      batch.update(doc(db, 'games', gameId!), {
        status: 'question',
        currentQuestionIndex: 0,
        questionStartTime: new Date().toISOString()
      });

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `games/${gameId}`);
    }
  };

  const nextQuestion = async () => {
    const nextIdx = gameState.currentQuestionIndex + 1;
    if (nextIdx >= questions.length) {
      await updateDoc(doc(db, 'games', gameId!), { status: 'podium' });
      confetti({ particleCount: 300, spread: 150, origin: { y: 0.6 } });
    } else {
      processedQuestionIndex.current = -1;
      setHostAnswerText('');
      setHostSubmitted(false);
      setHostGradingResult(null);
      const batch = writeBatch(db);
      players.forEach(p => {
        const pRef = doc(db, `games/${gameId}/players`, p.id!);
        batch.update(pRef, {
          currentAnswer: null,
          lastAnswerCorrect: null,
          lastScoreAdded: 0,
          lastGradingResult: null,
          answeredAt: null
        });
      });

      batch.update(doc(db, 'games', gameId!), {
        status: 'question',
        currentQuestionIndex: nextIdx,
        questionStartTime: new Date().toISOString()
      });

      await batch.commit();
    }
  };

  if (!gameId || !gameState) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center text-white font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-semibold text-neutral-400">Iniciando sala do professor...</p>
        </div>
      </div>
    );
  }

  const currentQ = questions[gameState.currentQuestionIndex];
  const hostPlayer = players.find(p => p.id === auth.currentUser?.uid);

  return (
    <div className="min-h-screen bg-neutral-900 text-white font-sans flex flex-col">
      {/* Header */}
      <header className="bg-neutral-950 px-6 py-4 border-b border-neutral-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600/20 p-2.5 rounded-xl border border-indigo-500/30">
            <BrainCircuit className="w-7 h-7 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight flex items-center gap-2">
              Treino Dissertativo
              <span className="text-[10px] bg-indigo-950 border border-indigo-700/60 text-indigo-300 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                IA Externa + Correção Local
              </span>
            </h1>
            <p className="text-xs text-neutral-400">Use ChatGPT, Claude ou Gemini Web livremente • Embeddings calculados no navegador</p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {hostPlays && (
            <div className="hidden sm:flex items-center gap-2 bg-indigo-950/70 border border-indigo-700/60 px-3 py-1.5 rounded-xl text-xs">
              <Gamepad2 className="w-4 h-4 text-indigo-400" />
              <span className="text-neutral-400">Host Jogando:</span>
              <span className="text-indigo-300 font-bold">{hostNickname}</span>
              <span className="text-emerald-400 font-mono font-bold">({hostPlayer?.score || 0} pts)</span>
            </div>
          )}

          <div className="bg-neutral-800/90 px-5 py-2 rounded-xl border border-neutral-700 text-center">
            <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-extrabold">PIN DA SALA</p>
            <p className="text-2xl font-black tracking-widest text-indigo-400 font-mono">{gameId}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col max-w-7xl mx-auto w-full">

        {/* LOBBY / SETUP SCREEN */}
        {(gameState.status === 'lobby' || gameState.status === 'ended') && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">

            {/* Left: Tabbed Questions Creator */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-neutral-800/90 p-6 rounded-3xl border border-neutral-700 shadow-xl space-y-5">

                {/* Tabs Navigation */}
                <div className="flex flex-wrap gap-2 border-b border-neutral-700 pb-4">
                  <button
                    onClick={() => setActiveTab('prompt_builder')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer",
                      activeTab === 'prompt_builder'
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                        : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-750"
                    )}
                  >
                    <Sparkles className="w-4 h-4" />
                    1. Gerador de Prompt para IA
                  </button>

                  <button
                    onClick={() => setActiveTab('import')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer",
                      activeTab === 'import'
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                        : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-750"
                    )}
                  >
                    <Upload className="w-4 h-4" />
                    2. Importar Arquivo / Colar Resposta
                  </button>

                  <button
                    onClick={() => setActiveTab('manual')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer",
                      activeTab === 'manual'
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                        : "bg-neutral-900 text-neutral-400 hover:text-white hover:bg-neutral-750"
                    )}
                  >
                    <PlusCircle className="w-4 h-4" />
                    3. Adicionar Manual
                  </button>
                </div>

                {/* TAB 1: PROMPT BUILDER FOR EXTERNAL AI */}
                {activeTab === 'prompt_builder' && (
                  <div className="space-y-4">
                    <div className="bg-indigo-950/40 border border-indigo-800/60 p-4 rounded-2xl flex items-start gap-3 text-xs text-indigo-200">
                      <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block text-indigo-100 text-sm mb-0.5">Como funciona a geração externa:</strong>
                        Preencha o tema abaixo, copie o prompt gerado e cole no <strong>ChatGPT</strong>, <strong>Claude</strong>, <strong>Gemini Web</strong> ou <strong>DeepSeek</strong>. A IA vai te devolver um arquivo/código JSON formatado perfeitamente para este app.
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                          Assunto / Conteúdo da Prova
                        </label>
                        <input
                          type="text"
                          value={topic}
                          onChange={e => setTopic(e.target.value)}
                          placeholder="Ex: Revolução Francesa, Fisiologia Renal, Leis de Newton, Funções em JavaScript..."
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-3 text-sm text-white font-medium focus:border-indigo-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                          Quantidade de Questões
                        </label>
                        <select
                          value={numQuestions}
                          onChange={e => setNumQuestions(Number(e.target.value))}
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-3 text-sm text-white font-semibold outline-none"
                        >
                          <option value={4}>4 Questões</option>
                          <option value={6}>6 Questões</option>
                          <option value={8}>8 Questões</option>
                          <option value={10}>10 Questões</option>
                          <option value={15}>15 Questões</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                          Nível de Dificuldade
                        </label>
                        <select
                          value={difficulty}
                          onChange={e => setDifficulty(e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-3 text-sm text-white font-semibold outline-none"
                        >
                          <option value="Ensino Fundamental">Ensino Fundamental</option>
                          <option value="Ensino Médio / Vestibular">Ensino Médio / Vestibular</option>
                          <option value="Ensino Superior / Graduação">Ensino Superior / Graduação</option>
                          <option value="Concurso Público / Avançado">Concurso Público / Avançado</option>
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                          Proporção de Tipos
                        </label>
                        <select
                          value={typeDistribution}
                          onChange={e => setTypeDistribution(e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-3 text-sm text-white font-semibold outline-none"
                        >
                          <option value="50% resposta curta e 50% preenchimento de lacunas">Misto (50% Resposta Curta + 50% Preenchimento de Lacunas)</option>
                          <option value="100% resposta curta dissertativa">Somente Respostas Curtas Dissertativas</option>
                          <option value="100% preenchimento de lacunas">Somente Frases com Lacunas (____)</option>
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                          Instruções Opcionais para a IA
                        </label>
                        <input
                          type="text"
                          value={customPromptNotes}
                          onChange={e => setCustomPromptNotes(e.target.value)}
                          placeholder="Ex: Exigir termos técnicos de biologia celular, focar nas enzimas mais importantes..."
                          className="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-3 text-sm text-white placeholder-neutral-500 focus:border-indigo-500 outline-none"
                        />
                      </div>
                    </div>

                    {/* Copyable Prompt Box */}
                    <div className="space-y-2 pt-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                          <FileCode className="w-4 h-4 text-indigo-400" />
                          Prompt Gerado (Pronto para copiar):
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleDownloadSampleJson}
                            className="text-xs font-semibold text-neutral-400 hover:text-neutral-200 flex items-center gap-1 bg-neutral-900 hover:bg-neutral-750 px-2.5 py-1 rounded-lg border border-neutral-700 transition-colors"
                            title="Baixar arquivo JSON de exemplo"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Baixar Modelo (.json)
                          </button>
                        </div>
                      </div>

                      <div className="relative">
                        <textarea
                          readOnly
                          value={generatedPrompt}
                          rows={6}
                          className="w-full bg-neutral-950 border border-neutral-700 rounded-xl p-3.5 text-xs text-neutral-300 font-mono outline-none resize-none select-all"
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 pt-1">
                        <button
                          onClick={handleCopyPrompt}
                          className={cn(
                            "flex-1 py-3.5 px-6 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer",
                            copiedPrompt
                              ? "bg-emerald-600 text-white shadow-emerald-600/20"
                              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20"
                          )}
                        >
                          {copiedPrompt ? (
                            <>
                              <Check className="w-5 h-5" />
                              PROMPT COPIADO COM SUCESSO!
                            </>
                          ) : (
                            <>
                              <Copy className="w-5 h-5" />
                              COPIAR PROMPT PARA A IA
                            </>
                          )}
                        </button>

                        <button
                          onClick={() => setActiveTab('import')}
                          className="py-3.5 px-5 bg-neutral-750 hover:bg-neutral-700 text-neutral-200 font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 border border-neutral-700 cursor-pointer"
                        >
                          Ir para Importação
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: IMPORT FILE OR PASTE RAW JSON */}
                {activeTab === 'import' && (
                  <div className="space-y-4">
                    <div className="bg-neutral-900/60 p-4 rounded-2xl border border-neutral-700/80 text-xs text-neutral-300 space-y-1">
                      <p className="font-bold text-neutral-100 text-sm">Pronto para importar:</p>
                      <p>
                        Solte o arquivo <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-indigo-300 font-mono">.json</code> ou <code className="bg-neutral-800 px-1.5 py-0.5 rounded text-indigo-300 font-mono">.txt</code> salvo da IA, ou simplesmente cole a resposta de texto no campo abaixo. O app extrai as questões automaticamente e calcula os embeddings locais (all-MiniLM-L6-v2) na hora!
                      </p>
                    </div>

                    {/* File Dropzone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all",
                        isDragging ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-750"
                      )}
                    >
                      <Upload className={cn("w-8 h-8 mx-auto mb-2", isDragging ? "text-indigo-400" : "text-neutral-400")} />
                      <p className="font-bold text-neutral-200 text-sm">
                        {importedFileName ? `Arquivo: ${importedFileName}` : 'Arraste o arquivo .json da IA aqui'}
                      </p>
                      <p className="text-xs text-neutral-400 mt-1">ou clique para escolher do seu computador</p>
                      <input
                        type="file"
                        accept=".json,.txt"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleFileUpload(e.target.files[0]);
                          }
                        }}
                      />
                    </div>

                    <div className="relative flex items-center justify-center my-2">
                      <div className="w-full border-t border-neutral-750"></div>
                      <span className="absolute bg-neutral-800 px-3 text-[11px] font-bold uppercase text-neutral-400">
                        OU COLE O TEXTO DIRETAMENTE
                      </span>
                    </div>

                    {/* Paste Area */}
                    <div>
                      <textarea
                        value={pastedContent}
                        onChange={e => setPastedContent(e.target.value)}
                        placeholder="Cole aqui o texto ou código JSON retornado pelo ChatGPT, Claude, Gemini ou DeepSeek..."
                        rows={6}
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-xl p-3 text-xs text-neutral-200 font-mono focus:border-indigo-500 outline-none leading-relaxed"
                      />
                    </div>

                    {/* Import Button */}
                    <button
                      onClick={() => processAndImportText(pastedContent)}
                      disabled={isProcessingImport || !pastedContent.trim()}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-750 disabled:text-neutral-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isProcessingImport ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          <span>
                            {importProgress
                              ? `Calculando embedding local (${importProgress.current}/${importProgress.total})...`
                              : 'Processando questões e calculando embeddings...'}
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-5 h-5" />
                          Processar Questões e Calcular Embeddings Locais
                        </>
                      )}
                    </button>

                    {/* Feedback Messages */}
                    {importSuccess && (
                      <div className="p-3.5 bg-emerald-950/60 border border-emerald-700 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{importSuccess}</span>
                      </div>
                    )}

                    {importError && (
                      <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-red-300 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{importError}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: MANUAL QUESTION CREATION */}
                {activeTab === 'manual' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-neutral-400">
                        Crie questões uma a uma com controle total sobre as respostas canônicas e limiares semânticos.
                      </p>
                      <button
                        onClick={() => setShowManualModal(true)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <PlusCircle className="w-4 h-4" />
                        Abrir Formulário de Criação
                      </button>
                    </div>

                    <div className="bg-neutral-900/60 p-4 rounded-2xl border border-neutral-700/80 text-xs text-neutral-400 space-y-2">
                      <strong className="text-neutral-200 block">Dicas para formulação:</strong>
                      <ul className="list-disc list-inside space-y-1">
                        <li>Em <strong>Preenchimento de Lacuna</strong>, use exatamente <code className="text-amber-300">_____</code> para demarcar onde o aluno deve preencher.</li>
                        <li>Na <strong>Resposta-Modelo</strong>, forneça a frase padrão ouro que sintetiza o conceito. O embedding local de 384 dimensões será gerado a partir dela.</li>
                        <li>Nas <strong>Respostas Canônicas</strong>, adicione variações de grafia e sinônimos diretos que garantem 100% da nota imediatamente.</li>
                      </ul>
                    </div>
                  </div>
                )}

              </div>

              {/* QUESTIONS PREVIEW & MANAGEMENT */}
              {questions.length > 0 && (
                <div className="bg-neutral-800/90 p-6 rounded-3xl border border-neutral-700 shadow-xl space-y-4">
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-400" />
                      Questões Carregadas para a Sessão ({questions.length})
                    </h2>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleExportQuestions}
                        className="text-xs font-bold text-neutral-300 hover:text-white bg-neutral-900 border border-neutral-700 hover:bg-neutral-750 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Exportar arquivo JSON para reutilizar depois"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Exportar JSON
                      </button>
                      <button
                        onClick={handleClearAllQuestions}
                        className="text-xs font-bold text-red-400 hover:text-red-300 bg-red-950/40 border border-red-900/50 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Limpar Todas
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4 max-h-[440px] overflow-y-auto pr-2 custom-scrollbar">
                    {questions.map((q, i) => (
                      <div key={q.id || i} className="bg-neutral-900/90 p-4 rounded-2xl border border-neutral-750 space-y-3 relative group">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black bg-neutral-800 px-2.5 py-1 rounded-md text-indigo-400 font-mono">
                              Q{i + 1}
                            </span>
                            <span className={cn(
                              "text-xs font-bold px-2.5 py-0.5 rounded-full",
                              q.type === 'fill_blank'
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                : "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                            )}>
                              {q.type === 'fill_blank' ? 'Preenchimento de Lacuna' : 'Resposta Curta'}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-400 font-mono">{q.timeLimit}s</span>
                            {q.id && (
                              <button
                                onClick={() => handleDeleteQuestion(q.id!)}
                                className="text-neutral-500 hover:text-red-400 transition-colors p-1"
                                title="Excluir questão"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        <p className="font-bold text-neutral-100 text-base">{q.prompt}</p>

                        <div className="bg-neutral-800/80 p-3 rounded-xl border border-neutral-700/60 text-xs space-y-2">
                          <div>
                            <span className="font-bold text-neutral-400 block mb-0.5 uppercase tracking-wider text-[10px]">Resposta-Modelo Oficial:</span>
                            <p className="text-neutral-200 font-medium">{q.reference_answer}</p>
                          </div>

                          {q.canonical_answers && q.canonical_answers.length > 0 && (
                            <div>
                              <span className="font-bold text-neutral-400 block mb-1 uppercase tracking-wider text-[10px]">Respostas Canônicas (Match 100%):</span>
                              <div className="flex flex-wrap gap-1.5">
                                {q.canonical_answers.map((ca, cIdx) => (
                                  <span key={cIdx} className="bg-neutral-900 border border-neutral-700 text-green-300 font-mono text-[11px] px-2 py-0.5 rounded-md">
                                    "{ca}"
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {q.required_keywords && q.required_keywords.length > 0 && (
                            <div>
                              <span className="font-bold text-neutral-400 block mb-1 uppercase tracking-wider text-[10px]">Palavras-Chave Obrigatórias:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {q.required_keywords.map((kw, kIdx) => (
                                  <span key={kIdx} className="bg-neutral-900 border border-red-900/50 text-red-300 font-mono text-[11px] px-2 py-0.5 rounded-md">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1 border-t border-neutral-700/50 text-[11px] text-neutral-400">
                            <span>Limiares: Pleno ≥ {Math.round((q.thresholds?.full ?? 0.82) * 100)}% | Parcial ≥ {Math.round((q.thresholds?.partial ?? 0.65) * 100)}%</span>
                            <span className="text-indigo-400 font-mono">Embedding Local: 384-d ✓</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Connected Players & Launch Button */}
            <div className="bg-neutral-800/90 p-6 rounded-3xl border border-neutral-700 shadow-xl flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-400" />
                  Participantes ({players.length})
                </h2>
              </div>

              {/* Host Participation Toggle */}
              <div className="bg-neutral-900/90 border border-neutral-700 p-3.5 rounded-2xl mb-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gamepad2 className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-neutral-200">Jogar também nesta sessão</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleHostParticipation(!hostPlays)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[11px] font-black transition-all cursor-pointer",
                      hostPlays 
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        : "bg-neutral-800 text-neutral-400 hover:text-neutral-200 border border-neutral-700"
                    )}
                  >
                    {hostPlays ? "✓ Ativado (Host joga)" : "Desativado"}
                  </button>
                </div>

                {hostPlays && (
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-neutral-400 mb-1">
                      Seu Nome no Placar:
                    </label>
                    <input
                      type="text"
                      value={hostNickname}
                      onChange={(e) => {
                        const val = e.target.value;
                        setHostNickname(val);
                        toggleHostParticipation(true, val);
                      }}
                      placeholder="Nome no ranking"
                      className="w-full bg-neutral-950 border border-neutral-700 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-white font-semibold outline-none"
                      maxLength={30}
                    />
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 mb-6 max-h-[340px] custom-scrollbar">
                {players.length === 0 ? (
                  <div className="text-center py-10 text-neutral-500 space-y-2">
                    <p className="text-sm font-medium">Aguardando participantes...</p>
                    <p className="text-xs">Peça para os alunos abrirem o link e informarem o PIN:</p>
                    <p className="text-2xl font-black font-mono text-indigo-400 tracking-widest">{gameId}</p>
                  </div>
                ) : (
                  players.map((p, idx) => {
                    const isHost = p.id === auth.currentUser?.uid;
                    return (
                      <div
                        key={p.id || idx}
                        className={cn(
                          "px-4 py-3 rounded-xl font-semibold flex justify-between items-center border transition-all",
                          isHost
                            ? "bg-indigo-950/60 border-indigo-500/50 shadow-sm"
                            : "bg-neutral-750 border-neutral-700"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-2 h-2 rounded-full animate-pulse",
                            isHost ? "bg-indigo-400" : "bg-emerald-400"
                          )}></div>
                          <span className={cn(isHost ? "text-indigo-200 font-bold" : "text-neutral-100")}>
                            {p.name}
                          </span>
                          {isHost && (
                            <span className="text-[10px] bg-indigo-600 text-white font-black px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Você (Host)
                            </span>
                          )}
                        </div>
                        <span className="text-indigo-400 font-mono font-bold text-sm">{p.score} pts</span>
                      </div>
                    );
                  })
                )}
              </div>

              <button
                onClick={startGame}
                disabled={questions.length === 0 || players.length === 0}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-black text-lg py-4 rounded-2xl transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                <Play className="w-6 h-6" />
                INICIAR PROVA DISSERTATIVA
              </button>
              {questions.length === 0 && (
                <p className="text-center text-xs text-neutral-400 mt-2">
                  Importe ou cadastre questões para liberar o botão de início.
                </p>
              )}
            </div>
          </div>
        )}

        {/* QUESTION VIEW (Teacher & Host Screen) */}
        {gameState.status === 'question' && currentQ && (
          <div className="flex-1 flex flex-col justify-between py-4 max-w-5xl mx-auto w-full space-y-6">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 bg-neutral-800 px-4 py-1.5 rounded-full border border-neutral-700">
                <span className="text-xs font-black text-indigo-400 uppercase tracking-widest">
                  Questão {gameState.currentQuestionIndex + 1} de {questions.length}
                </span>
                <span className="text-neutral-600">•</span>
                <span className="text-xs font-bold text-neutral-300">
                  {currentQ.type === 'fill_blank' ? 'Preenchimento de Lacuna' : 'Resposta Dissertativa Curta'}
                </span>
              </div>

              <h2 className="text-2xl md:text-4xl font-black text-neutral-50 leading-tight">
                {currentQ.prompt}
              </h2>
            </div>

            {/* Grid: Timer on Left, Host Answer Box on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {/* Timer & Controls */}
              <div className="bg-neutral-800/90 p-6 rounded-3xl border border-neutral-700 flex flex-col items-center justify-between text-center space-y-4 shadow-xl">
                <div className="space-y-3 flex flex-col items-center">
                  <div className="w-32 h-32 rounded-full border-8 border-neutral-800 flex items-center justify-center relative shadow-2xl bg-neutral-950">
                    <span className={cn(
                      "text-5xl font-black font-mono",
                      timeLeft <= 10 ? "text-red-400 animate-pulse" : "text-indigo-400"
                    )}>
                      {timeLeft}
                    </span>
                  </div>

                  <div className="bg-neutral-900 px-3.5 py-1.5 rounded-xl border border-neutral-750 flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></div>
                    <span className="font-bold text-neutral-200">
                      {players.filter(p => p.currentAnswer !== null && p.currentAnswer !== undefined && p.currentAnswer !== '').length} / {players.length} já responderam
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={forceRevealAnswer}
                  className="w-full bg-neutral-750 hover:bg-neutral-700 text-neutral-200 hover:text-white font-bold text-xs py-2.5 rounded-xl transition-all border border-neutral-600 flex items-center justify-center gap-1.5 cursor-pointer shadow"
                >
                  <FastForward className="w-4 h-4 text-amber-400" />
                  Encerrar Tempo Agora
                </button>
              </div>

              {/* Host Player Interactive Area */}
              <div className="lg:col-span-2 bg-neutral-800/90 p-6 rounded-3xl border border-neutral-700 shadow-xl space-y-4 flex flex-col justify-between">
                {hostPlays ? (
                  <>
                    <div className="flex items-center justify-between border-b border-neutral-700 pb-3">
                      <div className="flex items-center gap-2">
                        <Gamepad2 className="w-5 h-5 text-indigo-400" />
                        <h3 className="font-bold text-base text-neutral-100">
                          Sua Resposta como Host ({hostNickname})
                        </h3>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider font-bold bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-800">
                        Jogando ao Vivo
                      </span>
                    </div>

                    {hostPlayer?.currentAnswer ? (
                      <div className="bg-neutral-900 p-5 rounded-2xl border border-emerald-500/30 text-center space-y-2.5 my-auto">
                        <div className="w-12 h-12 bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center mx-auto text-emerald-400">
                          <CheckCircle2 className="w-7 h-7" />
                        </div>
                        <p className="font-bold text-base text-neutral-100">Sua resposta foi enviada com sucesso!</p>
                        <p className="text-sm text-neutral-200 italic bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-left">
                          "{hostPlayer.currentAnswer}"
                        </p>
                        <p className="text-xs text-neutral-500">
                          Aguardando os demais participantes ou encerramento do tempo para ver o gabarito.
                        </p>
                      </div>
                    ) : (
                      <form onSubmit={handleSubmitHostAnswer} className="space-y-4 flex-1 flex flex-col justify-between">
                        {currentQ.type === 'fill_blank' ? (
                          <div className="space-y-1">
                            <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400">
                              Complete o termo da lacuna:
                            </label>
                            <input
                              type="text"
                              value={hostAnswerText}
                              onChange={(e) => setHostAnswerText(e.target.value)}
                              placeholder="Digite a palavra ou termo que preenche a lacuna..."
                              disabled={isSubmittingHost}
                              className="w-full bg-neutral-900 border-2 border-neutral-700 focus:border-indigo-500 rounded-xl p-3.5 text-sm font-semibold text-white placeholder-neutral-500 outline-none transition-colors"
                            />
                          </div>
                        ) : (
                          <div className="space-y-1 flex-1 flex flex-col">
                            <div className="flex justify-between items-center mb-1">
                              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400">
                                Sua Resposta Dissertativa:
                              </label>
                              <span className="text-[11px] text-neutral-500 font-mono">
                                {hostAnswerText.trim().split(/\s+/).filter(Boolean).length} palavras
                              </span>
                            </div>
                            <textarea
                              value={hostAnswerText}
                              onChange={(e) => setHostAnswerText(e.target.value)}
                              placeholder="Escreva sua resposta conceitual com suas próprias palavras..."
                              rows={4}
                              disabled={isSubmittingHost}
                              className="w-full flex-1 bg-neutral-900 border-2 border-neutral-700 focus:border-indigo-500 rounded-xl p-3.5 text-sm text-white placeholder-neutral-500 outline-none transition-colors leading-relaxed"
                            />
                          </div>
                        )}

                        <button
                          type="submit"
                          disabled={isSubmittingHost || !hostAnswerText.trim()}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-750 disabled:text-neutral-500 text-white font-black text-sm py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                        >
                          {isSubmittingHost ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Avaliando semântica com embeddings locais...</span>
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4" />
                              ENVIAR MINHA RESPOSTA (HOST)
                            </>
                          )}
                        </button>
                      </form>
                    )}
                  </>
                ) : (
                  <div className="text-center py-10 space-y-3 my-auto">
                    <p className="text-neutral-300 font-bold text-sm">Modo Apenas Observador</p>
                    <p className="text-xs text-neutral-500 max-w-md mx-auto">
                      Você optou por não participar como jogador nesta questão. Os participantes estão respondendo individualmente.
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleHostParticipation(true)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 shadow"
                    >
                      <Gamepad2 className="w-4 h-4" />
                      Entrar para Jogar Também
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-neutral-800/60 p-3.5 rounded-2xl border border-neutral-700/60 text-center text-xs text-neutral-400">
              Correção automática determinística + embeddings de sentenças rodando localmente no navegador.
            </div>
          </div>
        )}

        {/* ANSWER REVEAL VIEW */}
        {gameState.status === 'answer_reveal' && currentQ && (
          <div className="flex-1 flex flex-col space-y-6 max-w-5xl mx-auto w-full py-4">
            <div className="text-center space-y-2">
              <span className="text-xs font-bold uppercase tracking-widest text-indigo-400 bg-indigo-950/80 px-3 py-1 rounded-full border border-indigo-800">
                Gabarito & Avaliação da Questão {gameState.currentQuestionIndex + 1}
              </span>
              <h2 className="text-2xl md:text-3xl font-black">{currentQ.prompt}</h2>
            </div>

            {/* Model Reference Answer Banner */}
            <div className="bg-neutral-800/90 p-6 rounded-3xl border border-neutral-700 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-700/80 pb-3">
                <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  Resposta-Modelo Oficial do Professor
                </h3>
                <span className="text-xs font-mono text-neutral-400">Embedding: all-MiniLM-L6-v2</span>
              </div>

              <p className="text-lg font-semibold text-neutral-100 bg-neutral-900 p-4 rounded-xl border border-neutral-800">
                "{currentQ.reference_answer}"
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
                {currentQ.canonical_answers && currentQ.canonical_answers.length > 0 && (
                  <div className="bg-neutral-900/70 p-3 rounded-xl border border-neutral-800">
                    <span className="font-bold text-neutral-400 block mb-1 uppercase tracking-wider text-[10px]">Correspondências Exatas (Match 100%):</span>
                    <div className="flex flex-wrap gap-1.5">
                      {currentQ.canonical_answers.map((ca, idx) => (
                        <span key={idx} className="bg-neutral-800 px-2 py-0.5 rounded text-emerald-300 font-mono">
                          {ca}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {currentQ.required_keywords && currentQ.required_keywords.length > 0 && (
                  <div className="bg-neutral-900/70 p-3 rounded-xl border border-neutral-800">
                    <span className="font-bold text-neutral-400 block mb-1 uppercase tracking-wider text-[10px]">Palavras-Chave Obrigatórias:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {currentQ.required_keywords.map((kw, idx) => (
                        <span key={idx} className="bg-neutral-800 px-2 py-0.5 rounded text-red-300 font-mono">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Host's Own Result Card if Host Played */}
            {hostPlays && (
              <div className="bg-neutral-800/90 p-5 rounded-3xl border border-indigo-500/50 shadow-xl space-y-3">
                <div className="flex items-center justify-between border-b border-neutral-700/80 pb-2">
                  <div className="flex items-center gap-2">
                    <Gamepad2 className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-sm font-bold text-indigo-200">
                      Seu Resultado como Host ({hostNickname})
                    </h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    +{hostPlayer?.currentAnswer ? (hostPlayer?.lastScoreAdded || 0) : 0} pts nesta questão
                  </span>
                </div>

                {hostPlayer?.currentAnswer ? (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-neutral-900 p-4 rounded-xl border border-neutral-750">
                    <div className="space-y-1 max-w-xl">
                      <span className="text-[10px] uppercase font-bold text-neutral-400 block">Sua Resposta:</span>
                      <p className="text-sm text-neutral-200 italic">"{hostPlayer.currentAnswer}"</p>
                      {hostPlayer.lastGradingResult?.details?.reason && (
                        <p className="text-xs text-neutral-400">{hostPlayer.lastGradingResult.details.reason}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-2xl font-black font-mono text-emerald-400">
                        {Math.round((hostPlayer.lastGradingResult?.score || 0) * 100)}%
                      </span>
                      <span className="text-[10px] block uppercase font-bold text-neutral-400">
                        {hostPlayer.lastGradingResult?.mode === 'exact' ? 'Exato' :
                         hostPlayer.lastGradingResult?.mode === 'lexical' ? 'Léxico' :
                         hostPlayer.lastGradingResult?.mode === 'semantic' ? 'Semântico' : 'Incorreto'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-neutral-900 p-4 rounded-xl border border-neutral-750 text-neutral-400 text-xs">
                    Você não enviou resposta nesta questão dentro do tempo limite (+0 pts).
                  </div>
                )}
              </div>
            )}

            {/* Live Student Responses Grading Table */}
            <div className="bg-neutral-800/90 p-6 rounded-3xl border border-neutral-700 shadow-xl space-y-4">
              <h3 className="text-base font-bold text-neutral-200 flex items-center justify-between">
                <span>Respostas dos Participantes & Correção Automática</span>
                <span className="text-xs font-normal text-neutral-400">{players.length} avaliações</span>
              </h3>

              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
                {players.map((p) => {
                  const isHost = p.id === auth.currentUser?.uid;
                  const hasAnswered = Boolean(p.currentAnswer && p.currentAnswer.trim().length > 0);
                  const res = hasAnswered ? p.lastGradingResult : null;
                  const scorePct = hasAnswered && res ? Math.round(res.score * 100) : 0;
                  const mode = hasAnswered && res ? res.mode : 'none';
                  const pointsAdded = hasAnswered ? (p.lastScoreAdded || 0) : 0;
                  const reasonText = hasAnswered
                    ? (res?.details?.reason || '')
                    : 'Tempo esgotado - Sem resposta enviada';

                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 transition-all",
                        isHost ? "bg-indigo-950/40 border-indigo-500/50" : "bg-neutral-900 border-neutral-750"
                      )}
                    >
                      <div className="space-y-1 max-w-xl">
                        <div className="flex items-center gap-2">
                          <span className={cn("font-bold text-sm", isHost ? "text-indigo-200" : "text-neutral-200")}>
                            {p.name}
                          </span>
                          {isHost && (
                            <span className="text-[10px] bg-indigo-600 text-white font-black px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Host (Você)
                            </span>
                          )}
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                            !hasAnswered ? "bg-neutral-800 text-neutral-400 border border-neutral-700" :
                            mode === 'exact' ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                            mode === 'lexical' ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" :
                            mode === 'semantic' ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" :
                            "bg-red-500/20 text-red-300 border border-red-500/30"
                          )}>
                            {!hasAnswered ? 'Sem Resposta' :
                             mode === 'exact' ? 'Exato' :
                             mode === 'lexical' ? 'Léxico' :
                             mode === 'semantic' ? 'Semântico' : 'Incorreto'}
                          </span>
                        </div>
                        <p className="text-neutral-300 text-sm italic">
                          {hasAnswered ? `"${p.currentAnswer}"` : <span className="text-neutral-500">Sem resposta enviada</span>}
                        </p>
                        {reasonText && (
                          <p className="text-xs text-neutral-400">{reasonText}</p>
                        )}
                      </div>

                      <div className="text-right shrink-0 flex items-center md:flex-col gap-2 md:gap-1">
                        <span className={cn(
                          "text-xl font-black font-mono",
                          !hasAnswered ? "text-neutral-500" :
                          scorePct >= 80 ? "text-emerald-400" :
                          scorePct >= 50 ? "text-amber-400" : "text-red-400"
                        )}>
                          {scorePct}%
                        </span>
                        <span className="text-xs text-neutral-400 font-mono">+{pointsAdded} pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-center pt-2">
              <button
                onClick={() => updateDoc(doc(db, 'games', gameId!), { status: 'leaderboard' })}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-lg px-10 py-4 rounded-full transition-all flex items-center gap-2 shadow-xl shadow-indigo-600/20 cursor-pointer"
              >
                Ver Classificação <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* LEADERBOARD VIEW */}
        {gameState.status === 'leaderboard' && currentQ && (
          <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full py-4">
            <div className="flex items-center gap-3 mb-6">
              <Trophy className="w-10 h-10 text-amber-400" />
              <h2 className="text-3xl font-black">Quadro de Líderes</h2>
            </div>

            <div className="w-full space-y-2.5 mb-8 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
              {players.map((p, i) => {
                const isHost = p.id === auth.currentUser?.uid;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "p-4 rounded-2xl flex items-center justify-between border transition-all",
                      isHost
                        ? "bg-indigo-950/70 border-indigo-500/60 shadow-md ring-1 ring-indigo-500/30"
                        : "bg-neutral-800/90 border-neutral-700"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <span className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shrink-0",
                        i === 0 ? "bg-amber-400 text-neutral-950" :
                        i === 1 ? "bg-neutral-300 text-neutral-950" :
                        i === 2 ? "bg-amber-600 text-white" : "bg-neutral-700 text-neutral-400"
                      )}>
                        {i + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-lg font-bold", isHost ? "text-indigo-200 font-black" : "text-neutral-100")}>
                            {p.name}
                          </span>
                          {isHost && (
                            <span className="text-[10px] bg-indigo-600 text-white font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                              Você (Host)
                            </span>
                          )}
                        </div>
                        {p.lastScoreAdded !== undefined && p.lastScoreAdded > 0 && (
                          <span className="text-xs text-emerald-400 font-mono font-medium">
                            +{p.lastScoreAdded} pts nesta rodada
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xl font-black text-indigo-400 font-mono">{p.score} pts</span>
                  </div>
                );
              })}
            </div>

            <button
              onClick={nextQuestion}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-lg px-12 py-4 rounded-full transition-all flex items-center gap-2 shadow-xl shadow-indigo-600/20 cursor-pointer"
            >
              {gameState.currentQuestionIndex + 1 >= questions.length ? 'Pódio Final' : 'Próxima Questão'}
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* PODIUM VIEW */}
        {gameState.status === 'podium' && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <h2 className="text-4xl md:text-5xl font-black mb-12 flex items-center gap-3 text-amber-400">
              <Trophy className="w-12 h-12" />
              Pódio dos Melhores Desempenhos
              <Trophy className="w-12 h-12" />
            </h2>

            <div className="flex items-end justify-center gap-4 sm:gap-8 mb-16 h-64">
              {players[1] && (
                <div className="flex flex-col items-center animate-in slide-in-from-bottom-16 duration-700 delay-300 fill-mode-both">
                  <span className="text-xl font-bold mb-2 text-neutral-300">{players[1].name}</span>
                  <span className="text-sm font-medium text-indigo-300 mb-4 font-mono">{players[1].score} pts</span>
                  <div className="w-24 sm:w-32 h-40 bg-neutral-300/20 rounded-t-2xl border-t-4 border-neutral-300 flex items-start justify-center pt-4">
                    <span className="text-4xl font-black text-neutral-300">2</span>
                  </div>
                </div>
              )}

              {players[0] && (
                <div className="flex flex-col items-center animate-in slide-in-from-bottom-16 duration-700 delay-700 fill-mode-both">
                  <span className="text-2xl font-black mb-2 text-amber-400">{players[0].name}</span>
                  <span className="text-base font-bold text-amber-200 mb-4 font-mono">{players[0].score} pts</span>
                  <div className="w-28 sm:w-40 h-56 bg-amber-400/20 rounded-t-2xl border-t-4 border-amber-400 flex items-start justify-center pt-4">
                    <span className="text-6xl font-black text-amber-400">1</span>
                  </div>
                </div>
              )}

              {players[2] && (
                <div className="flex flex-col items-center animate-in slide-in-from-bottom-16 duration-700 delay-100 fill-mode-both">
                  <span className="text-lg font-bold mb-2 text-amber-600">{players[2].name}</span>
                  <span className="text-sm font-medium text-amber-400 mb-4 font-mono">{players[2].score} pts</span>
                  <div className="w-24 sm:w-32 h-32 bg-amber-600/20 rounded-t-2xl border-t-4 border-amber-600 flex items-start justify-center pt-4">
                    <span className="text-3xl font-black text-amber-600">3</span>
                  </div>
                </div>
              )}
            </div>

            {/* Complete Final Ranking Table on Podium Screen */}
            <div className="w-full max-w-xl bg-neutral-800/90 p-5 rounded-3xl border border-neutral-700 shadow-xl space-y-3 mb-8">
              <h3 className="text-sm font-bold text-neutral-200 flex items-center justify-between border-b border-neutral-700 pb-2">
                <span>Classificação Geral da Sessão</span>
                <span className="text-xs text-neutral-400 font-mono">{players.length} participantes</span>
              </h3>

              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                {players.map((p, idx) => {
                  const isHost = p.id === auth.currentUser?.uid;
                  return (
                    <div
                      key={p.id || idx}
                      className={cn(
                        "p-3 rounded-xl flex items-center justify-between border text-sm transition-all",
                        isHost ? "bg-indigo-950/60 border-indigo-500/60 font-bold" : "bg-neutral-900 border-neutral-750"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-neutral-400 w-6">#{idx + 1}</span>
                        <span className={isHost ? "text-indigo-200 font-black" : "text-neutral-200"}>
                          {p.name} {isHost && '(Você - Host)'}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-neutral-100">{p.score} pts</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => updateDoc(doc(db, 'games', gameId!), { status: 'ended' })}
              className="bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-base px-8 py-3.5 rounded-full transition-all border border-neutral-700 cursor-pointer"
            >
              Voltar ao Lobby da Sessão
            </button>
          </div>
        )}

      </main>

      {/* Manual Question Modal */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-3xl w-full max-w-xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-neutral-800">
              <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-indigo-400" />
                Cadastrar Questão Manualmente
              </h2>
              <button onClick={() => setShowManualModal(false)} className="text-neutral-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateManualQuestion} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-neutral-400 mb-1">Tipo de Questão</label>
                  <select
                    value={manualType}
                    onChange={e => setManualType(e.target.value as QuestionType)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none"
                  >
                    <option value="short_answer">Resposta Curta (Dissertativa)</option>
                    <option value="fill_blank">Preenchimento de Lacuna</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-400 mb-1">Tempo Limite (segundos)</label>
                  <input
                    type="number"
                    value={manualTimeLimit}
                    onChange={e => setManualTimeLimit(Number(e.target.value))}
                    min={15}
                    max={180}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-400 mb-1">Enunciado da Questão</label>
                <textarea
                  value={manualPrompt}
                  onChange={e => setManualPrompt(e.target.value)}
                  placeholder={manualType === 'fill_blank' ? "Ex: O processo pelo qual vegetais convertem luz em glicose é denominado _____." : "Ex: Explique sucintamente a função do DNA nas células vivas."}
                  rows={2}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-400 mb-1">
                  Resposta-Modelo Oficial (Gabarito Ouro)
                </label>
                <textarea
                  value={manualRefAnswer}
                  onChange={e => setManualRefAnswer(e.target.value)}
                  placeholder="Ex: Armazena as instruções genéticas responsáveis pelo desenvolvimento, funcionamento e reprodução celular."
                  rows={2}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none"
                  required
                />
                <p className="text-[11px] text-neutral-500 mt-1">O embedding local (all-MiniLM-L6-v2) será calculado automaticamente para esta resposta.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-400 mb-1">
                  Respostas Canônicas Exatas (1 por linha)
                </label>
                <textarea
                  value={manualCanonicals}
                  onChange={e => setManualCanonicals(e.target.value)}
                  placeholder="dna&#10;acido desoxirribonucleico&#10;ácido desoxirribonucléico"
                  rows={2}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-400 mb-1">
                  Palavras-Chave Obrigatórias (separadas por vírgula)
                </label>
                <input
                  type="text"
                  value={manualKeywords}
                  onChange={e => setManualKeywords(e.target.value)}
                  placeholder="genéticas, celular, instruções"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2.5 text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-neutral-400 mb-1">Threshold Pleno (100%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.5"
                    max="1.0"
                    value={manualFullThresh}
                    onChange={e => setManualFullThresh(Number(e.target.value))}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2 text-white outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-400 mb-1">Threshold Parcial (50-80%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.3"
                    max="0.9"
                    value={manualPartialThresh}
                    onChange={e => setManualPartialThresh(Number(e.target.value))}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl p-2 text-white outline-none font-mono"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingManual}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-700 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {savingManual ? 'Calculando embedding e salvando...' : 'Salvar Questão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
