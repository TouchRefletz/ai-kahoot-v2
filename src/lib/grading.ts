import { Question, GradingResult, GradingMode } from './types';
import { cosineSimilarity, computeEmbedding } from './embeddings';

/**
 * Normalizes text for fair comparison:
 * - Lowercase
 * - Removes accents/diacritics (NFD unicode decomposition)
 * - Removes excessive punctuation and symbols
 * - Collapses multiple spaces into a single space and trims
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics / accents
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’´`«»[\]<>\\|]/g, ' ') // replace punctuation with spaces
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .trim();
}

/**
 * Extracts a Set of unique normalized words from a text string.
 */
export function extractWords(text: string): Set<string> {
  const normalized = normalizeText(text);
  if (!normalized) return new Set();
  const words = normalized.split(' ').filter(w => w.length > 0);
  return new Set(words);
}

/**
 * Computes Dice similarity coefficient between two sets of words:
 * Dice = (2 * |A ∩ B|) / (|A| + |B|)
 * Range: 0.0 to 1.0
 */
export function computeDiceSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionCount = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersectionCount++;
    }
  }

  return (2 * intersectionCount) / (setA.size + setB.size);
}

/**
 * Computes Jaccard similarity index between two sets of words:
 * Jaccard = |A ∩ B| / |A ∪ B|
 * Range: 0.0 to 1.0
 */
export function computeJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionCount = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersectionCount++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionCount;
  return unionSize > 0 ? intersectionCount / unionSize : 0;
}

/**
 * Evaluates whether a keyword exists in the normalized student answer.
 * Uses whole-word or substring boundary checks.
 */
