/**
 * 词库匹配模块
 * 加载情感词库JSON，分析文本中的情绪词、填充词、犹豫词
 * 支持中文(zh)和英文(en)两种语言
 */

const fs = require('fs');
const path = require('path');

let zhEmotions = {};   // 中文情绪词库（来自 data/emotion-lexicon.json）
const enEmotions = {}; // 英文情绪词库（内置）

// ============ 中文词表 ============

// 填充词列表（语气词/口头禅）
const ZH_FILLER_WORDS = [
  '嗯', '啊', '呃', '额', '那个', '就是', '然后',
  '这个', '对吧', '是吧', '你知道', '怎么说呢',
  '反正', '基本上', '总之', '所以说', '就是说',
  '其实吧', '说实话', '对对对', '是是是'
];

// 犹豫词列表（弱化表达）
const ZH_HEDGE_WORDS = [
  '可能', '也许', '大概', '应该', '我觉得', '好像',
  '似乎', '或许', '不一定', '差不多', '算是',
  '某种程度上', '一般来说', '感觉'
];

// 笼统词 → 精准替代映射
const ZH_VAGUE_TO_PRECISE = {
  '开心': ['欣喜', '雀跃', '兴奋', '欣慰', '畅快', '满足'],
  '难过': ['心酸', '失落', '委屈', '心疼', '沮丧', '低落'],
  '害怕': ['恐惧', '焦虑', '不安', '慌张', '胆怯', '忐忑'],
  '生气': ['愤怒', '恼火', '窝火', '气愤', '不满', '暴躁'],
  '不舒服': ['压抑', '烦躁', '憋屈', '窒息', '煎熬', '疲惫'],
  '很好': ['出色', '精彩', '优秀', '惊艳', '完美', '理想'],
  '很多': ['大量', '海量', '充裕', '丰富', '密集', '可观'],
  '很快': ['迅速', '飞速', '立刻', '瞬间', '即刻', '火速'],
  '很大': ['巨大', '庞大', '显著', '惊人', '可观', '壮观'],
  '很小': ['微小', '细微', '轻微', '渺小', '微不足道', '些许'],
  '好看': ['精致', '优雅', '绚丽', '惊艳', '别致', '夺目'],
  '不好': ['糟糕', '恶劣', '拙劣', '不堪', '惨淡', '低劣'],
  '喜欢': ['热爱', '痴迷', '着迷', '钟爱', '倾心', '沉醉'],
  '讨厌': ['厌恶', '反感', '排斥', '憎恨', '鄙视', '嫌弃'],
  '觉得': ['认为', '判断', '确信', '推断', '意识到', '发现'],
  '想': ['渴望', '期待', '向往', '盼望', '企图', '打算'],
  '做': ['执行', '落实', '推进', '完成', '实施', '操作'],
  '看': ['审视', '观察', '注视', '打量', '端详', '凝视'],
  '说': ['表达', '阐述', '强调', '指出', '坦言', '声明'],
  '想想': ['反思', '回顾', '审视', '复盘', '琢磨', '斟酌']
};

// ============ 英文词表 ============

// Filler words (verbal fillers / crutch words)
const EN_FILLER_WORDS = [
  'um', 'uh', 'er', 'ah', 'like', 'you know', 'i mean',
  'sort of', 'kind of', 'basically', 'actually', 'literally',
  'honestly', 'right', 'so', 'well', 'anyway', 'i guess',
  'at the end of the day', 'you know what i mean',
  'stuff', 'things', 'whatever', 'or something'
];

// Hedge words (weakening / tentative language)
const EN_HEDGE_WORDS = [
  'maybe', 'perhaps', 'probably', 'might', 'could be',
  'i think', 'i guess', 'i suppose', 'i believe',
  'sort of', 'kind of', 'somewhat', 'possibly',
  'presumably', 'arguably', 'tends to', 'seems to',
  'appears to', 'more or less', 'i\'m not sure',
  'i\'m not certain', 'in a way', 'up to a point'
];

