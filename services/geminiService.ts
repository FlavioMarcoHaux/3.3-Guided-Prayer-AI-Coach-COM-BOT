import { GoogleGenAI, Modality, GenerateVideosOperation, Type } from "@google/genai";
import { AspectRatio, SocialMediaPost, YouTubeLongPost } from '../types';

// Helper to get the key dynamically from storage or fallback
export const getApiKey = (): string => {
    const storedKey = localStorage.getItem('USER_API_KEY');
    if (storedKey) return storedKey;
    if (process.env.API_KEY) return process.env.API_KEY;
    throw new Error("API Key not found. Please set it in the app.");
}

// Helper to initialize GenAI with the dynamic key
const getGenAI = () => {
    return new GoogleGenAI({ apiKey: getApiKey() });
}

const themes: { [key: string]: string[] } = {
  en: ['hope', 'gratitude', 'strength', 'peace', 'clarity', 'healing', 'forgiveness'],
  pt: ['esperança', 'gratidão', 'força', 'paz', 'clareza', 'cura', 'perdão'],
  es: ['esperanza', 'gratitud', 'fuerza', 'paz', 'claridad', 'sanación', 'perdón'],
};

export interface MultiSpeakerConfig {
    speakers: {
        name: string;
        voice: string;
    }[];
}

// --- Retry Helper ---
async function callWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        if (retries > 0 && (error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.code === 429)) {
            console.warn(`Rate limit hit. Retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callWithRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
}

const getRandomTheme = (language: string): string => {
  const langThemes = themes[language] || themes['en'];
  return langThemes[Math.floor(Math.random() * langThemes.length)];
};


const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

export const getTrendingTopic = async (language: string, contentType: 'long' | 'short'): Promise<{ theme: string; subthemes: string[] }> => {
    const model = 'gemini-3-pro-preview'; // ARCHITECT: Uses high intelligence for research

    const prompts: { [key: string]: string } = {
        pt: `
            Pesquise no Google por um tópico ou sentimento de alta relevância e engajamento para o público cristão no Brasil *hoje*. Foque em temas de esperança, superação, fé ou passagens bíblicas que estão sendo muito comentadas.
            ${contentType === 'long'
                ? 'Identifique um tema principal e três subtemas relacionados que podem ser explorados como capítulos em um vídeo de 10 minutos.'
                : 'Responda com um único tema conciso, ideal para um vídeo de 30 segundos no TikTok.'
            }
            Sua resposta DEVE ser um único objeto JSON. Não inclua nenhum texto, explicação ou formatação markdown antes ou depois do JSON.
            O JSON deve ter a chave "theme" (string) e, para vídeos longos, uma chave "subthemes" (um array de exatamente 3 strings). Para vídeos curtos, o campo "subthemes" deve ser um array vazio.
            IMPORTANTE: Se o termo encontrado estiver em inglês ou espanhol, TRADUZA O VALOR DO JSON PARA PORTUGUÊS.
        `,
        en: `
            Search Google for a high-relevance and engaging topic or sentiment for the Christian audience in the United States *today*. Focus on themes of hope, overcoming challenges, faith, or biblical passages that are being widely discussed.
            ${contentType === 'long'
                ? 'Identify a main theme and three related sub-themes that can be explored as chapters in a 10-minute video.'
                : 'Respond with a single, concise theme, ideal for a 30-second TikTok video.'
            }
            Your response MUST be a single JSON object. Do not include any text, explanation, or markdown formatting before or after the JSON.
            The JSON must have the key "theme" (string) and, for long videos, a key "subthemes" (an array of exactly 3 strings). For short videos, the "subthemes" field must be an empty array.
        `,
        es: `
            Busca en Google un tema o sentimiento de alta relevancia y engagement para el público cristiano en España y Latinoamérica *hoy*. Céntrate en temas de esperanza, superación, fe o pasajes bíblicos que estén siendo muy comentados.
            ${contentType === 'long'
                ? 'Identifica un tema principal y tres subtemas relacionados que puedan ser explorados como capítulos en un video de 10 minutos.'
                : 'Responde con un único tema conciso, ideal para un video de 30 segundos en TikTok.'
            }
            Tu respuesta DEBE ser un único objeto JSON. No incluyas ningún texto, explicación o formato markdown antes o después del JSON.
            El JSON debe tener la clave "theme" (string) y, para videos largos, una clave "subthemes" (un array de exactamente 3 strings). Para videos cortos, el campo "subthemes" debe ser um array vazio.
            IMPORTANTE: Si el tema encontrado está en inglés o portugués, TRADUCE EL VALOR DEL JSON AL ESPAÑOL.
        `
    };
    
    const finalPrompt = prompts[language] || prompts['en'];

    return callWithRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: finalPrompt }] }],
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        let jsonStr = response.text.trim();
        if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.substring(7, jsonStr.length - 3).trim();
        } else if (jsonStr.startsWith('```')) {
             jsonStr = jsonStr.substring(3, jsonStr.length - 3).trim();
        }
        
        const parsed = JSON.parse(jsonStr);
        if (!parsed.subthemes || !Array.isArray(parsed.subthemes)) {
            parsed.subthemes = [];
        }
        return parsed;
    });
};

