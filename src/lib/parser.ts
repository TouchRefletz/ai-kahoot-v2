import { Question, QuestionType } from './types';

export interface RawQuestionInput {
  type?: string;
  prompt?: string;
  enunciado?: string;
  question?: string;
  pergunta?: string;
  canonical_answers?: string[];
  respostas_canonicas?: string[];
  respostas_exatas?: string[];
  canonicalAnswers?: string[];
  reference_answer?: string;
  resposta_modelo?: string;
  gabarito?: string;
  referenceAnswer?: string;
  required_keywords?: string[];
  palavras_chave?: string[];
  palavras_obrigatorias?: string[];
  requiredKeywords?: string[];
  thresholds?: {
    full?: number;
    partial?: number;
  };
  rubric_explanation?: string;
  explicacao?: string;
  rubricExplanation?: string;
  timeLimit?: number;
  tempo_segundos?: number;
}

/**
 * Extracts and cleans JSON from raw text produced by an external LLM.
 * Supports Markdown fences (```json ... ```), mixed text commentary,
 * or direct JSON files.
 */
export function extractJsonFromText(rawText: string): any {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('O texto fornecido está vazio.');
  }

  let cleaned = rawText.trim();

  // 1. Remove Markdown code blocks if present
  const markdownMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdownMatch) {
    cleaned = markdownMatch[1].trim();
  }

  // 2. Direct JSON.parse attempt
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    // 3. Look for array boundaries [ ... ]
    const startBracket = cleaned.indexOf('[');
    const endBracket = cleaned.lastIndexOf(']');
    if (startBracket !== -1 && endBracket !== -1 && endBracket > startBracket) {
      try {
        const slice = cleaned.substring(startBracket, endBracket + 1);
        return JSON.parse(slice);
      } catch (e2) {
        // proceed
      }
    }

    // 4. Look for object boundaries { ... }
    const startBrace = cleaned.indexOf('{');
    const endBrace = cleaned.lastIndexOf('}');
    if (startBrace !== -1 && endBrace !== -1 && endBrace > startBrace) {
      try {
        const slice = cleaned.substring(startBrace, endBrace + 1);
        return JSON.parse(slice);
      } catch (e3) {
        // proceed
      }
    }

    throw new Error(
      'Não foi possível encontrar um formato JSON válido no texto. Certifique-se de que a IA gerou o arquivo no formato solicitado.'
    );
  }
}

/**
 * Normalizes raw parsed questions into the Question schema.
 */
export function sanitizeQuestions(parsedData: any): Omit<Question, 'embedding_ref' | 'index'>[] {
  let list: RawQuestionInput[] = [];

  if (Array.isArray(parsedData)) {
    list = parsedData;
  } else if (parsedData && typeof parsedData === 'object') {
    if (Array.isArray(parsedData.questions)) {
      list = parsedData.questions;
    } else if (Array.isArray(parsedData.questoes)) {
      list = parsedData.questoes;
    } else if (Array.isArray(parsedData.itens)) {
      list = parsedData.itens;
    } else if (Array.isArray(parsedData.data)) {
      list = parsedData.data;
    } else {
      throw new Error('O JSON não contém uma lista de questões ("questions" ou array direto).');
    }
  }

  if (list.length === 0) {
    throw new Error('Nenhuma questão válida encontrada no arquivo fornecido.');
  }

  return list.map((item, idx) => {
    const prompt = item.prompt || item.enunciado || item.question || item.pergunta || '';
    if (!prompt.trim()) {
      throw new Error(`A questão #${idx + 1} não possui enunciado ("prompt").`);
    }

    const refAnswer = item.reference_answer || item.resposta_modelo || item.gabarito || item.referenceAnswer || '';
    if (!refAnswer.trim()) {
      throw new Error(`A questão #${idx + 1} ("${prompt.slice(0, 30)}...") não possui resposta-modelo ("reference_answer").`);
    }

    // Auto-detect type if not explicit
    let qType: QuestionType = 'short_answer';
    const declaredType = (item.type || '').toLowerCase();
    if (declaredType.includes('blank') || declaredType.includes('lacuna') || prompt.includes('_____') || prompt.includes('___')) {
      qType = 'fill_blank';
    }

    // Canonical answers
    let canonicals: string[] = item.canonical_answers || item.respostas_canonicas || item.respostas_exatas || item.canonicalAnswers || [];
    if (!Array.isArray(canonicals)) {
      canonicals = [String(canonicals)];
    }
    if (canonicals.length === 0) {
      canonicals = [refAnswer.trim()];
    }

    // Required keywords
    let keywords: string[] = item.required_keywords || item.palavras_chave || item.palavras_obrigatorias || item.requiredKeywords || [];
    if (!Array.isArray(keywords)) {
      keywords = String(keywords).split(',').map(s => s.trim()).filter(Boolean);
    }

    // Thresholds
    const full = Number(item.thresholds?.full) || 0.82;
    const partial = Number(item.thresholds?.partial) || 0.65;

    // Time limit
    const timeLimit = Number(item.timeLimit) || Number(item.tempo_segundos) || 45;

    const rubric = item.rubric_explanation || item.explicacao || item.rubricExplanation || '';

    return {
      type: qType,
      prompt: prompt.trim(),
      canonical_answers: canonicals.map(s => String(s).trim()).filter(Boolean),
      reference_answer: refAnswer.trim(),
      required_keywords: keywords.map(s => String(s).trim()).filter(Boolean),
      thresholds: { full, partial },
      rubric_explanation: rubric.trim(),
      timeLimit: Math.max(15, Math.min(180, timeLimit))
    };
  });
}