// Vague → precise replacement map
const EN_VAGUE_TO_PRECISE = {
  'happy': ['ecstatic', 'thrilled', 'delighted', 'elated', 'overjoyed', 'content'],
  'sad': ['devastated', 'heartbroken', 'melancholic', 'gloomy', 'despondent', 'deflated'],
  'scared': ['terrified', 'anxious', 'petrified', 'alarmed', 'apprehensive', 'uneasy'],
  'angry': ['furious', 'irritated', 'resentful', 'indignant', 'exasperated', 'livid'],
  'bad': ['terrible', 'awful', 'dreadful', 'lousy', 'subpar', 'disappointing'],
  'good': ['excellent', 'outstanding', 'superb', 'remarkable', 'stellar', 'exceptional'],
  'big': ['enormous', 'massive', 'colossal', 'substantial', 'immense', 'sweeping'],
  'small': ['tiny', 'minuscule', 'negligible', 'marginal', 'compact', 'slight'],
  'fast': ['rapid', 'swift', 'brisk', 'instantaneous', 'prompt', 'accelerated'],
  'many': ['numerous', 'countless', 'abundant', 'plentiful', 'ample', 'a multitude of'],
  'nice': ['gracious', 'charming', 'delightful', 'pleasant', 'amiable', 'thoughtful'],
  'interesting': ['fascinating', 'captivating', 'intriguing', 'compelling', 'thought-provoking', 'engrossing'],
  'important': ['crucial', 'critical', 'pivotal', 'essential', 'vital', 'indispensable'],
  'hard': ['difficult', 'challenging', 'arduous', 'demanding', 'formidable', 'grueling'],
  'easy': ['effortless', 'simple', 'straightforward', 'manageable', 'painless', 'intuitive'],
  'said': ['stated', 'declared', 'remarked', 'asserted', 'noted', 'emphasized'],
  'think': ['contend', 'maintain', 'assert', 'conclude', 'deduce', 'contend'],
  'want': ['desire', 'crave', 'yearn for', 'aspire to', 'seek', 'long for'],
  'make': ['create', 'produce', 'construct', 'build', 'forge', 'craft'],
  'look': ['examine', 'inspect', 'scrutinize', 'observe', 'survey', 'gaze']
};

// ============ 内置英文情绪词库 ============

function buildEnglishEmotions() {
  const raw = [
    // Joy (positive)
    ['happy', 'joy', 5, 'positive'], ['glad', 'joy', 5, 'positive'],
    ['joyful', 'joy', 7, 'positive'], ['delighted', 'joy', 8, 'positive'],
    ['thrilled', 'joy', 9, 'positive'], ['excited', 'joy', 8, 'positive'],
    ['ecstatic', 'joy', 9, 'positive'], ['cheerful', 'joy', 6, 'positive'],
    ['content', 'joy', 6, 'positive'], ['proud', 'joy', 7, 'positive'],
    ['grateful', 'joy', 7, 'positive'], ['hopeful', 'joy', 6, 'positive'],
    // Anger (negative)
    ['angry', 'anger', 6, 'negative'], ['mad', 'anger', 6, 'negative'],
    ['furious', 'anger', 9, 'negative'], ['irritated', 'anger', 5, 'negative'],
    ['annoyed', 'anger', 5, 'negative'], ['frustrated', 'anger', 6, 'negative'],
    ['resentful', 'anger', 7, 'negative'], ['bitter', 'anger', 6, 'negative'],
    // Sadness (negative)
    ['sad', 'sadness', 5, 'negative'], ['unhappy', 'sadness', 5, 'negative'],
    ['depressed', 'sadness', 8, 'negative'], ['miserable', 'sadness', 8, 'negative'],
    ['heartbroken', 'sadness', 9, 'negative'], ['lonely', 'sadness', 6, 'negative'],
    ['disappointed', 'sadness', 6, 'negative'], ['gloomy', 'sadness', 5, 'negative'],
    // Fear (negative)
    ['afraid', 'fear', 6, 'negative'], ['scared', 'fear', 6, 'negative'],
    ['frightened', 'fear', 7, 'negative'], ['terrified', 'fear', 9, 'negative'],
    ['anxious', 'fear', 6, 'negative'], ['nervous', 'fear', 5, 'negative'],
    ['worried', 'fear', 5, 'negative'], ['panicked', 'fear', 8, 'negative'],
    // Disgust (negative)
    ['disgusted', 'disgust', 7, 'negative'], ['revolted', 'disgust', 8, 'negative'],
    ['repulsed', 'disgust', 7, 'negative'], ['sickened', 'disgust', 7, 'negative'],
    // Surprise
    ['surprised', 'surprise', 6, 'neutral'], ['shocked', 'surprise', 8, 'neutral'],
    ['amazed', 'surprise', 7, 'positive'], ['astonished', 'surprise', 7, 'neutral'],
    ['stunned', 'surprise', 8, 'neutral']
  ];
  for (const [word, category, intensity, polarity] of raw) {
    enEmotions[word] = { category, subcategory: category.toUpperCase().slice(0, 2), intensity, polarity };
  }
}
buildEnglishEmotions();

