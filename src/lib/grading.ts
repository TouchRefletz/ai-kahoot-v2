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
 * Portuguese stemmer and concept root helper.
 * Removes grammatical inflections (plurals, gender endings, suffixes)
 * so that words like "tirânico", "tirana", "tiranias" map to "tiran",
 * matching keyword "tirania".
 */
export function stemWord(word: string): string {
  let w = normalizeText(word);
  if (w.length <= 3) return w;

  // Semantic concept root equivalences for common exam concepts
  if (w.startsWith('livr') || w.startsWith('libert') || w.startsWith('liberd')) return 'liberd';
  if (w.startsWith('tiran')) return 'tiran';
  if (w.startsWith('despot')) return 'despot';
  if (w.startsWith('autoritar')) return 'autoritar';
  if (w.startsWith('democr')) return 'democr';
  if (w.startsWith('constitu')) return 'constitu';
  if (w.startsWith('legislat')) return 'legislat';
  if (w.startsWith('execut')) return 'execut';
  if (w.startsWith('judici')) return 'judici';
  if (w.startsWith('enzim')) return 'enzim';
  if (w.startsWith('catalis')) return 'catalis';
  if (w.startsWith('mitocondr')) return 'mitocondr';
  if (w.startsWith('cloroplast')) return 'cloroplast';
  if (w.startsWith('fotossint')) return 'fotossint';
  if (w.startsWith('respirac')) return 'respirac';
  if (w.startsWith('equilibr') || w.startsWith('desequilibr')) return 'equilibr';

  // Common Portuguese suffix removals
  const suffixes = [
    'adissimas', 'adissimos', 'adissima', 'adissimo',
    'mentes', 'mente',
    'idades', 'idade',
    'ismos', 'ismo',
    'istas', 'ista',
    'acoes', 'acao', 'coes', 'cao',
    'aveis', 'iveis', 'avel', 'ivel',
    'amentos', 'amento',
    'ancias', 'ancia', 'encias', 'encia',
    'arios', 'ario', 'arias', 'aria',
    'adores', 'adora', 'ador',
    'antes', 'ante', 'entes', 'ente',
    'ando', 'endo', 'indo',
    'aram', 'eram', 'iram',
    'avam', 'evam', 'ivam',
    'assem', 'essem', 'issem',
    'arias', 'erias', 'irias',
    'aria', 'eria', 'iria',
    'asse', 'esse', 'isse',
    'icos', 'icas', 'ico', 'ica',
    'osos', 'osas', 'oso', 'osa',
    'ados', 'adas', 'ado', 'ada',
    'ais', 'eis', 'ois', 'uis',
    'al', 'el', 'il', 'ol', 'ul',
    'ias', 'ia',
    'os', 'as', 'es', 's'
  ];

  for (const suf of suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      break;
    }
  }

  return w;
}

/**
 * Computes Levenshtein edit distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];

  for (let i = 0; i <= m; i++) dp[i] = [i];
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

/**
 * Evaluates whether a keyword exists in the student answer.
 * Uses exact substring, Portuguese stemming, and prefix checks.
 */