function containsKeyword(normalizedText: string, keyword: string): boolean {
  const normKey = normalizeText(keyword);
  if (!normKey) return true;

  // Exact word boundary check or substring match for multi-word phrases
  const regex = new RegExp(`(^|\\s)${normKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
  return regex.test(normalizedText) || normalizedText.includes(normKey);
}

/**
 * Core grading function for short answers.
 * Implements the deterministic -> lexical -> semantic pipeline without any LLM.
 *
 * @param studentAnswer The raw text answer from the student
 * @param question The question configuration with canonical answers, keywords, ref embedding & thresholds
 * @param studentEmbedding Optional precomputed 384-d embedding vector for studentAnswer
 */
export function gradeShortAnswer(
  studentAnswer: string,
  question: Question,
  studentEmbedding?: number[]
): GradingResult {
  // a) Normalização de texto
  const normStudent = normalizeText(studentAnswer);
  const normRef = normalizeText(question.reference_answer);

  const wordsStudent = extractWords(studentAnswer);
  const wordsRef = extractWords(question.reference_answer);

  const diceScore = computeDiceSimilarity(wordsStudent, wordsRef);
  const jaccardScore = computeJaccardSimilarity(wordsStudent, wordsRef);

  // If student answer is empty, score is 0
  if (!normStudent) {
    return {
      score: 0,
      mode: 'none',
      details: {
        normalizedStudent: normStudent,
        normalizedReference: normRef,
        lexicalSimilarity: 0,
        jaccardSimilarity: 0,
        cosineSimilarity: 0,
        reason: 'Resposta em branco'
      }
    };
  }

  // b) Checagem de matching exato contra question.canonical_answers
  const canonicalMatches = (question.canonical_answers || []).map(ans => normalizeText(ans));
  for (let i = 0; i < canonicalMatches.length; i++) {
    const canonical = canonicalMatches[i];
    if (canonical && normStudent === canonical) {
      return {
        score: 1.0, // 100%
        mode: 'exact',
        details: {
          normalizedStudent: normStudent,
          normalizedReference: normRef,
          matchedCanonical: question.canonical_answers[i],
          lexicalSimilarity: 1.0,
          jaccardSimilarity: 1.0,
          reason: `Match exato com resposta canônica: "${question.canonical_answers[i]}"`
        }
      };
    }
  }

  // c) Checagem de required_keywords (se existir)
  const foundKeywords: string[] = [];
  const missingKeywords: string[] = [];

  if (question.required_keywords && question.required_keywords.length > 0) {
    for (const kw of question.required_keywords) {
      if (containsKeyword(normStudent, kw)) {
        foundKeywords.push(kw);
      } else {
        missingKeywords.push(kw);
      }
    }

    // Se alguma palavra-chave obrigatória não estiver presente, retornar score = 0
    if (missingKeywords.length > 0) {
      return {
        score: 0,
        mode: 'none',
        details: {
          normalizedStudent: normStudent,
          normalizedReference: normRef,
          foundKeywords,
          missingKeywords,
          lexicalSimilarity: Math.round(diceScore * 1000) / 1000,
          jaccardSimilarity: Math.round(jaccardScore * 1000) / 1000,
          reason: `Faltaram palavras-chave obrigatórias: ${missingKeywords.join(', ')}`
        }
      };
    }
  }

  // d) Cálculo de similaridade léxica (Dice / Jaccard)
  // Threshold padrão sugerido: Dice >= 0.70 (ou Jaccard >= 0.55)
  const LEXICAL_THRESHOLD = 0.70;
  if (diceScore >= LEXICAL_THRESHOLD) {
    return {
      score: 1.0,
      mode: 'lexical',
      details: {
        normalizedStudent: normStudent,
        normalizedReference: normRef,
        foundKeywords,
        missingKeywords,
        lexicalSimilarity: Math.round(diceScore * 1000) / 1000,
        jaccardSimilarity: Math.round(jaccardScore * 1000) / 1000,
        reason: `Alta similaridade léxica (Dice: ${(diceScore * 100).toFixed(1)}% >= ${(LEXICAL_THRESHOLD * 100).toFixed(0)}%)`
      }
    };
  }

  // e) Cálculo de similaridade semântica via cosseno
  const fullThreshold = question.thresholds?.full ?? 0.82;
  const partialThreshold = question.thresholds?.partial ?? 0.65;

  let cosine = 0;
  if (studentEmbedding && question.embedding_ref && question.embedding_ref.length > 0) {
    cosine = cosineSimilarity(question.embedding_ref, studentEmbedding);
  }

  let finalScore = 0;
  let semanticReason = '';

  if (cosine >= fullThreshold) {
    finalScore = 1.0;
    semanticReason = `Similaridade semântica plena (cosseno: ${(cosine * 100).toFixed(1)}% >= ${(fullThreshold * 100).toFixed(1)}%)`;
  } else if (cosine >= partialThreshold) {
    // Fórmula de pontuação parcial contínua entre 0.5 e 0.8:
    // score = 0.5 + 0.3 * ((cosine - partial) / (full - partial))
    const ratio = (cosine - partialThreshold) / Math.max(0.001, fullThreshold - partialThreshold);
    const calculatedScore = 0.5 + 0.3 * Math.min(1, Math.max(0, ratio));
    finalScore = Math.round(calculatedScore * 100) / 100;
    semanticReason = `Similaridade semântica parcial (cosseno: ${(cosine * 100).toFixed(1)}%, faixa [${(partialThreshold * 100).toFixed(0)}% - ${(fullThreshold * 100).toFixed(0)}%])`;
  } else {
    finalScore = 0;
    semanticReason = `Similaridade semântica insuficiente (cosseno: ${(cosine * 100).toFixed(1)}% < ${(partialThreshold * 100).toFixed(1)}%)`;
  }

  return {
    score: finalScore,
    mode: 'semantic',
    details: {
      normalizedStudent: normStudent,
      normalizedReference: normRef,
      foundKeywords,
      missingKeywords,
      lexicalSimilarity: Math.round(diceScore * 1000) / 1000,
      jaccardSimilarity: Math.round(jaccardScore * 1000) / 1000,
      cosineSimilarity: Math.round(cosine * 1000) / 1000,
      thresholdsUsed: { full: fullThreshold, partial: partialThreshold },
      reason: semanticReason
    }
  };
}

/**
 * Async wrapper that automatically computes the student answer's embedding
 * using local all-MiniLM-L6-v2 in the browser if studentEmbedding is not supplied.
 */
export async function gradeShortAnswerAsync(
  studentAnswer: string,
  question: Question
): Promise<GradingResult> {
  let studentEmbedding: number[] | undefined = undefined;

  // Only calculate embedding if not an exact match and required keywords pass
  const normStudent = normalizeText(studentAnswer);
  const isExact = (question.canonical_answers || []).some(ans => normalizeText(ans) === normStudent);

  if (!isExact && normStudent) {
    try {
      studentEmbedding = await computeEmbedding(studentAnswer);
    } catch (err) {
      console.warn('Erro ao computar embedding localmente:', err);
    }
  }

  return gradeShortAnswer(studentAnswer, question, studentEmbedding);
}