// ============ 加载词库 ============

/**
 * 加载中文情感词库文件
 */
function loadLexicon() {
  const lexiconPath = path.join(__dirname, '..', 'data', 'emotion-lexicon.json');

  if (fs.existsSync(lexiconPath)) {
    const raw = fs.readFileSync(lexiconPath, 'utf-8');
    const data = JSON.parse(raw);
    zhEmotions = data.emotions || {};
    console.log(`[词库] 中文情绪词库加载完成，共 ${Object.keys(zhEmotions).length} 个情绪词`);
  } else {
    console.warn('[词库] emotion-lexicon.json 未找到，中文情绪词库使用空表');
    zhEmotions = {};
  }
}

/**
 * 按语言获取对应的词表
 */
function getWordLists(language) {
  if (language === 'en') {
    return {
      fillers: EN_FILLER_WORDS,
      hedges: EN_HEDGE_WORDS,
      vague: EN_VAGUE_TO_PRECISE,
      emotions: enEmotions
    };
  }
  return {
    fillers: ZH_FILLER_WORDS,
    hedges: ZH_HEDGE_WORDS,
    vague: ZH_VAGUE_TO_PRECISE,
    emotions: zhEmotions
  };
}

// ============ 分词 ============

/**
 * 简单中文分词（基于最大正向匹配 + 词表）
 */