export function matchKeyword(text: string, keyword: string): { matched: boolean; matchedWord?: string } {
  const normText = normalizeText(text);
  const normKey = normalizeText(keyword);
  if (!normKey) return { matched: true };

  // 1. Direct whole phrase or substring match
  if (normText.includes(normKey)) {
    return { matched: true, matchedWord: normKey };
  }

  // 2. Check word-by-word against stem and prefixes
  const textWords = normText.split(/\s+/).filter(w => w.length > 0);
  const keyWords = normKey.split(/\s+/).filter(w => w.length > 0);

  if (keyWords.length === 1) {
    const keyStem = stemWord(normKey);
    for (const tw of textWords) {
      const twStem = stemWord(tw);
      if (twStem === keyStem) {
        return { matched: true, matchedWord: tw };
      }
      // If root is >= 4 chars, prefix check (e.g. tiranico starts with tiran)
      if (keyStem.length >= 4 && (tw.startsWith(keyStem) || keyStem.startsWith(twStem))) {
        return { matched: true, matchedWord: tw };
      }
      // Typo tolerance of 1 char for words of length >= 5
      if (keyStem.length >= 5 && Math.abs(twStem.length - keyStem.length) <= 1) {
        if (levenshteinDistance(twStem, keyStem) <= 1) {
          return { matched: true, matchedWord: tw };
        }
      }
    }
  } else {
    // Multi-word keyword phrase: all words in phrase or their stems must be present
    const allFound = keyWords.every(kw => {
      const kwStem = stemWord(kw);
      return textWords.some(tw => {
        const twStem = stemWord(tw);
        return twStem === kwStem || (kwStem.length >= 4 && (tw.startsWith(kwStem) || kwStem.startsWith(twStem)));
      });
    });
    if (allFound) {
      return { matched: true, matchedWord: normKey };
    }
  }

  return { matched: false };
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
  const normStudent = normalizeText(studentAnswer);
  const normRef = normalizeText(question.reference_answer);

  // 1. STRICT CHECK: If student answer is empty, score is ALWAYS 0
  if (!normStudent || normStudent.length === 0) {
    return {
      score: 0,
      mode: 'none',
      details: {
        normalizedStudent: '',
        normalizedReference: normRef,
        lexicalSimilarity: 0,
        jaccardSimilarity: 0,
        cosineSimilarity: 0,
        reason: 'Sem resposta enviada'
      }
    };
  }

  const wordsStudent = extractWords(studentAnswer);
  const wordsRef = extractWords(question.reference_answer);

  const diceScore = computeDiceSimilarity(wordsStudent, wordsRef);
  const jaccardScore = computeJaccardSimilarity(wordsStudent, wordsRef);

  // 2. Exact match against question.canonical_answers
  const canonicalMatches = (question.canonical_answers || []).map(ans => normalizeText(ans));
  for (let i = 0; i < canonicalMatches.length; i++) {
    const canonical = canonicalMatches[i];
    if (canonical && canonical.length > 0 && normStudent === canonical) {
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

  // 3. Evaluate required keywords using flexible stem matching
  const foundKeywords: string[] = [];
  const missingKeywords: string[] = [];

  if (question.required_keywords && question.required_keywords.length > 0) {
    for (const kw of question.required_keywords) {
      const match = matchKeyword(normStudent, kw);
      if (match.matched) {
        foundKeywords.push(match.matchedWord && normalizeText(match.matchedWord) !== normalizeText(kw)
          ? `${kw} (identificado como "${match.matchedWord}")`
          : kw);
      } else {
        missingKeywords.push(kw);
      }
    }
  }

  // For fill_blank questions:
  if (question.type === 'fill_blank') {
    // In fill-in-the-blank, canonical answers or keywords are the answer key
    if (foundKeywords.length > 0 && missingKeywords.length === 0) {
      return {
        score: 1.0,
        mode: 'exact',
        details: {
          normalizedStudent: normStudent,
          normalizedReference: normRef,
          foundKeywords,
          missingKeywords,
          lexicalSimilarity: Math.round(diceScore * 1000) / 1000,
          jaccardSimilarity: Math.round(jaccardScore * 1000) / 1000,
          reason: `Preencheu corretamente a lacuna com termo esperado (${foundKeywords.join(', ')})`
        }
      };
    }

    if (diceScore >= 0.60) {
      return {
        score: 1.0,
        mode: 'lexical',
        details: {
          normalizedStudent: normStudent,
          normalizedReference: normRef,
          foundKeywords,
          missingKeywords,
          lexicalSimilarity: Math.round(diceScore * 1000) / 1000,
          reason: 'Termo correspondente por similaridade'
        }
      };
    }

    return {
      score: 0,
      mode: 'none',
      details: {
        normalizedStudent: normStudent,
        normalizedReference: normRef,
        foundKeywords,
        missingKeywords,
        lexicalSimilarity: Math.round(diceScore * 1000) / 1000,
        reason: missingKeywords.length > 0
          ? `Termo incorreto para a lacuna. Termo esperado: ${missingKeywords.join(', ')}`
          : 'Termo incorreto para a lacuna'
      }
    };
  }

  // 4. Lexical similarity (Dice / Jaccard) for short answer
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
        reason: `Alta correspondência conceitual léxica (Dice: ${(diceScore * 100).toFixed(1)}%)`
      }
    };
  }

  // 5. Semantic similarity via embeddings cosine
  const fullThreshold = question.thresholds?.full ?? 0.80;
  const partialThreshold = question.thresholds?.partial ?? 0.62;

  let cosine = 0;
  if (studentEmbedding && question.embedding_ref && question.embedding_ref.length > 0) {
    cosine = cosineSimilarity(question.embedding_ref, studentEmbedding);
  }

  let rawSemanticScore = 0;
  let semanticReason = '';

  if (cosine >= fullThreshold) {
    rawSemanticScore = 1.0;
    semanticReason = `Similaridade semântica plena (cosseno: ${(cosine * 100).toFixed(1)}% >= ${(fullThreshold * 100).toFixed(1)}%)`;
  } else if (cosine >= partialThreshold) {
    // Continuous partial score between 0.50 and 0.85:
    const ratio = (cosine - partialThreshold) / Math.max(0.001, fullThreshold - partialThreshold);
    rawSemanticScore = 0.50 + 0.35 * Math.min(1, Math.max(0, ratio));
    semanticReason = `Similaridade semântica parcial (cosseno: ${(cosine * 100).toFixed(1)}%, faixa [${(partialThreshold * 100).toFixed(0)}% - ${(fullThreshold * 100).toFixed(0)}%])`;
  } else if (cosine >= partialThreshold - 0.12) {
    // Recognition of topic/context (e.g. between 50% and 62% cosine)
    const ratio = (cosine - (partialThreshold - 0.12)) / 0.12;
    rawSemanticScore = 0.30 + 0.20 * Math.min(1, Math.max(0, ratio));
    semanticReason = `Compreensão conceitual aproximada (cosseno: ${(cosine * 100).toFixed(1)}%)`;
  } else {
    rawSemanticScore = 0;
    semanticReason = `Similaridade semântica insuficiente (cosseno: ${(cosine * 100).toFixed(1)}% < ${(partialThreshold * 100).toFixed(1)}%)`;
  }

  // 6. Integrate keyword coverage with semantic score FAIRLY (no total zero-out veto)
  let finalScore = rawSemanticScore;
  const totalKeywords = (question.required_keywords || []).length;

  if (totalKeywords > 0) {
    const keywordCoverage = foundKeywords.length / totalKeywords;

    if (missingKeywords.length === 0) {
      // All required keywords/roots matched! Full semantic score applies
      finalScore = rawSemanticScore;
    } else if (rawSemanticScore > 0) {
      // Student understood the concept semantically, but missed some specific vocabulary
      // Apply fair scaling (0.60 base + 0.40 * coverage) so students are NOT zeroed out
      const factor = 0.60 + 0.40 * keywordCoverage;
      finalScore = Math.max(0.35, Math.round(rawSemanticScore * factor * 100) / 100);

      const foundText = foundKeywords.length > 0 ? `Termos identificados: ${foundKeywords.join(', ')}. ` : '';
      semanticReason = `${foundText}Atenção: faltou abordar explicitamente: ${missingKeywords.join(', ')}. Similaridade semântica: ${(cosine * 100).toFixed(1)}%.`;
    } else {
      finalScore = 0;
      semanticReason = `Resposta insuficiente. Faltaram os conceitos essenciais: ${missingKeywords.join(', ')}. (Cosseno: ${(cosine * 100).toFixed(1)}%).`;
    }
  }

  return {
    score: Math.min(1.0, Math.max(0, finalScore)),
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
  const normStudent = normalizeText(studentAnswer);
  if (!normStudent) {
    return gradeShortAnswer(studentAnswer, question);
  }

  // Ensure reference embedding exists
  if ((!question.embedding_ref || question.embedding_ref.length === 0) && question.reference_answer) {
    try {
      question.embedding_ref = await computeEmbedding(question.reference_answer);
    } catch (err) {
      console.warn('Erro ao computar embedding da resposta-modelo:', err);
    }
  }

  let studentEmbedding: number[] | undefined = undefined;

  // Only calculate student embedding if not an exact match
  const isExact = (question.canonical_answers || []).some(ans => normalizeText(ans) === normStudent);
  if (!isExact) {
    try {
      studentEmbedding = await computeEmbedding(studentAnswer);
    } catch (err) {
      console.warn('Erro ao computar embedding localmente:', err);
    }
  }

  return gradeShortAnswer(studentAnswer, question, studentEmbedding);
}

