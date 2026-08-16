/**
 * 语音识别模块 - 基于 sherpa-onnx-node
 * 使用 streaming recognizer 实现实时单语言语音识别
 * 录音通过 Electron 渲染进程的 Web Audio API 采集，音频数据通过 IPC 传入
 *
 * 根据 settings.language 选择对应语言的流式模型：
 *   zh -> sherpa-onnx-streaming-paraformer-bilingual-zh-en (Paraformer, 中文为主)
 *   en -> sherpa-onnx-streaming-zipformer-en-2023-06-26 (Zipformer Transducer, 纯英文)
 * 模型文件缺失时会抛出带有下载地址的错误，需要用户自行下载解压到 models/ 目录。
 */

const path = require('path');
const fs = require('fs');

const MODELS_DIR = path.join(__dirname, '..', 'models');

/**
 * 每种语言对应的模型配置。
 * 中文用 Paraformer（encoder+decoder），英文用 Zipformer Transducer（encoder+decoder+joiner）。
 * 文件名在 spec 中显式声明，ensureModelFiles 按实际文件名校验。
 */
const LANGUAGE_MODELS = {
  zh: {
    label: '中文',
    subdir: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    type: 'paraformer',
    modelType: '',
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.int8.onnx',
    downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2',
  },
  en: {
    label: 'English',
    subdir: 'sherpa-onnx-streaming-zipformer-en-2023-06-26',
    type: 'transducer',
    modelType: '',
    encoder: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
    decoder: 'decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
    joiner: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
    downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2',
  },
};

let recognizer = null;
let stream = null;
let isRunning = false;
let currentLanguage = null;
let loadedLanguage = null;

/**
 * 校验某个语言模型的文件是否齐全，缺失时抛出带下载指引的错误
 */
function ensureModelFiles(language) {
  const spec = LANGUAGE_MODELS[language];
  if (!spec) throw new Error(`不支持的识别语言: ${language}`);

  const modelDir = path.join(MODELS_DIR, spec.subdir);
  const requiredFiles = ['tokens.txt', spec.encoder, spec.decoder, spec.joiner].filter(Boolean);
  const missing = [];
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(modelDir, f))) missing.push(f);
  }

  if (missing.length > 0) {
    const relDir = `models/${spec.subdir}/`;
    throw new Error(
      `${spec.label} 识别模型文件不完整，缺少: ${missing.join(', ')}\n` +
      `请下载并解压到 ${relDir}\n` +
      `下载地址: ${spec.downloadUrl}`
    );
  }
  return modelDir;
}

/**
 * 按语言构造 OnlineRecognizerConfig 并实例化识别器
 */
function createRecognizerForLanguage(language) {
  const sherpa = require('sherpa-onnx-node');
  const spec = LANGUAGE_MODELS[language];
  const modelDir = ensureModelFiles(language);

  let modelConfig = {
    tokens: path.join(modelDir, 'tokens.txt'),
    numThreads: 2,
    provider: 'cpu',
    debug: false,
    modelType: spec.modelType,
  };

  if (spec.type === 'paraformer') {
    // 中文 Paraformer：encoder + decoder（无 joiner）
    modelConfig.paraformer = {
      encoder: path.join(modelDir, spec.encoder),
      decoder: path.join(modelDir, spec.decoder),
    };
  } else if (spec.type === 'transducer') {
    // 英文 Zipformer Transducer：encoder + decoder + joiner
    modelConfig.transducer = {
      encoder: path.join(modelDir, spec.encoder),
      decoder: path.join(modelDir, spec.decoder),
      joiner: path.join(modelDir, spec.joiner),
    };
  } else {
    throw new Error(`未知的模型类型: ${spec.type}`);
  }

  const config = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig,
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  };

  return new sherpa.OnlineRecognizer(config);
}

/**
 * 初始化 ASR 引擎。
 * 切换语言会销毁旧的 recognizer 并加载对应语言的单语言模型。
 * @param {string} [language='zh'] - 识别语言 'zh' | 'en'
 */
async function initASR(language = 'zh') {
  const lang = language === 'en' ? 'en' : 'zh';
  currentLanguage = lang;

  // 已加载同一种语言的模型，直接创建新 stream 即可
  if (recognizer && loadedLanguage === lang) {
    stream = recognizer.createStream();
    isRunning = true;
    console.log(`[ASR] 重用已有引擎（语言: ${lang}），创建新 stream`);
    return;
  }

  // 切换语言或首次加载：销毁旧实例（若有）后重新初始化
  if (recognizer) {
    try {
      if (stream) { stream.inputFinished(); stream = null; }
    } catch (_) { /* ignore */ }
    recognizer = null;
  }

  const newRec = createRecognizerForLanguage(lang);
  recognizer = newRec;
  loadedLanguage = lang;
  stream = recognizer.createStream();
  isRunning = true;
  console.log(`[ASR] ${LANGUAGE_MODELS[lang].label} 单语言识别引擎初始化完成`);
}

/**
 * 格式化英文识别文本：转小写后，将首字母大写（每句话首字母大写）
 * @param {string} text
 * @returns {string}
 */
function formatEnglishText(text) {
  const lower = text.toLowerCase();
  // 把第一个英文字母大写，跳过前导空格/标点
  return lower.replace(/[a-z]/, (c) => c.toUpperCase());
}

/**
 * 接收渲染进程发来的音频数据进行识别
 * @param {Float32Array} samples - 16kHz 单声道音频采样
 * @returns {{ text: string, isFinal: boolean } | null}
 */
function feedAudio(samples) {
  if (!isRunning || !stream || !recognizer) return null;

  stream.acceptWaveform({ samples, sampleRate: 16000 });

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }

  const result = recognizer.getResult(stream);
  const rawText = (result.text || '').trim();
  // 英文 Zipformer 的 token 词表是大写的，转小写并首字母大写
  const text = currentLanguage === 'en' ? formatEnglishText(rawText) : rawText;
  const isEndpoint = recognizer.isEndpoint(stream);

  if (isEndpoint && text) {
    recognizer.reset(stream);
    return { text, isFinal: true };
  } else if (text) {
    return { text, isFinal: false };
  }

  return null;
}

/**
 * 停止识别
 * @returns {string} 最后的未确认文本
 */
function stopRecognition() {
  isRunning = false;

  let finalText = '';
  if (stream && recognizer) {
    try {
      stream.inputFinished();
      while (recognizer.isReady(stream)) {
        recognizer.decode(stream);
      }
      const result = recognizer.getResult(stream);
      const rawText = (result.text || '').trim();
      // 英文 Zipformer 的 token 词表是大写的，转小写并首字母大写
      finalText = currentLanguage === 'en' ? formatEnglishText(rawText) : rawText;
    } catch (_) { /* ignore teardown errors */ }
    stream = null;
  }

  console.log('[ASR] 停止录制');
  return finalText;
}

module.exports = { initASR, feedAudio, stopRecognition };