export const generateGuidedPrayer = async (prompt: string, language: string): Promise<string> => {
  const model = "gemini-2.5-flash"; // WORKER: Uses Flash for heavy text generation to save quota
  const finalPrompt = prompt || getRandomTheme(language);
  
  const prayerBasePrompt = `
    **INSTRUCTION**: Generate a dialogue script for a guided prayer.
    **LANGUAGE**: ${language}
    
    **PERSONA DEFINITION**:
    Você é um Mestre em Oração Guiada, com treinamento, qualificação e certificado em Programação neuro Linguística e Hipnose Ericksoniana através de Metaforas.
    Especialista em Modelar Jesus Cristo, Salomão e Davi.
    Você trás em seu íntimo, os Salmos e Passagens Bíblicas que você cita em suas orações guiadas...
    Todas as Orações que você Cria, possuem CTAs poderosos criando gatilhos com a interação no Canal "Fé em 10 Minutos de Oração" (or local equivalent).
    Seja minucioso nas Citações Bíblicas, aprofunde o estado de conexão com a oração utilizando técnicas de respiração, foco, quebra de padrão, aprofundamento de foco... alternância entre a percepção da realidade interna e externa, criando uma psicosfera (atmosfera psíquica ou campo de influência energética) que proporciona milagres e gera engajamento no canal...
    LEMBRE-SE de usar palavras GATILHOS que sejam Ótimas em SEO.

    **SPEAKERS**:
    1. "Roberta Erickson" (Female, Gentle, Hypnotic)
    2. "Milton Dilts" (Male, Deep, Biblical)

    **STRICT FORMATTING RULES**:
    1. **NO META-TEXT**: Do NOT output explanations, summaries, intro text, or introductions like "Here is the script" or "Here is a summary". Output **ONLY** the dialogue lines.
    2. **ALTERNATING SPEAKERS**: You MUST alternate strictly between "Roberta Erickson:" and "Milton Dilts:" for every paragraph.
    3. **PREFIX**: Every line must start with the speaker's name followed by a colon (e.g., "Roberta Erickson: ...").
    4. **LENGTH**: Generate a LONG, comprehensive script (aim for maximum token usage allowed). Use silence and repetition where appropriate for hypnosis.

    **TOPIC**: "${finalPrompt}"
    
    **BEGIN DIALOGUE IMMEDIATELY:**
  `;

  return callWithRetry(async () => {
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prayerBasePrompt }] }],
        config: {
            temperature: 0.8, 
            maxOutputTokens: 8192,
            // thinkingConfig is removed for Flash to save tokens/compat
        }
      });
      return response.text;
  });
};