export interface TopicBreakdownItem {
  id?: string;
  topic: string;
  count: number;
}

/**
 * Generates the full prompt for the user to copy and paste into ChatGPT, Claude, Gemini, DeepSeek, etc.
 */
export function generateExternalAIPrompt(config: {
  topic: string;
  numQuestions: number;
  difficulty: string;
  typeDistribution: string;
  customInstructions?: string;
  suggestedTimeLimit?: number;
  topicBreakdown?: TopicBreakdownItem[];
}): string {
  const targetTime = config.suggestedTimeLimit || 45;

  const validBreakdown = (config.topicBreakdown || []).filter(item => item.topic.trim().length > 0 && item.count > 0);
  const isMultiTopic = validBreakdown.length > 0;
  const totalQuestions = isMultiTopic
    ? validBreakdown.reduce((sum, item) => sum + item.count, 0)
    : Math.max(1, config.numQuestions);

  let topicsDescription = '';
  if (isMultiTopic) {
    topicsDescription = `DISTRIBUIÇÃO OBRIGATÓRIA DE TEMAS (${totalQuestions} questões no total):\n` +
      validBreakdown.map((item, idx) => `  ${idx + 1}. Exatamente ${item.count} questão(ões) sobre: "${item.topic.trim()}"`).join('\n');
  } else {
    topicsDescription = `Assunto/Conteúdo Geral: "${config.topic.trim() || 'Conhecimentos Gerais'}" (${totalQuestions} questões)`;
  }

  const sampleJson = `[
  {
    "type": "fill_blank",
    "prompt": "O processo celular no qual a glicose é quebrada no citosol gerando duas moléculas de piruvato é denominado _____.",
    "canonical_answers": [
      "glicolise",
      "glicólise",
      "processo de glicolise",
      "via glicolitica"
    ],
    "reference_answer": "Glicólise é a via metabólica anaeróbica que decompõe a glicose em piruvato, gerando saldo líquido de 2 ATPs.",
    "required_keywords": ["glicolise"],
    "thresholds": { "full": 0.82, "partial": 0.65 },
    "rubric_explanation": "O estudante deve identificar o termo técnico glicólise.",
    "timeLimit": ${targetTime}
  },
  {
    "type": "short_answer",
    "prompt": "Explique succintamente por que a membrana plasmática é descrita pelo modelo do mosaico fluido.",
    "canonical_answers": [
      "bicamada lipidica com proteinas em movimento",
      "camada dupla de fosfolipidios com proteinas que se movem lateralmente"
    ],
    "reference_answer": "Porque é composta por uma bicamada dinâmica de fosfolipídios na qual proteínas integrais e periféricas flutuam e se deslocam lateralmente.",
    "required_keywords": ["bicamada", "fosfolipidios", "proteinas"],
    "thresholds": { "full": 0.80, "partial": 0.65 },
    "rubric_explanation": "A resposta precisa citar a bicamada de fosfolipídios e o movimento das proteínas.",
    "timeLimit": ${targetTime}
  }
]`;

  return `Você é um professor e elaborador sênior de exames dissertativos acadêmicos.
Crie um arquivo JSON com EXATAMENTE ${totalQuestions} questões de treino dissertativo e preenchimento de lacunas conforme a especificação abaixo:

${topicsDescription}
Nível de Dificuldade: ${config.difficulty}
Distribuição de Tipos: ${config.typeDistribution}
Tempo Limite Recomendado por Questão: ${targetTime} segundos
${config.customInstructions ? `Instruções Adicionais do Professor: "${config.customInstructions}"` : ''}

REGRAS ESTRITAS DE FORMATAÇÃO DO ARQUIVO:
1. Retorne APENAS um bloco JSON válido (sem comentários, sem introdução e sem explicações antes ou depois). O JSON deve ser um ARRAY com as ${totalQuestions} questões.${isMultiTopic ? ` Respeite rigorosamente a contagem de cada tema listado acima!` : ''}
2. Cada objeto de questão deve conter EXATAMENTE as seguintes chaves:
   - "type": "short_answer" (resposta dissertativa curta de 1 a 3 frases) ou "fill_blank" (frase com lacuna).
   - "prompt": O enunciado da pergunta. Para questões de "fill_blank", a frase DEVE conter "_____" (cinco underlines) no local do termo a ser preenchido.
   - "canonical_answers": Array com 3 a 6 variações exatas aceitáveis (sinônimos diretos, grafias comuns com e sem acento, siglas ou termos técnicos).
   - "reference_answer": A resposta-modelo oficial (padrão ouro) completa e bem explicada (1 a 3 frases concisas).
   - "required_keywords": Array de 1 a 4 termos conceituais essenciais que DEVEM obrigatoriamente estar na resposta do aluno.
   - "thresholds": Objeto com { "full": 0.82, "partial": 0.65 }.
   - "rubric_explanation": Explicação concisa do critério de correção e justificativa da resposta correta.
   - "timeLimit": ${targetTime} (tempo em segundos para o aluno responder).

EXEMPLO EXATO DO FORMATO ESPERADO:
\`\`\`json
${sampleJson}
\`\`\`

Agora, elabore as ${totalQuestions} questões solicitadas${isMultiTopic ? ' seguindo a exata divisão por temas' : ` sobre "${config.topic}"`} e responda APENAS com o código JSON pronto para salvar como arquivo:`;
}
