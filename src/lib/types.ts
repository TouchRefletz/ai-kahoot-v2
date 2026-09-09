export type QuestionType = 'short_answer' | 'fill_blank';

export interface QuestionThresholds {
  full: number;      // e.g. 0.82
  partial?: number;  // e.g. 0.65
}

export interface Question {
  id?: string;
  index: number;
  type: QuestionType;
  prompt: string;
  canonical_answers: string[];
  reference_answer: string;
  embedding_ref: number[];
  required_keywords?: string[];
  thresholds: QuestionThresholds;
  rubric_explanation?: string;
  timeLimit: number;
}

export type GradingMode = 'exact' | 'lexical' | 'semantic' | 'none';

export interface GradingDetails {
  normalizedStudent: string;
  normalizedReference: string;
  matchedCanonical?: string;
  missingKeywords?: string[];
  foundKeywords?: string[];
  lexicalSimilarity?: number; // Dice similarity (0 to 1)
  jaccardSimilarity?: number; // Jaccard similarity (0 to 1)
  cosineSimilarity?: number;  // Cosine similarity (-1 to 1)
  thresholdsUsed?: QuestionThresholds;
  reason?: string;
}

export interface GradingResult {
  score: number; // 0 to 1 (0% to 100%)
  mode: GradingMode;
  details: GradingDetails;
}

export interface PlayerData {
  id?: string;
  uid: string;
  name: string;
  score: number;
  currentAnswer?: string | null;
  answeredAt?: string;
  lastAnswerCorrect?: boolean | null;
  lastScoreAdded?: number;
  lastGradingResult?: GradingResult | null;
  joinedAt: string;
}

export interface GameData {
  hostUid: string;
  status: 'lobby' | 'question' | 'answer_reveal' | 'leaderboard' | 'podium' | 'generating' | 'ended';
  currentQuestionIndex: number;
  questionStartTime?: string;
  timeLimit?: number;
  history?: string[];
  createdAt: string;
}