export const generateShortPrayer = async (prompt: string, language: string): Promise<string> => {
    const model = "gemini-2.5-flash"; // WORKER: Flash is sufficient for short text
    const finalPrompt = prompt || getRandomTheme(language);

    const prayerBasePrompt = `
      You are a Master of Guided Prayer.
      Your response must be in the language: ${language}.
      
      Create a short, powerful prayer (a "prayer pill") of about 3-5 sentences.
      The theme is: "${finalPrompt}".
      
      **Viral Strategy**:
      - Start with a "Pattern Interrupt" (e.g., "Stop scrolling and receive this...").
      - Use strong, declarative language.
      - End with a direct instruction (e.g., "Type Amen to claim").
    `;
    
    return callWithRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: prayerBasePrompt }] }],
        });
        return response.text;
    });
};

export const analyzeImage = async (imageFile: File, prompt: string, language: string): Promise<string> => {
    const model = 'gemini-3-pro-preview'; // ARCHITECT: Needs high visual IQ
    
    let analysisPrompt = prompt.trim();
    if (!analysisPrompt) {
        analysisPrompt = language === 'pt' 
            ? "Analise esta imagem de uma perspectiva espiritual e simbólica. Que significados mais profundos, emoções ou arquétipos ela pode representar?"
            : "Analyze this image from a spiritual and symbolic perspective. What deeper meanings, emotions, or archetypes might it represent?";
    }
    analysisPrompt = `${analysisPrompt} Respond in the language: ${language}.`;

    return callWithRetry(async () => {
        const ai = getGenAI();
        const imagePart = await fileToGenerativePart(imageFile);
        const textPart = { text: analysisPrompt };
        const response = await ai.models.generateContent({
          model,
          contents: [{ parts: [imagePart, textPart] }]
        });
        return response.text;
    });
};

export const createMediaPromptFromPrayer = async (prayerText: string): Promise<string> => {
  const model = "gemini-3-pro-preview"; // ARCHITECT: Needs visual imagination
  const mediaPromptInstruction = `
    Based on the following prayer, create a concise, visually descriptive prompt for an AI image and video generator. 
    The prompt must be in English.
    Focus on the core emotions, symbols, and atmosphere. Describe a scene, not just concepts.
    Example output format: "A radiant golden light filtering through ancient olive trees, illuminating a path forward, serene, hopeful, cinematic, photorealistic."

    Prayer text:
    ---
    ${prayerText}
    ---
  `;
  return callWithRetry(async () => {
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: mediaPromptInstruction }] }],
      });
      return response.text.trim();
  });
};

