import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, Play, Users, LogIn } from 'lucide-react';
import { auth, signInWithGoogle } from '../firebase';

export default function Home() {
  const navigate = useNavigate();
  const [gamePin, setGamePin] = useState('');

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
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-4 font-sans text-white">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mx-auto mb-2">
            <BrainCircuit className="w-9 h-9 text-indigo-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">Treino Dissertativo</h1>
          <p className="text-neutral-400 text-sm max-w-sm mx-auto">
            Simulador de questões de resposta curta e lacunas com correção semântica local e determinística.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold bg-neutral-800 text-indigo-300 px-2.5 py-0.5 rounded-full border border-neutral-700">
              all-MiniLM-L6-v2
            </span>
            <span className="text-[11px] font-bold bg-neutral-800 text-emerald-300 px-2.5 py-0.5 rounded-full border border-neutral-700">
              Matching Exato + Dice
            </span>
            <span className="text-[11px] font-bold bg-neutral-800 text-neutral-300 px-2.5 py-0.5 rounded-full border border-neutral-700">
              Sem Custo de API
            </span>
          </div>
        </div>

        <div className="bg-neutral-800/90 p-8 rounded-3xl shadow-2xl border border-neutral-700 space-y-6">
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2 text-center">
                PIN da Sessão
              </label>
              <input
                type="text"
                placeholder="Ex: 8KQ2A"
                value={gamePin}
                onChange={(e) => setGamePin(e.target.value.toUpperCase())}
                className="w-full text-center text-2xl font-bold font-mono tracking-widest bg-neutral-900 border-2 border-neutral-700 rounded-xl py-4 focus:outline-none focus:border-indigo-500 transition-colors uppercase text-indigo-300"
              />
            </div>
            <button
              type="submit"
              disabled={!gamePin.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-black py-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play className="w-5 h-5" />
              Entrar na Sessão (Aluno)
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-700"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 bg-neutral-800 text-neutral-400 font-bold uppercase tracking-wider">OU</span>
            </div>
          </div>

          <button
            onClick={handleHost}
            className="w-full bg-neutral-700/80 hover:bg-neutral-700 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 border border-neutral-600/60 cursor-pointer"
          >
            {auth.currentUser ? (
              <>
                <Users className="w-5 h-5 text-indigo-400" />
                Abrir Painel do Professor (Host)
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5 text-indigo-400" />
                Login para Criar Sessão (Host)
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
