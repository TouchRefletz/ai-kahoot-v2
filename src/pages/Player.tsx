import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, setDoc, onSnapshot, updateDoc, collection, query, orderBy, getDoc } from 'firebase/firestore';
import { db, auth, signInAnon } from '../firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore';
import { gradeShortAnswerAsync } from '../lib/grading';
import { Question, PlayerData, GradingResult } from '../lib/types';
import {
  BrainCircuit, CheckCircle2, XCircle, Play, Trophy, Send,
  HelpCircle, Sparkles, Clock, AlertTriangle, FileCheck
} from 'lucide-react';
import { cn } from '../lib/utils';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'motion/react';

export default function Player() {
  const { gameId: urlGameId } = useParams();
  const navigate = useNavigate();

  const [gameId, setGameId] = useState(urlGameId || '');
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);

  const [gameState, setGameState] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [playerState, setPlayerState] = useState<PlayerData | null>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);

  // Answer input state
  const [studentText, setStudentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localGradingResult, setLocalGradingResult] = useState<GradingResult | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!joined || !gameId || !playerId) return;

    const unsubGame = onSnapshot(doc(db, 'games', gameId), (d) => {
      if (d.exists()) setGameState(d.data());
    }, (err) => handleFirestoreError(err, OperationType.GET, `games/${gameId}`));

    const unsubQuestions = onSnapshot(query(collection(db, `games/${gameId}/questions`), orderBy('index')), (snap) => {
      setQuestions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Question)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${gameId}/questions`));

    const unsubPlayer = onSnapshot(doc(db, `games/${gameId}/players`, playerId), (d) => {
      if (d.exists()) setPlayerState(d.data() as PlayerData);
    }, (err) => handleFirestoreError(err, OperationType.GET, `games/${gameId}/players/${playerId}`));

    const unsubPlayers = onSnapshot(collection(db, `games/${gameId}/players`), (snap) => {
      setPlayers(snap.docs.map(d => ({ id: d.id, ...d.data() } as PlayerData)).sort((a, b) => b.score - a.score));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `games/${gameId}/players`));

    return () => {
      unsubGame();
      unsubQuestions();
      unsubPlayer();
      unsubPlayers();
    };
  }, [joined, gameId, playerId]);

  // Reset input state when a new question arrives
  useEffect(() => {
    if (gameState?.status === 'question') {
      setStudentText('');
      setIsSubmitting(false);
      setLocalGradingResult(null);
    }
  }, [gameState?.currentQuestionIndex, gameState?.status]);

  // Trigger celebration on leaderboard if student scored well
  useEffect(() => {
    if (gameState?.status === 'leaderboard' && playerState?.lastAnswerCorrect) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
  }, [gameState?.status, playerState?.lastAnswerCorrect]);

  // Timer countdown
  useEffect(() => {
    if (gameState?.status === 'question' && gameState?.questionStartTime) {
      const currentQ = questions[gameState.currentQuestionIndex];
      const limit = currentQ?.timeLimit || 45;

      const interval = setInterval(() => {
        const start = new Date(gameState.questionStartTime).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - start) / 1000);
        const remaining = Math.max(0, limit - elapsed);
        setTimeLeft(remaining);
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setTimeLeft(null);
    }
  }, [gameState?.status, gameState?.questionStartTime, gameState?.currentQuestionIndex, questions]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      await signInAnon();
      if (!auth.currentUser) return;
    }

    if (!gameId.trim() || !name.trim()) return;

    try {
      const gameDoc = await getDoc(doc(db, 'games', gameId.toUpperCase()));
      if (!gameDoc.exists()) {
        alert('Sala de jogo não encontrada! Verifique o PIN digitado.');
        return;
      }

      const uid = auth.currentUser.uid;
      setPlayerId(uid);

      await setDoc(doc(db, `games/${gameId.toUpperCase()}/players`, uid), {
        uid,
        name: name.trim(),
        score: 0,
        currentAnswer: null,
        lastAnswerCorrect: null,
        lastScoreAdded: 0,
        lastGradingResult: null,
        joinedAt: new Date().toISOString()
      });

      setGameId(gameId.toUpperCase());
      setJoined(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `games/${gameId}/players`);
    }
  };

  const handleSubmitAnswer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting || gameState?.status !== 'question') return;

    const currentQ = questions[gameState.currentQuestionIndex];
    if (!currentQ) return;

    const trimmedAnswer = studentText.trim();
    if (!trimmedAnswer) {
      alert('Digite sua resposta antes de enviar.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Grade the short answer locally (exact match -> required keywords -> lexical similarity -> local all-MiniLM-L6-v2 cosine)
      const gradingResult = await gradeShortAnswerAsync(trimmedAnswer, currentQ);
      setLocalGradingResult(gradingResult);

      // 2. Compute points based on score (0.0 to 1.0) and response time
      const start = gameState.questionStartTime ? new Date(gameState.questionStartTime).getTime() : Date.now();
      const now = Date.now();
      const elapsed = Math.max(0, (now - start) / 1000);
      const timeRatio = Math.min(elapsed / (currentQ.timeLimit || 45), 1);
      
      // Time multiplier ranges from 0.70 to 1.00 so pedagogical quality is primary
      const timeMultiplier = Math.max(0.70, 1 - 0.30 * Math.pow(timeRatio, 2));
      const points = Math.round(gradingResult.score * 1000 * timeMultiplier);

      const isCorrect = gradingResult.score >= 0.5;

      // 3. Save to Firestore
      await updateDoc(doc(db, `games/${gameId}/players`, playerId!), {
        currentAnswer: trimmedAnswer,
        answeredAt: new Date().toISOString(),
        lastAnswerCorrect: isCorrect,
        lastScoreAdded: points,
        lastGradingResult: gradingResult,
        score: (playerState?.score || 0) + points
      });

    } catch (err) {
      console.error('Erro ao avaliar resposta:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!joined) {
    return (
      <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4 font-sans text-white">
        <div className="max-w-md w-full bg-neutral-800/95 p-8 rounded-3xl shadow-2xl border border-neutral-700 space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BrainCircuit className="w-9 h-9 text-indigo-400" />
            </div>
            <h1 className="text-2xl font-black tracking-tight">Treino Dissertativo</h1>
            <p className="text-sm text-neutral-400 mt-1">Correção instantânea de respostas curtas</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1.5 text-center">
                PIN da Sessão
              </label>
              <input
                type="text"
                placeholder="Ex: 8KQ2A"
                value={gameId}
                onChange={(e) => setGameId(e.target.value.toUpperCase())}
                className="w-full text-center text-3xl font-mono font-black tracking-widest bg-neutral-900 border-2 border-neutral-700 rounded-xl py-3.5 focus:outline-none focus:border-indigo-500 transition-colors uppercase text-indigo-300"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1.5 text-center">
                Seu Nome ou Apelido
              </label>
              <input
                type="text"
                placeholder="Digite seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-center text-lg font-bold bg-neutral-900 border-2 border-neutral-700 rounded-xl py-3.5 focus:outline-none focus:border-indigo-500 transition-colors"
                required
                maxLength={20}
              />
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black text-base py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <Play className="w-5 h-5" />
              ENTRAR NA SALA
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center text-white font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-neutral-400 font-medium text-sm">Carregando sala...</p>
        </div>
      </div>
    );
  }

  const status = gameState.status;
  const currentQ = questions[gameState.currentQuestionIndex];
  const hasAnswered = playerState?.currentAnswer !== null && playerState?.currentAnswer !== undefined && playerState?.currentAnswer !== '';
  const grading = playerState?.lastGradingResult || localGradingResult;

  return (
    <div className="min-h-screen bg-neutral-900 text-white font-sans flex flex-col">
      {/* Top Header */}
      <header className="bg-neutral-950 px-6 py-3.5 border-b border-neutral-800 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400"></div>
          <span className="font-bold text-neutral-200 text-sm">{name}</span>
        </div>
        <div className="bg-neutral-800/90 px-3.5 py-1 rounded-full font-mono font-bold text-indigo-400 text-sm border border-neutral-700">
          {playerState?.score || 0} pts
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 max-w-2xl mx-auto w-full">

        {/* LOBBY / GENERATING / ENDED */}
        {(status === 'lobby' || status === 'generating' || status === 'ended') && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-20 h-20 bg-neutral-800 rounded-3xl border border-neutral-700 flex items-center justify-center shadow-xl">
              <BrainCircuit className="w-10 h-10 text-indigo-400 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black">
                {status === 'generating' ? 'O professor está gerando as questões...' :
                 status === 'ended' ? 'Fim da rodada de treino!' :
                 'Você está conectado!'}
              </h2>
              <p className="text-neutral-400 text-sm max-w-xs mx-auto">
                {status === 'ended'
                  ? 'Aguarde o professor reiniciar ou iniciar uma nova rodada.'
                  : 'Fique atento à tela principal. A prova dissertativa começará em instantes.'}
              </p>
            </div>
          </div>
        )}

        {/* QUESTION VIEW: STUDENT ANSWERS SHORT ANSWER OR FILL IN BLANK */}
        {status === 'question' && currentQ && (
          <div className="flex-1 flex flex-col justify-between py-2">
            <div className="space-y-4">
              {/* Question Header */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="bg-neutral-800 border border-neutral-700 px-3 py-1 rounded-full text-xs font-black text-indigo-400">
                    Questão {gameState.currentQuestionIndex + 1}
                  </span>
                  <span className="text-xs text-neutral-400 font-semibold">
                    {currentQ.type === 'fill_blank' ? 'Preencha a lacuna' : 'Resposta Curta'}
                  </span>
                </div>
                {timeLeft !== null && (
                  <span className={cn(
                    "px-3 py-1 rounded-full text-xs font-mono font-bold flex items-center gap-1.5",
                    timeLeft <= 10 ? "bg-red-950/80 text-red-400 border border-red-800 animate-pulse" : "bg-neutral-800 text-neutral-300 border border-neutral-700"
                  )}>
                    <Clock className="w-3.5 h-3.5" />
                    {timeLeft}s
                  </span>
                )}
              </div>

              {/* Prompt Card */}
              <div className="bg-neutral-800/90 p-5 rounded-2xl border border-neutral-700 shadow-lg">
                {currentQ.type === 'fill_blank' ? (
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 block">Complete a lacuna:</span>
                    <p className="text-lg md:text-xl font-bold leading-relaxed text-neutral-100">
                      {currentQ.prompt}
                    </p>
                  </div>
                ) : (
                  <p className="text-lg md:text-xl font-bold leading-relaxed text-neutral-100">
                    {currentQ.prompt}
                  </p>
                )}
              </div>

              {/* Input Area */}
              {hasAnswered ? (
                <div className="bg-neutral-800/60 p-6 rounded-2xl border border-neutral-700/80 text-center space-y-3">
                  <div className="w-12 h-12 bg-emerald-500/20 border border-emerald-500/40 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-bold text-neutral-100">Resposta Enviada!</h3>
                  <p className="text-xs text-neutral-400 italic">"{playerState?.currentAnswer}"</p>
                  <p className="text-xs text-neutral-500">Aguardando encerramento do tempo para exibir a correção detalhada.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmitAnswer} className="space-y-3">
                  {currentQ.type === 'fill_blank' ? (
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1">
                        Termo ou Conceito da Lacuna
                      </label>
                      <input
                        type="text"
                        value={studentText}
                        onChange={e => setStudentText(e.target.value)}
                        placeholder="Digite o termo que preenche a lacuna..."
                        autoFocus
                        disabled={isSubmitting}
                        className="w-full bg-neutral-800 border-2 border-neutral-700 focus:border-indigo-500 rounded-xl p-4 text-base font-semibold text-white placeholder-neutral-500 outline-none transition-colors"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-xs font-bold uppercase tracking-wider text-neutral-400">
                          Sua Resposta Dissertativa
                        </label>
                        <span className="text-[11px] text-neutral-500 font-mono">
                          {studentText.trim().split(/\s+/).filter(Boolean).length} palavras
                        </span>
                      </div>
                      <textarea
                        value={studentText}
                        onChange={e => setStudentText(e.target.value)}
                        placeholder="Escreva de 1 a 3 frases explicando o conceito com suas próprias palavras..."
                        rows={4}
                        autoFocus
                        disabled={isSubmitting}
                        className="w-full bg-neutral-800 border-2 border-neutral-700 focus:border-indigo-500 rounded-xl p-4 text-sm text-white placeholder-neutral-500 outline-none transition-colors leading-relaxed"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || !studentText.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-black text-base py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Avaliando Semântica Local...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        ENVIAR RESPOSTA
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>

            <div className="text-center py-2 text-xs text-neutral-500">
              Avaliação via similaridade semântica (all-MiniLM-L6-v2) & regras determinísticas.
            </div>
          </div>
        )}

        {/* ANSWER REVEAL VIEW: DETAILED GRADING FEEDBACK */}
        {status === 'answer_reveal' && currentQ && (
          <div className="flex-1 flex flex-col space-y-4 py-2">
            <div className="text-center space-y-1">
              <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">
                Resultado da Questão {gameState.currentQuestionIndex + 1}
              </span>
              <h2 className="text-lg font-bold text-neutral-100">{currentQ.prompt}</h2>
            </div>

            {/* Score Banner */}
            <div className={cn(
              "p-5 rounded-2xl border text-center space-y-2 shadow-lg",
              (grading?.score || 0) >= 0.82
                ? "bg-emerald-950/60 border-emerald-700/80 text-emerald-300"
                : (grading?.score || 0) >= 0.50
                ? "bg-amber-950/60 border-amber-700/80 text-amber-300"
                : "bg-red-950/60 border-red-800/80 text-red-300"
            )}>
              <div className="flex items-center justify-center gap-2">
                {(grading?.score || 0) >= 0.82 ? (
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                ) : (grading?.score || 0) >= 0.50 ? (
                  <FileCheck className="w-7 h-7 text-amber-400" />
                ) : (
                  <XCircle className="w-7 h-7 text-red-400" />
                )}
                <span className="text-3xl font-black font-mono">
                  {Math.round((grading?.score || 0) * 100)}%
                </span>
              </div>

              <p className="font-bold text-sm">
                {(grading?.score || 0) >= 0.82 ? 'Resposta Plena / Correta!' :
                 (grading?.score || 0) >= 0.50 ? 'Resposta Parcialmente Correta' :
                 'Resposta Incorreta'}
              </p>

              <div className="inline-block bg-neutral-900/60 px-3 py-1 rounded-full text-xs font-bold">
                +{playerState?.lastScoreAdded || 0} pontos ganhos
              </div>
            </div>

            {/* What student answered */}
            <div className="bg-neutral-800/90 p-4 rounded-xl border border-neutral-700 text-xs space-y-1">
              <span className="font-bold text-neutral-400 uppercase tracking-wider text-[10px]">Sua Resposta:</span>
              <p className="text-neutral-200 text-sm italic">
                {playerState?.currentAnswer ? `"${playerState.currentAnswer}"` : <span className="text-neutral-500">Sem resposta enviada</span>}
              </p>
            </div>

            {/* Model Reference Answer */}
            <div className="bg-neutral-800/90 p-4 rounded-xl border border-neutral-700 text-xs space-y-1">
              <span className="font-bold text-emerald-400 uppercase tracking-wider text-[10px]">Resposta-Modelo do Professor:</span>
              <p className="text-neutral-100 font-medium text-sm">
                "{currentQ.reference_answer}"
              </p>
            </div>

            {/* Grading Diagnostics Breakdown */}
            {grading?.details && (
              <div className="bg-neutral-800/80 p-4 rounded-xl border border-neutral-700/80 space-y-2 text-xs">
                <span className="font-bold text-neutral-400 uppercase tracking-wider text-[10px] block">
                  Diagnóstico da Correção Automática:
                </span>

                <div className="flex items-center justify-between py-1 border-b border-neutral-700/60">
                  <span className="text-neutral-400">Modo de Avaliação:</span>
                  <span className="font-bold text-neutral-200 uppercase">
                    {grading.mode === 'exact' ? 'Correspondência Exata' :
                     grading.mode === 'lexical' ? 'Similaridade Léxica' :
                     grading.mode === 'semantic' ? 'Similaridade Semântica (all-MiniLM-L6-v2)' : 'Insuficiente'}
                  </span>
                </div>

                {grading.details.cosineSimilarity !== undefined && (
                  <div className="flex items-center justify-between py-1 border-b border-neutral-700/60">
                    <span className="text-neutral-400">Similaridade de Cosseno (Embeddings):</span>
                    <span className="font-mono font-bold text-indigo-300">
                      {(grading.details.cosineSimilarity * 100).toFixed(1)}%
                    </span>
                  </div>
                )}

                {grading.details.lexicalSimilarity !== undefined && (
                  <div className="flex items-center justify-between py-1 border-b border-neutral-700/60">
                    <span className="text-neutral-400">Similaridade Léxica (Dice):</span>
                    <span className="font-mono font-bold text-neutral-300">
                      {(grading.details.lexicalSimilarity * 100).toFixed(1)}%
                    </span>
                  </div>
                )}

                {/* Keywords feedback */}
                {grading.details.foundKeywords && grading.details.foundKeywords.length > 0 && (
                  <div className="pt-1">
                    <span className="text-neutral-400 block mb-1">Palavras-chave encontradas:</span>
                    <div className="flex flex-wrap gap-1">
                      {grading.details.foundKeywords.map((kw, i) => (
                        <span key={i} className="bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded text-[11px] font-mono border border-emerald-800">
                          ✓ {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {grading.details.missingKeywords && grading.details.missingKeywords.length > 0 && (
                  <div className="pt-1">
                    <span className="text-red-400 block mb-1">Palavras-chave ausentes:</span>
                    <div className="flex flex-wrap gap-1">
                      {grading.details.missingKeywords.map((kw, i) => (
                        <span key={i} className="bg-red-950 text-red-300 px-2 py-0.5 rounded text-[11px] font-mono border border-red-800">
                          ✗ {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {grading.details.reason && (
                  <p className="text-neutral-300 text-xs pt-1 border-t border-neutral-700/60 font-medium">
                    {grading.details.reason}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* LEADERBOARD VIEW */}
        {status === 'leaderboard' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center mx-auto shadow-2xl",
              playerState?.lastAnswerCorrect ? "bg-emerald-500/20 border-2 border-emerald-400" : "bg-red-500/20 border-2 border-red-400"
            )}>
              {playerState?.lastAnswerCorrect ? (
                <CheckCircle2 className="w-14 h-14 text-emerald-400" />
              ) : (
                <XCircle className="w-14 h-14 text-red-400" />
              )}
            </div>

            <div className="space-y-1">
              <h2 className="text-3xl font-black">
                {playerState?.lastAnswerCorrect ? 'Pontuação Registrada!' : 'Mais sorte na próxima!'}
              </h2>
              <p className="text-indigo-400 font-mono font-bold text-xl">
                +{playerState?.lastScoreAdded || 0} pts
              </p>
            </div>

            <div className="bg-neutral-800/80 px-6 py-3 rounded-2xl border border-neutral-700">
              <span className="text-xs text-neutral-400 block">Sua pontuação total</span>
              <span className="text-3xl font-black font-mono text-neutral-100">{playerState?.score || 0} pts</span>
            </div>

            <p className="text-xs text-neutral-500">Olhe para a tela principal para ver a próxima questão.</p>
          </div>
        )}

        {/* PODIUM VIEW */}
        {status === 'podium' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <Trophy className="w-24 h-24 text-amber-400 animate-bounce" />
            <h2 className="text-3xl font-black">Fim da Sessão de Treino!</h2>

            {players.findIndex(p => p.id === playerId) === 0 ? (
              <div className="bg-amber-400/20 border-2 border-amber-400 p-6 rounded-3xl">
                <p className="text-xl font-bold text-amber-300 mb-1">1º Lugar! Campeão 🥇</p>
                <p className="text-4xl font-black text-amber-400">{playerState?.score || 0} pts</p>
              </div>
            ) : players.findIndex(p => p.id === playerId) === 1 ? (
              <div className="bg-neutral-300/20 border-2 border-neutral-300 p-6 rounded-3xl">
                <p className="text-xl font-bold text-neutral-200 mb-1">2º Lugar! Prata 🥈</p>
                <p className="text-4xl font-black text-neutral-200">{playerState?.score || 0} pts</p>
              </div>
            ) : players.findIndex(p => p.id === playerId) === 2 ? (
              <div className="bg-amber-700/20 border-2 border-amber-600 p-6 rounded-3xl">
                <p className="text-xl font-bold text-amber-400 mb-1">3º Lugar! Bronze 🥉</p>
                <p className="text-4xl font-black text-amber-400">{playerState?.score || 0} pts</p>
              </div>
            ) : (
              <div className="bg-neutral-800 p-6 rounded-3xl border border-neutral-700">
                <p className="text-sm text-neutral-400 mb-1">Sua Classificação:</p>
                <p className="text-3xl font-black text-indigo-400">#{players.findIndex(p => p.id === playerId) + 1} de {players.length}</p>
                <p className="text-lg font-bold text-neutral-300 mt-2">{playerState?.score || 0} pts</p>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