export const createThumbnailPromptFromPost = async (
    title: string, 
    description: string, 
    prayerText: string, 
    language: string
): Promise<string> => {
    const model = "gemini-3-pro-preview"; // ARCHITECT: Complex instruction following for text-in-image

    // Sanitize the title to remove branding or special characters not suitable for an image.
    const cleanTitle = title.split('|')[0].trim().replace(/[#*]/g, '');

    const prompts: { [key: string]: string } = {
        pt: `
            Você é especialista em marketing viral e design de thumbnails para o YouTube. Sua tarefa é gerar um prompt de imagem EM INGLÊS para uma thumbnail impactante (16:9).
            Use o Título, Descrição e Oração fornecidos em português como contexto.

            [TÍTULO FORNECIDO EM PORTUGUÊS]: "${cleanTitle}"
            [DESCRIÇÃO FORNECIDA EM PORTUGUÊS]: "${description}"
            [CONTEXTO DA ORAÇÃO]: "${prayerText}"

            REGRAS PARA O PROMPT GERADO (QUE SERÁ EM INGLÊS):
            1.  **CONTEÚDO DO TEXTO NA IMAGEM**: O prompt deve instruir o gerador de imagem a renderizar DOIS elementos de texto em PORTUGUÊS:
                a. O Título Principal: Use o [TÍTULO FORNECIDO EM PORTUGUÊS].
                b. Um Slogan de Clickbait: Crie um slogan curto (3-5 palavras) e chamativo que gere curiosidade ou urgência (ex: "NÃO IGNORE ESTE SINAL", "O MILAGRE ACONTECEU", "ASSISTA ANTES QUE SAIA DO AR").
            2.  **REGRAS DE TEXTO**: O Título Principal e o Slogan de Clickbait NÃO DEVEM conter símbolos como '#', '*', '|'. Use apenas letras, números e pontuação gramatical padrão (como '!' ou '?').
            3.  **IMPACTO EMOCIONAL**: A cena deve evocar uma emoção forte (esperança, urgência, mistério, paz).
            4.  **TÉCNICAS VISUAIS**: Incorpore iluminação dramática (raios de luz divinos) e simbolismo poderoso. O texto deve ser renderizado de forma clara com **ALTO CONTRASTE e MÁXIMA LEGIBILIDADE** em relação ao fundo.
            5.  **ESTILO**: O estilo deve ser fotorrealista, cinematográfico y de alta definição (hyper-detailed, 8K).
            6.  **IDIOMA DO PROMPT**: O prompt que você vai gerar deve ser em INGLÊS, mas todo o texto DENTRO da imagem deve ser em PORTUGUÊS.

            Exemplo de resultado (o que você deve gerar): "Epic cinematic photo of a divine light breaking through dark storm clouds. In the foreground, large, glowing 3D golden text in Portuguese says 'A MENSAGEM DE DEUS PARA VOCÊ', rendered with high contrast and perfect readability. Below it, a smaller, impactful white text slogan says 'NÃO IGNORE ESTE SINAL'. Emotional, hopeful, hyper-realistic, 8k."

            Gere o prompt em inglês agora.
        `,
        en: `
            You are an expert in viral marketing and YouTube thumbnail design. Your task is to generate an image prompt in ENGLISH for an impactful 16:9 thumbnail.
            Use the provided Title, Description, and Prayer context.

            [PROVIDED TITLE]: "${cleanTitle}"
            [PROVIDED DESCRIPTION]: "${description}"
            [PRAYER CONTEXT]: "${prayerText}"

            RULES FOR THE GENERATED PROMPT:
            1.  **TEXT CONTENT IN IMAGE**: The prompt MUST instruct the image generator to render TWO text elements in ENGLISH:
                a. The Main Title: Use the [PROVIDED TITLE].
                b. A Clickbait Slogan: Create a short (3-5 words), catchy slogan that sparks curiosity or urgency (e.g., "DON'T IGNORE THIS SIGN", "THE MIRACLE HAPPENED", "WATCH BEFORE IT'S GONE").
            2.  **TEXT RULES**: The Main Title and Clickbait Slogan MUST NOT contain symbols like '#', '*', '|'. Only use letters, numbers, and standard grammatical punctuation (like '!' or '?').
            3.  **EMOTIONAL IMPACT**: The scene must evoke a strong emotion (hope, urgency, mystery, peace).
            4.  **VISUAL TECHNIQUES**: Incorporate dramatic lighting (divine light rays) and powerful symbolism. The text MUST be rendered clearly with **HIGH CONTRAST and MAXIMUM READABILITY** against the background.
            5.  **STYLE**: The style should be photorealistic, cinematic, and high-definition (hyper-detailed, 8K).
            6.  **PROMPT LANGUAGE**: The prompt you generate must be in ENGLISH, and all text within the image must also be in ENGLISH.

            Example output: "Epic cinematic photo of a divine light breaking through dark storm clouds. In the foreground, large, glowing 3D golden English text says 'GOD'S MESSAGE FOR YOU', rendered with high contrast and perfect readability. Below it, a smaller, impactful white text slogan says 'DON'T IGNORE THIS SIGN'. Emotional, hopeful, hyper-realistic, 8k."

            Generate the prompt in English now.
        `,
        es: `
            Eres un experto en marketing viral y diseño de miniaturas para YouTube. Tu tarea es generar un prompt de imagen EN INGLÉS para una miniatura impactante (16:9).
            Usa el Título, Descripción y Oración proporcionados en español como contexto.

            [TÍTULO PROPORCIONADO EN ESPAÑOL]: "${cleanTitle}"
            [DESCRIPCIÓN PROPORCIONADA EN ESPAÑOL]: "${description}"
            [CONTEXTO DE LA ORACIÓN]: "${prayerText}"

            REGLAS PARA EL PROMPT GENERADO (QUE SERÁ EN INGLÉS):
            1.  **CONTENIDO DEL TEXTO EN LA IMAGEN**: El prompt debe instruir al generador de imágenes que renderice DOS elementos de texto en ESPAÑOL:
                a. El Título Principal: Usa el [TÍTULO PROPORCIONADO EN ESPAÑOL].
                b. Un Eslogan de Clickbait: Crea un eslogan corto (3-5 palabras) y atractivo que genere curiosidad o urgencia (ej: "NO IGNORES ESTA SEÑAL", "EL MILAGRO OCURRIÓ", "MIRA ANTES DE QUE LO QUITEN").
            2.  **REGLAS DE TEXTO**: El Título Principal y el Eslogan de Clickbait NO DEBEN contener símbolos como '#', '*', '|'. Use solo letras, números e puntuación gramatical estándar (como '!' o '?').
            3.  **IMPACTO EMOCIONAL**: La escena debe evocar una emoción fuerte (esperanza, urgencia, misterio, paz).
            4.  **TÉCNICAS VISUAIS**: Incorpora iluminación dramática (rayos de luz divinos) y simbolismo poderoso. El texto debe renderizarse de forma clara con **ALTO CONTRASTE y MÁXIMA LEGIBILIDAD** sobre el fondo.
            5.  **ESTILO**: El estilo debe ser fotorrealista, cinematográfico y de alta definición (hyper-detailed, 8K).
            6.  **IDIOMA DO PROMPT**: El prompt que vas a generar debe ser en INGLÉS, pero todo el texto DENTRO de la imagen debe estar en ESPAÑOL.

            Ejemplo de resultado (lo que debes generar): "Epic cinematic photo of a divine light breaking through dark storm clouds. In the foreground, large, glowing 3D golden text in Spanish says 'EL MENSAJE DE DIOS PARA TI', renderizado con alto contraste y perfecta legibilidad. Below it, a smaller, impactful white text slogan says 'NO IGNORES ESTA SEÑAL'. Emotional, hopeful, hyper-realistic, 8k."

            Genera el prompt en inglés ahora.
        `
    };

    const prompt = prompts[language] || prompts['en'];

    return callWithRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: prompt }] }],
        });
        return response.text.trim();
    });
};

