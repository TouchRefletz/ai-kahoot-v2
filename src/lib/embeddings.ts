import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js for browser environment
env.allowLocalModels = false;
env.useBrowserCache = true;

let featureExtractor: any = null;
let loadingPromise: Promise<any> | null = null;

/**
 * Initializes and caches the Xenova/all-MiniLM-L6-v2 pipeline.
 * Runs completely locally in the browser on CPU via WebAssembly (ONNX Runtime).
 */
export async function getEmbeddingPipeline() {
  if (featureExtractor) return featureExtractor;

  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          quantized: true,
        });
        featureExtractor = pipe;
        return pipe;
      } catch (err) {
        console.error('Falha ao carregar modelo all-MiniLM-L6-v2 local:', err);
        loadingPromise = null;
        throw err;
      }
    })();
  }
  return loadingPromise;
}

/**
 * Computes a 384-dimensional sentence embedding using all-MiniLM-L6-v2 locally.
 * Returns a normalized vector of numbers (mean pooled & L2 normalized).
 */
export async function computeEmbedding(text: string): Promise<number[]> {
  const clean = text.trim();
  if (!clean) {
    return new Array(384).fill(0);
  }

  try {
    const pipe = await getEmbeddingPipeline();
    const output = await pipe(clean, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (error) {
    console.warn('Erro ao calcular embedding com all-MiniLM-L6-v2, usando fallback vetorial determinístico:', error);
    return computeFallbackEmbedding(clean, 384);
  }
}

/**
 * Deterministic hash-based feature vector fallback (384 dims, L2 normalized)
 * used only if network is completely blocked from downloading the ONNX weights.
 */
function computeFallbackEmbedding(text: string, dimensions = 384): number[] {
  const vec = new Array(dimensions).fill(0);
  const words = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/);
  
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vec[idx] += 1;
    // secondary ngram hash
    const idx2 = (Math.abs(hash * 31) + word.length) % dimensions;
    vec[idx2] += 0.5;
  }

  // L2 normalization
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dimensions; i++) {
    vec[i] = vec[i] / norm;
  }
  return vec;
}

/**
 * Computes cosine similarity between two vectors u and v.
 * Returns a value between -1 and 1 (typically 0 to 1 for normalized text embeddings).
 */
export function cosineSimilarity(u: number[], v: number[]): number {
  if (!u || !v || u.length === 0 || v.length === 0 || u.length !== v.length) {
    return 0;
  }

  let dotProduct = 0;
  let normU = 0;
  let normV = 0;

  for (let i = 0; i < u.length; i++) {
    dotProduct += u[i] * v[i];
    normU += u[i] * u[i];
    normV += v[i] * v[i];
  }

  const denominator = Math.sqrt(normU) * Math.sqrt(normV);
  if (denominator === 0) return 0;
  
  const score = dotProduct / denominator;
  // Clamping to [-1, 1] to avoid float precision issues
  return Math.max(-1, Math.min(1, score));
}
