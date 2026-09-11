import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, Play, Users, LogIn, BookOpen, Upload, Sparkles, ArrowRight } from 'lucide-react';
import { auth, signInWithGoogle } from '../firebase';
import { getSavedQuizzes, SavedQuiz } from '../lib/quizStorage';

export default function Home() {
  const navigate = useNavigate();
  const [gamePin, setGamePin] = useState('');
  const [savedQuizzes, setSavedQuizzes] = useState<SavedQuiz[]>([]);

  useEffect(() => {
    setSavedQuizzes(getSavedQuizzes());
  }, []);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (gamePin.trim()) {
      navigate(`/play/${gamePin.trim()}`);
    }
  };

  const handleHost = async () => {
    if (!auth.currentUser) {
      await signInWithGoogle();
    }
    if (auth.currentUser) {
      navigate('/host');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4 sm:p-6 font-sans text-white">
      <div className="max-w-xl w-full space-y-8 my-auto py-8">
        {/* Header Branding */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto mb-2 shadow-lg shadow-indigo-600/10">
            <BrainCircuit className="w-9 h-9 text-indigo-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Treino Dissertativo
          </h1>
          <p className="text-neutral-400 text-sm max-w-md mx-auto leading-relaxed">
            Plataforma para questões discursivas de resposta curta e lacunas com avaliação semântica local e determinística por IA.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold bg-neutral-800 text-indigo-300 px-2.5 py-0.5 rounded-full border border-neutral-700">
              all-MiniLM-L6-v2 Local
            </span>
            <span className="text-[11px] font-bold bg-neutral-800 text-emerald-300 px-2.5 py-0.5 rounded-full border border-neutral-700">
              Modo Solo & Coletivo
            </span>
            <span className="text-[11px] font-bold bg-neutral-800 text-neutral-300 px-2.5 py-0.5 rounded-full border border-neutral-700">
              Exportação JSON
            </span>
          </div>
        </div>

        {/* Action Cards Container */}
        <div className="space-y-4">
          {/* Card 1: Live Classroom Session PIN */}
          <div className="bg-neutral-800/90 p-6 sm:p-7 rounded-3xl shadow-xl border border-neutral-700 space-y-4">
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
              <Play className="w-4 h-4 fill-current" />
              <span>Sessão Ao Vivo (Sala com Professor)</span>
            </div>

            <form onSubmit={handleJoin} className="space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="DIGITE O PIN (EX: 8KQ2A)"
                  value={gamePin}
                  onChange={(e) => setGamePin(e.target.value.toUpperCase())}
                  className="w-full text-center text-xl sm:text-2xl font-bold font-mono tracking-widest bg-neutral-900 border-2 border-neutral-700 rounded-xl py-3.5 focus:outline-none focus:border-indigo-500 transition-colors uppercase text-indigo-300 placeholder-neutral-600"
                />
              </div>
              <button
                type="submit"
                disabled={!gamePin.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-black py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-600/20"
              >
                <Play className="w-4 h-4" />
                <span>Entrar na Sala da Turma</span>
              </button>
            </form>
          </div>

          {/* Card 2: Solo Practice & Import Quizzes (NEW & FEATURED) */}
          <div className="bg-gradient-to-br from-indigo-950/40 via-neutral-800/90 to-neutral-800/90 p-6 sm:p-7 rounded-3xl shadow-xl border border-indigo-500/30 space-y-4 relative overflow-hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>Treinar Sozinho (Modo Solo)</span>
                </div>
                <h2 className="text-lg font-bold text-white">
                  Pratique no seu ritmo com IA Local
                </h2>
                <p className="text-xs text-neutral-300 leading-relaxed max-w-sm">
                  Importe perguntas baixadas de uma aula anterior ou pratique com quizzes salvos no navegador sem precisar de login.
                </p>
              </div>

              {savedQuizzes.length > 0 && (
                <span className="text-[11px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2.5 py-1 rounded-full shrink-0">
                  {savedQuizzes.length} {savedQuizzes.length === 1 ? 'quiz salvo' : 'quizzes salvos'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                onClick={() => navigate('/solo')}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                <span>Abrir Modo Solo</span>
              </button>

              <button
                onClick={() => navigate('/solo')}
                className="bg-neutral-700/80 hover:bg-neutral-700 text-neutral-200 font-bold text-xs py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 border border-neutral-600/80 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-indigo-300" />
                <span>Importar Arquivo (.json)</span>
              </button>
            </div>
          </div>

          {/* Card 3: Host / Teacher Panel */}
          <div className="bg-neutral-800/70 p-5 rounded-3xl border border-neutral-700/80 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-neutral-300 flex items-center gap-2">
                <Users className="w-4 h-4 text-neutral-400" />
                Área do Professor / Host
              </span>
              <p className="text-[11px] text-neutral-500">
                Gere questões com IA e comande uma sala ao vivo com ranking interativo.
              </p>
            </div>

            <button
              onClick={handleHost}
              className="bg-neutral-700 hover:bg-neutral-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer border border-neutral-600/60"
            >
              {auth.currentUser ? (
                <>
                  <span>Painel do Host</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Login Host</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