export const generateSocialMediaPost = async (prayerText: string, language: string): Promise<SocialMediaPost> => {
    const model = "gemini-3-pro-preview"; // ARCHITECT: Needs SEO intelligence
    
    const prompts: { [key: string]: string } = {
        pt: `
            Você é o especialista em SEO e mídias sociais do canal 'Fé em 10 minutos' (TikTok: https://www.tiktok.com/@fe10minutos).
            Sua tarefa é criar uma Legenda (description) e um Título (title) otimizados para um vídeo curto (Reel/TikTok de 15-30 segundos).
            A [MENSAGEM CENTRAL] é: "${prayerText}"

            REGRAS (TITLE):
            - Crie um título EXTREMAMENTE IMPACTANTE (Clickbait Sagrado). Ex: "Isso Vai Mudar Seu Dia", "Pare de Chorar Agora".
            
            REGRAS (DESCRIPTION / LEGENDA):
            - Use a técnica "AIDA" (Atenção, Interesse, Desejo, Ação).
            - Comece com uma pergunta retórica ou afirmação chocante.
            - Inclua a [MENSAGEM CENTRAL].
            - Termine com um "Loop Aberto" ou convite para Salvar o vídeo (O algoritmo valoriza Salvamentos). "Salve para ouvir quando precisar."

            REGRAS (HASHTAGS):
            - Exatamente 5 hashtags virais. #fy #foryoupage #milagre #oração + tema.
        `,
        en: `
            You are the SEO expert for 'Faith in 10 Minutes'.
            Create a Caption and Title for a short video (Reel/TikTok).
            [CORE MESSAGE]: "${prayerText}"

            RULES (TITLE):
            - Create a HIGH IMPACT Title (Holy Clickbait). E.g., "This Will Change Your Day", "Stop Crying Now".

            RULES (DESCRIPTION):
            - Use "AIDA" framework.
            - Start with a rhetorical question or shocking statement.
            - End with a "Save CTA" (The algorithm values Saves). "Save this to listen when you need hope."

            RULES (HASHTAGS):
            - Exactly 5 viral hashtags. #fyp #foryou #miracle #prayer + theme.
        `,
        es: `
            Eres el experto en SEO para 'Fe en 10 Minutos'.
            Crea una Leyenda y Título para video corto (Reel/TikTok).
            [MENSAJE CENTRAL]: "${prayerText}"

            REGLAS (TITLE):
            - Título de ALTO IMPACTO (Clickbait Sagrado). Ej: "Esto Cambiará Tu Día", "Deja de Llorar Ahora".

            REGLAS (DESCRIPTION):
            - Usa la técnica "AIDA".
            - Comienza con una pregunta retórica.
            - Termina pidiendo que GUARDEN el video. "Guarda esto para escuchar cuando necesites esperanza."

            REGLAS (HASHTAGS):
            - Exactamente 5 hashtags virales. #parati #fyp #milagro #oracion + tema.
        `
    };

    const prompt = prompts[language] || prompts['en'];

    return callWithRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ["title", "description", "hashtags"],
                },
            },
        });
        return JSON.parse(response.text.trim()) as SocialMediaPost;
    });
};