function segmentChinese(text, dict) {
  const words = [];
  let i = 0;
  const maxLen = 6;

  while (i < text.length) {
    let matched = false;
    for (let len = Math.min(maxLen, text.length - i); len >= 2; len--) {
      const word = text.substring(i, i + len);
      if (dict.has(word)) {
        words.push(word);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      words.push(text[i]);
      i++;
    }
  }
  return words;
}

/**
 * 英文分词：按空白拆分为词，保留原始大小写用于展示，匹配时用小写
 * 支持多词短语匹配（最大正向匹配，词级别）
 */
function segmentEnglish(text, phraseSet, maxPhraseLen) {
  // 先按空白拆成原始 token
  const rawTokens = text.split(/\s+/).filter(Boolean);
  // 归一化：去标点、转小写，用于匹配
  const normTokens = rawTokens.map(t => t.toLowerCase().replace(/[^a-z']/g, ''));

  const words = [];
  let i = 0;
  while (i < rawTokens.length) {
    let matched = false;
    // 从最长短语往最短试
    for (let len = Math.min(maxPhraseLen, rawTokens.length - i); len >= 1; len--) {
      const phrase = normTokens.slice(i, i + len).join(' ').trim();
      if (len >= 2 && phraseSet.has(phrase)) {
        words.push(rawTokens.slice(i, i + len).join(' '));
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      words.push(rawTokens[i]);
      i++;
    }
  }
  return words;
}

// ============ 分析 ============

/**
 * 分析文本
 * @param {string} text - 输入文本
 * @param {string} [language='zh'] - 识别语言 'zh' | 'en'
 * @returns {Object} 分析结果
 */
function analyzeText(text, language = 'zh') {
  if (!text || !text.trim()) {
    return null;
  }

  const lang = language === 'en' ? 'en' : 'zh';
  const lists = getWordLists(lang);
  const fillerSet = new Set(lists.fillers.map(w => w.toLowerCase()));
  const hedgeSet = new Set(lists.hedges.map(w => w.toLowerCase()));
  const vagueMap = {};
  for (const k of Object.keys(lists.vague)) vagueMap[k.toLowerCase()] = lists.vague[k];

  // 构建分词用的字典
  let words;
  if (lang === 'en') {
    // 短语集合：填充词 + 犹豫词 + 笼统词（多词短语）
    const phraseSet = new Set([
      ...lists.fillers, ...lists.hedges
    ].map(w => w.toLowerCase()));
    // 笼统词里多词的也加入（如 "sort of" 不在 vague 里，但保留逻辑）
    Object.keys(lists.vague).forEach(w => phraseSet.add(w.toLowerCase()));
    const maxPhraseLen = Math.max(
      ...[...lists.fillers, ...lists.hedges, ...Object.keys(lists.vague)]
        .map(w => w.split(/\s+/).length)
    );
    words = segmentEnglish(text, phraseSet, maxPhraseLen);
  } else {
    const dict = new Set([
      ...lists.fillers,
      ...lists.hedges,
      ...Object.keys(lists.vague),
      ...Object.keys(lists.emotions)
    ]);
    words = segmentChinese(text, dict);
  }

  const totalWords = words.length;

  // 检测填充词
  const fillers = [];
  words.forEach((word, idx) => {
    if (fillerSet.has(word.toLowerCase())) {
      fillers.push({ word, position: idx });
    }
  });

  // 检测犹豫词
  const hedges = [];
  words.forEach((word, idx) => {
    if (hedgeSet.has(word.toLowerCase())) {
      hedges.push({ word, position: idx });
    }
  });

  // 检测笼统词
  const vagueWords = [];
  words.forEach((word, idx) => {
    const rep = vagueMap[word.toLowerCase()];
    if (rep) {
      vagueWords.push({ word, position: idx, alternatives: rep });
    }
  });

  // 检测情绪词
  const emotionWords = [];
  words.forEach((word, idx) => {
    const emo = lists.emotions[word.toLowerCase()];
    if (emo) {
      emotionWords.push({ word, position: idx, ...emo });
    }
  });

  // 计算表达密度
  const meaningfulWords = totalWords - fillers.length - hedges.length;
  const density = totalWords > 0 ? (meaningfulWords / totalWords) : 1;

  return {
    totalWords,
    fillers,
    hedges,
    vagueWords,
    emotionWords,
    density: Math.round(density * 100),
    suggestions: generateSuggestions(vagueWords, fillers, hedges, lang)
  };
}

// ============ 建议生成 ============

/**
 * 生成替代建议（按语言）
 */
function generateSuggestions(vagueWords, fillers, hedges, language) {
  const suggestions = [];
  const isEn = language === 'en';

  // 笼统词替代
  vagueWords.forEach(item => {
    const alts = item.alternatives.slice(0, 3);
    suggestions.push({
      type: 'vague',
      original: item.word,
      alternatives: alts,
      message: isEn
        ? `"${item.word}" → try: ${alts.join(' / ')}`
        : `「${item.word}」→ 试试更精准的：${alts.join('、')}`
    });
  });

  // 填充词提醒
  if (fillers.length >= 3) {
    const topFillers = [...new Set(fillers.map(f => f.word))].slice(0, 3);
    suggestions.push({
      type: 'filler',
      message: isEn
        ? `Too many fillers (${fillers.length}x): ${topFillers.join(', ')}. Try pausing instead`
        : `填充词偏多（${fillers.length}次）：${topFillers.join('、')}。试试用停顿替代`
    });
  }

  // 犹豫词提醒
  if (hedges.length >= 2) {
    suggestions.push({
      type: 'hedge',
      message: isEn
        ? `Hedging a lot (${hedges.length}x). Try stating it directly instead of "I think"`
        : `犹豫表达较多（${hedges.length}次）。试试把「我觉得」改成直接陈述`
    });
  }

  return suggestions;
}

// 兼容旧导出（默认中文词表）
module.exports = {
  loadLexicon,
  analyzeText,
  VAGUE_TO_PRECISE: ZH_VAGUE_TO_PRECISE,
  FILLER_WORDS: ZH_FILLER_WORDS,
  HEDGE_WORDS: ZH_HEDGE_WORDS
};