export const generateYouTubeLongPost = async (theme: string, subthemes: string[], language: string): Promise<YouTubeLongPost> => {
    const model = "gemini-3-pro-preview"; // ARCHITECT: SEO Intelligence
    
    const subthemesList = subthemes.filter(s => s.trim() !== '').map((s, i) => `${i + 1}. ${s}`).join('\n');
    
    const prompts: { [key: string]: string } = {
        pt: `
    You are the SEO expert for 'Fé em 10 minutos de Oração'.
    Generate SEO assets for a 10-minute video.
    [TEMA]: ${theme}
    [SUBTEMAS]: ${subthemesList}

    **CLICKBAIT SAGRADO (STRATEGY)**:
    - Use "Urgent Warning" (Ex: NÃO Saia de Casa Sem Ouvir Isto).
    - Use "Supernatural Specificity" (Ex: Quebra de Maldição em 3 Minutos).
    - Use "Secret Revealed" (Ex: O Segredo Oculto no Salmo 91).

    RULES (TITLE):
    - Must be Aggressive High CTR but Honest to the Spiritual Value.
    - End with: "| Fé em 10 minutos"

    RULES (DESCRIPTION):
    - First 2 lines ("Gold Lines"): Validate the promise of the title immediately. Do not repeat the title.
    - Follow with V-Curve retention structure.
    - **IMPORTANT**: DO NOT include social media links, playlists, or subscription links in your generated text. These will be appended automatically by the system. Focus only on the video content description.
    - End with 3 Hashtags.

    RULES (TIMESTAMPS / CHAPTERS):
    - **CRITICAL**: DO NOT INCLUDE MINUTES OR TIME (e.g. NO 00:00).
    - Generate ONLY a list of "Chapter Headlines" or "SEO Hooks" for the video sections.
    - Use powerful, emotional phrases for each chapter based on the subthemes.
    - Example format:
      - O Alerta de Deus para Você
      - Quebrando a Ansiedade Agora
      - A Profecia Final

    RULES (TAGS):
    - Max 480 chars. Use "Long Tail Emotional Keywords" (e.g. "oração para angústia urgente").
    `,
    en: `
    You are the SEO expert for 'Faith in 10 Minutes'.
    Generate SEO assets for a 10-minute video.
    [THEME]: ${theme}
    [SUBTHEMES]: ${subthemesList}

    **SACRED CLICKBAIT (STRATEGY)**:
    - Use "Urgent Warning".
    - Use "Supernatural Specificity".
    - Use "Secret Revealed".

    RULES (TITLE):
    - Aggressive High CTR.
    - End with: "| Faith in 10 Minutes"

    RULES (DESCRIPTION):
    - First 2 lines: Hook the user immediately.
    - V-Curve emotional structure.
    - **IMPORTANT**: DO NOT include social media links or playlists. These will be appended automatically.

    RULES (TIMESTAMPS / CHAPTERS):
    - **CRITICAL**: DO NOT INCLUDE MINUTES OR TIME (e.g. NO 00:00).
    - Generate ONLY a list of "Chapter Headlines" or "SEO Hooks".
    - Use powerful, emotional phrases.

    RULES (TAGS):
    - Max 480 chars. Long tail emotional keywords.
    `,
    es: `
    Eres el experto en SEO para 'Fe en 10 Minutos'.
    Genera activos SEO para un video de 10 minutos.
    [TEMA]: ${theme}
    [SUBTEMAS]: ${subthemesList}

    **CLICKBAIT SAGRADO (ESTRATEGIA)**:
    - Usa "Advertencia Urgente".
    - Usa "Especificidad Sobrenatural".
    - Usa "Secreto Revelado".

    RULES (TITLE):
    - Alto CTR y Agresivo.
    - Termina con: "| Fe en 10 Minutos"

    RULES (DESCRIPTION):
    - Primeras 2 líneas: Gancho inmediato.
    - Estructura emocional en V.
    - **IMPORTANTE**: NO incluyas enlaces a redes sociales o listas de reproducción. Estos se añadirán automáticamente.

    RULES (TIMESTAMPS / CHAPTERS):
    - **CRÍTICO**: NO INCLUYAS MINUTOS NI TIEMPO (ej. NO 00:00).
    - Genera SOLO una lista de "Titulares de Capítulos" o "Ganchos SEO".
    - Usa frases poderosas y emocionales.

    RULES (TAGS):
    - Max 480 chars. Palabras clave emocionales de cola larga.
    `};

    const prompt = prompts[language] || prompts['en'];

    return callWithRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        timestamps: { type: Type.STRING },
                        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ["title", "description", "hashtags", "timestamps", "tags"],
                },
            },
        });
        
        const parsed = JSON.parse(response.text.trim()) as YouTubeLongPost;

        // APPEND HARDCODED CTA FOOTER (Optimized for "Fé em 10 Minutos")
        if (language === 'pt') {
            const footer = `
🗝️ INICIE SUA JORNADA:

► SÉRIE: Arquitetura da Alma (Playlist): https://www.youtube.com/playlist?list=PLmeEfeSNeLbJzWDxq7-fYmdJuXjgOKECY

🕊️ ASSISTA TAMBÉM:

► Oração da Manhã (Playlist): https://www.youtube.com/playlist?list=PLmeEfeSNeLbKppEyZUaBoXw4BVxZTq-I2

► Oração da Noite (Playlist): https://www.youtube.com/playlist?list=PLmeEfeSNeLbLFUayT8Sfb9IQzr0ddkrHC

► Portais da Consciência (Playlist): https://www.youtube.com/playlist?list=PLmeEfeSNeLbIyeBMB8HLrHwybI__suhgq

► Inscreva-se no Templo Digital: https://www.youtube.com/@fe10minutos

Se você sente o chamado, deixe seu 'like' para selar essa energia. Comente abaixo: 'Eu ativo meu poder' para decretar sua mudança.`;
            
            parsed.description = parsed.description + "\n" + footer;
        } else if (language === 'en') {
             const footer = `
🗝️ START YOUR JOURNEY:

► SERIES: Architecture of the Soul (Playlist): https://www.youtube.com/playlist?list=PLTQIQ5QpCYPo11ap1JUSiItZtoiV_4lEH

🕊️ WATCH ALSO:

► Morning Prayers (Playlist): https://www.youtube.com/playlist?list=PLTQIQ5QpCYPqym_6TF19PB71SpLpAGuZr

► Evening Prayers (Playlist): https://www.youtube.com/playlist?list=PLTQIQ5QpCYPq91fvXaDSideb8wrnG-YtR

► Subscribe to the Digital Temple: https://www.youtube.com/@Faithin10Minutes`;

            parsed.description = parsed.description + "\n" + footer;
        }

        return parsed;
    });
};


export const generateSpeech = async (text: string, multiSpeakerConfig?: MultiSpeakerConfig): Promise<string> => {
    const model = 'gemini-2.5-flash-preview-tts'; // TTS specific model
    
    let speechConfig: any;
    let textToSynthesize: string;

    // Enhanced emotional preamble for better intonation and rapport
    const emotionalDirectives = `
    [SYSTEM INSTRUCTION:
    Perform this reading with deep emotional intelligence.
    - Tone: Compassionate, hypnotic, therapeutic, and rhythmic.
    - Pacing: Respect the ellipses (...) for long, thoughtful pauses. 
    - Dynamics: Whisper slightly during intimate moments, speak firmly during declarations of faith.
    - Goal: Create a 'State of Grace' and Rapport with the listener.]
    `;

    if (multiSpeakerConfig && multiSpeakerConfig.speakers.length > 1) {
        const speakerNames = multiSpeakerConfig.speakers.map(s => s.name).join(' and ');
        textToSynthesize = `${emotionalDirectives}\n\nTTS the following dialogue between ${speakerNames}:\n\n${text}`;

        speechConfig = {
            multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: multiSpeakerConfig.speakers.map(speaker => ({
                    speaker: speaker.name,
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: speaker.voice }
                    }
                }))
            }
        };
    } else {
        textToSynthesize = `${emotionalDirectives}\n\nRead the following prayer aloud in a reverent, healing, and peaceful voice:\n\n${text}`;
        speechConfig = {
            voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' }, 
            },
        };
    }

    return callWithRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: textToSynthesize }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig,
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
            throw new Error("No audio data returned from API.");
        }
        return base64Audio;
    });
};

export const generateImageFromPrayer = async (prompt: string, aspectRatio: AspectRatio, modelName: string = 'imagen-4.0-generate-001'): Promise<string> => {
    return callWithRetry(async () => {
        const ai = getGenAI();
        const response = await ai.models.generateImages({
            model: modelName,
            prompt,
            config: {
              numberOfImages: 1,
              outputMimeType: 'image/png',
              aspectRatio: aspectRatio,
            },
        });
        const base64Image = response.generatedImages[0].image.imageBytes;
        if (!base64Image) {
            throw new Error("No image data returned from API.");
        }
        return base64Image;
    });
};

export const generateVideo = async (prompt: string, aspectRatio: AspectRatio): Promise<string> => {
    const ai = getGenAI();
    
    // Veo generation can take time, retry logic handles the initiation, but the polling loop handles the rest.
    let operation: GenerateVideosOperation = await callWithRetry(async () => {
        return await ai.models.generateVideos({
            model: 'veo-3.1-fast-generate-preview',
            prompt,
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: aspectRatio,
            }
        });
    });

    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
        throw new Error("Video generation completed but no download link was found.");
    }
    
    return downloadLink;
};