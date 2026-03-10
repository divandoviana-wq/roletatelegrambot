require("dotenv").config();
const { Telegraf } = require("telegraf");
const bot = new Telegraf(process.env.BOT_8727782812:AAE-j71DC0bvWg_hb7rgoTCNuo-J23cYOIg);
// ===============================
// CONFIGURAÇÃO
// ===============================
const SHORT_WINDOW = 10;
const LONG_WINDOW = 30;

const MAX_HISTORY = 200;
const MIN_SCORE_TO_ENTER = 70;
const COOLDOWN_ROUNDS = 5; // esperar 5 rodadas após uma entrada

// coloque aqui links de imagem/gif se quiser
const WIN_IMAGE_URL = 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif';
const LOSS_IMAGE_URL = 'https://media.giphy.com/media/3o6ZtaO9BZHcOjmErm/giphy.gif';

// ===============================
// ESTADO
// ===============================
let history = [];
let cooldownRemaining = 0;
let lastEntryKey = null;
let pendingEntry = null; // guarda entrada aguardando resultado

// estatísticas
let stats = {
  totalEntries: 0,
  cooldownSkips: 0,
  wins: 0,
  loss: 0
};

// ===============================
// FUNÇÕES AUXILIARES
// ===============================
function getDozen(num) {
  if (num >= 1 && num <= 12) return 'D1';
  if (num >= 13 && num <= 24) return 'D2';
  if (num >= 25 && num <= 36) return 'D3';
  return 'ZERO';
}

function percent(hit, total) {
  if (!total) return 0;
  return (hit / total) * 100;
}

function round2(n) {
  return Number(n.toFixed(2));
}

function formatDozenLabel(d) {
  if (d === 'D1') return 'D1 (1-12)';
  if (d === 'D2') return 'D2 (13-24)';
  if (d === 'D3') return 'D3 (25-36)';
  return 'ZERO';
}

function formatPairName(pair) {
  return `${formatDozenLabel(pair[0])} + ${formatDozenLabel(pair[1])}`;
}

function analyzePair(results, pair) {
  const valid = results.filter((n) => n >= 1 && n <= 36);
  const hits = valid.filter((n) => pair.includes(getDozen(n))).length;
  const total = valid.length;

  return {
    hits,
    total,
    pct: round2(percent(hits, total))
  };
}

function splitTrendAnalysis(results, pair, firstSize, secondSize) {
  const valid = results.filter((n) => n >= 1 && n <= 36);
  const totalNeeded = firstSize + secondSize;

  if (valid.length < totalNeeded) {
    return {
      enoughData: false,
      firstPct: 0,
      secondPct: 0,
      growth: false
    };
  }

  const slice = valid.slice(-totalNeeded);
  const firstPart = slice.slice(0, firstSize);
  const secondPart = slice.slice(firstSize);

  const first = analyzePair(firstPart, pair);
  const second = analyzePair(secondPart, pair);

  return {
    enoughData: true,
    firstPct: first.pct,
    secondPct: second.pct,
    growth: second.pct > first.pct
  };
}

function computeScore(shortPct, longPct, shortTrend, longTrend) {
  let score = 0;

  score += shortPct * 0.5;
  score += longPct * 0.3;

  if (shortTrend) score += 10;
  if (longTrend) score += 10;
  if (shortPct > longPct) score += 10;

  return round2(score);
}

function getConfidence(score) {
  if (score >= 85) return 'ALTA';
  if (score >= 70) return 'BOA';
  if (score >= 60) return 'MÉDIA';
  return 'BAIXA';
}

function evaluatePair(historyData, pair) {
  const shortResults = historyData.slice(-SHORT_WINDOW);
  const longResults = historyData.slice(-LONG_WINDOW);

  const short = analyzePair(shortResults, pair);
  const long = analyzePair(longResults, pair);

  const shortTrend = splitTrendAnalysis(historyData, pair, 5, 5);
  const longTrend = splitTrendAnalysis(historyData, pair, 15, 15);

  const score = computeScore(
    short.pct,
    long.pct,
    shortTrend.growth,
    longTrend.growth
  );

  return {
    pairName: pair.join(' + '),
    pairLabel: formatPairName(pair),
    pair,
    shortPct: short.pct,
    longPct: long.pct,
    shortHits: short.hits,
    shortTotal: short.total,
    longHits: long.hits,
    longTotal: long.total,
    shortTrendPrev: shortTrend.firstPct,
    shortTrendNow: shortTrend.secondPct,
    longTrendPrev: longTrend.firstPct,
    longTrendNow: longTrend.secondPct,
    shortTrendUp: shortTrend.growth,
    longTrendUp: longTrend.growth,
    score,
    confidence: getConfidence(score)
  };
}

function evaluateDozensStrategy(historyData) {
  if (historyData.length < SHORT_WINDOW) {
    return {
      ranking: [],
      best: null,
      signal: null
    };
  }

  const pairs = [
    ['D1', 'D2'],
    ['D1', 'D3'],
    ['D2', 'D3']
  ];

  const results = pairs.map((pair) => evaluatePair(historyData, pair));
  results.sort((a, b) => b.score - a.score);

  const best = results[0] || null;
  const signal = best && best.score >= MIN_SCORE_TO_ENTER ? best : null;

  return {
    ranking: results,
    best,
    signal
  };
}

function formatBestScenarioMessage(best) {
  if (!best) {
    return 'Sem dados suficientes para análise.';
  }

  return [
    '📌 MELHOR CENÁRIO',
    '',
    `Par: ${best.pairLabel}`,
    `Score: ${best.score}`,
    `Confiança: ${best.confidence}`,
    `Curto (${SHORT_WINDOW}): ${best.shortPct}%`,
    `Longo (${LONG_WINDOW}): ${best.longPct}%`
  ].join('\n');
}

function formatEntryMessage(signal) {
  return [
    '🚨 ENTRADA LIBERADA',
    '',
    'Jogar em:',
    `${signal.pairLabel}`,
    '',
    `Score: ${signal.score}`,
    `Confiança: ${signal.confidence}`
  ].join('\n');
}

function getAssertividade() {
  const total = stats.wins + stats.loss;
  if (!total) return 0;
  return round2((stats.wins / total) * 100);
}

function formatScoreboard() {
  return [
    '📊 Placar',
    `Wins: ${stats.wins}`,
    `Loss: ${stats.loss}`,
    `Assertividade: ${getAssertividade()}%`
  ].join('\n');
}

function formatWinText() {
  return [
    '🏆 WIN',
    '',
    formatScoreboard(),
    '',
    '⏳ AGUARDANDO PRÓXIMA JANELA'
  ].join('\n');
}

function formatLossText() {
  return [
    '😡 LOSS',
    '',
    formatScoreboard(),
    '',
    '⏳ AGUARDANDO PRÓXIMA JANELA'
  ].join('\n');
}

function formatCooldownMessage(best) {
  return [
    '⏳ AGUARDANDO PRÓXIMA JANELA',
    '',
    `Rodadas restantes: ${cooldownRemaining}`,
    best ? `Melhor par atual: ${best.pairLabel}` : 'Sem melhor par disponível',
    best ? `Score atual: ${best.score}` : ''
  ].filter(Boolean).join('\n');
}

function formatStatusMessage() {
  const analysis = evaluateDozensStrategy(history);

  const lines = [
    '📌 STATUS DO BOT',
    '',
    `Histórico armazenado: ${history.length}`,
    `Último número: ${history.length ? history[history.length - 1] : 'nenhum'}`,
    `Entrada mínima por score: ${MIN_SCORE_TO_ENTER}`,
    `Cooldown atual: ${cooldownRemaining} rodada(s)`,
    `Entrada pendente: ${pendingEntry ? 'SIM' : 'NÃO'}`
  ];

  if (analysis.best) {
    lines.push(
      '',
      `Melhor par atual: ${analysis.best.pairLabel}`,
      `Score: ${analysis.best.score}`,
      `Confiança: ${analysis.best.confidence}`,
      `Curto: ${analysis.best.shortPct}%`,
      `Longo: ${analysis.best.longPct}%`
    );
  }

  lines.push(
    '',
    '📈 ESTATÍSTICAS',
    `Entradas disparadas: ${stats.totalEntries}`,
    `Rodadas bloqueadas por cooldown: ${stats.cooldownSkips}`,
    `Wins: ${stats.wins}`,
    `Loss: ${stats.loss}`,
    `Assertividade: ${getAssertividade()}%`
  );

  return lines.join('\n');
}

function formatUltimosMessage(limit = 20) {
  if (!history.length) {
    return 'Ainda não há resultados no histórico.';
  }

  const recent = history.slice(-limit);
  return `🕘 Últimos ${recent.length} números:\n${recent.join(' ')}`;
}

function createEntryKey(signal) {
  return `${history.length}-${signal.pairName}-${signal.score}`;
}

function checkEntryResult(number) {
  if (!pendingEntry) return null;

  const dozen = getDozen(number);
  const isWin = pendingEntry.pair.includes(dozen);

  pendingEntry = null;

  if (isWin) {
    stats.wins += 1;
    return { isWin: true };
  } else {
    stats.loss += 1;
    return { isWin: false };
  }
}

// ===============================
// FUNÇÃO PRINCIPAL
// ===============================
function addRouletteResult(number) {
  if (Number.isNaN(number) || number < 0 || number > 36) {
    return {
      ok: false,
      message: 'Número inválido. Envie um valor entre 0 e 36.'
    };
  }

  const outputs = [];
  let resultStatus = null;

  // se havia entrada pendente, o número atual resolve ela
  if (pendingEntry) {
    resultStatus = checkEntryResult(number);
  }

  history.push(number);

  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  if (cooldownRemaining > 0) {
    cooldownRemaining -= 1;
  }

  if (resultStatus) {
    outputs.push(resultStatus.isWin ? 'WIN_IMAGE' : 'LOSS_IMAGE');
    outputs.push(resultStatus.isWin ? formatWinText() : formatLossText());
  }

  const analysis = evaluateDozensStrategy(history);

  if (!pendingEntry) {
    if (cooldownRemaining === 0 && analysis.signal) {
      const entryKey = createEntryKey(analysis.signal);

      if (entryKey !== lastEntryKey) {
        lastEntryKey = entryKey;
        pendingEntry = {
          pair: analysis.signal.pair,
          pairLabel: analysis.signal.pairLabel,
          score: analysis.signal.score
        };
        outputs.push(formatEntryMessage(analysis.signal));
        cooldownRemaining = COOLDOWN_ROUNDS;
        stats.totalEntries += 1;
      } else if (!resultStatus) {
        outputs.push(formatBestScenarioMessage(analysis.best));
      }
    } else if (cooldownRemaining > 0 && !resultStatus) {
      stats.cooldownSkips += 1;
      outputs.push(formatCooldownMessage(analysis.best));
    } else if (!resultStatus) {
      outputs.push(formatBestScenarioMessage(analysis.best));
    }
  }

  return {
    ok: true,
    outputs
  };
}

// ===============================
// TELEGRAM
// ===============================
bot.start((ctx) => {
  return ctx.reply(
    [
      '✅ Bot online',
      '',
      'Regras da versão atual:',
      `- Entra quando o melhor par tiver score >= ${MIN_SCORE_TO_ENTER}`,
      '- Usa sempre o par de 2 dúzias com score mais alto',
      `- Depois de entrar, espera ${COOLDOWN_ROUNDS} rodadas`,
      '- Faz apenas 1 entrada por rodada',
      '- Quando sair o próximo número, confere WIN ou LOSS',
      '',
      'Comandos:',
      '/status',
      '/historico',
      '/ultimos',
      '/duzias',
      '/placar',
      '/reset'
    ].join('\n')
  );
});

bot.command('status', (ctx) => {
  return ctx.reply(formatStatusMessage());
});

bot.command('historico', (ctx) => {
  if (!history.length) {
    return ctx.reply('Ainda não há resultados no histórico.');
  }

  return ctx.reply(`📚 Histórico completo (${history.length}):\n${history.join(' ')}`);
});

bot.command('ultimos', (ctx) => {
  return ctx.reply(formatUltimosMessage(20));
});

bot.command('duzias', (ctx) => {
  const analysis = evaluateDozensStrategy(history);
  return ctx.reply(formatBestScenarioMessage(analysis.best));
});

bot.command('placar', (ctx) => {
  return ctx.reply(
    [
      '🏆 WIN',
      '',
      formatScoreboard()
    ].join('\n')
  );
});

bot.command('reset', (ctx) => {
  history = [];
  cooldownRemaining = 0;
  lastEntryKey = null;
  pendingEntry = null;
  stats = {
    totalEntries: 0,
    cooldownSkips: 0,
    wins: 0,
    loss: 0
  };
  return ctx.reply('✅ Histórico, placar e cooldown resetados.');
});

bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text.trim();

    if (text.startsWith('/')) return;

    const numbers = text
      .split(/\s+/)
      .map((n) => Number(n))
      .filter((n) => !Number.isNaN(n));

    if (!numbers.length) {
      return ctx.reply('Envie um número de 0 a 36 ou vários separados por espaço.');
    }

    for (const num of numbers) {
      const result = addRouletteResult(num);

      if (!result.ok) {
        await ctx.reply(result.message);
        continue;
      }

      for (const output of result.outputs) {
        if (output === 'WIN_IMAGE') {
          await ctx.replyWithAnimation(WIN_IMAGE_URL).catch(() => {});
        } else if (output === 'LOSS_IMAGE') {
          await ctx.replyWithAnimation(LOSS_IMAGE_URL).catch(() => {});
        } else {
          await ctx.reply(output);
        }
      }
    }
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    return ctx.reply('Ocorreu um erro ao processar sua mensagem.');
  }
});

bot.launch()
  .then(() => {
    console.log('Bot rodando...');
  })
  .catch((error) => {
    console.error('Erro ao iniciar o bot:', error);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
=======
const { Telegraf } = require('telegraf');
const bot = new Telegraf('8727782812:AAE-j71DC0bvWg_hb7rgoTCNuo-J23cYOIg');
// ===============================
// CONFIGURAÇÃO
// ===============================
const SHORT_WINDOW = 10;
const LONG_WINDOW = 30;

const MAX_HISTORY = 200;
const MIN_SCORE_TO_ENTER = 70;
const COOLDOWN_ROUNDS = 5; // esperar 5 rodadas após uma entrada

// coloque aqui links de imagem/gif se quiser
const WIN_IMAGE_URL = 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif';
const LOSS_IMAGE_URL = 'https://media.giphy.com/media/3o6ZtaO9BZHcOjmErm/giphy.gif';

// ===============================
// ESTADO
// ===============================
let history = [];
let cooldownRemaining = 0;
let lastEntryKey = null;
let pendingEntry = null; // guarda entrada aguardando resultado

// estatísticas
let stats = {
  totalEntries: 0,
  cooldownSkips: 0,
  wins: 0,
  loss: 0
};

// ===============================
// FUNÇÕES AUXILIARES
// ===============================
function getDozen(num) {
  if (num >= 1 && num <= 12) return 'D1';
  if (num >= 13 && num <= 24) return 'D2';
  if (num >= 25 && num <= 36) return 'D3';
  return 'ZERO';
}

function percent(hit, total) {
  if (!total) return 0;
  return (hit / total) * 100;
}

function round2(n) {
  return Number(n.toFixed(2));
}

function formatDozenLabel(d) {
  if (d === 'D1') return 'D1 (1-12)';
  if (d === 'D2') return 'D2 (13-24)';
  if (d === 'D3') return 'D3 (25-36)';
  return 'ZERO';
}

function formatPairName(pair) {
  return `${formatDozenLabel(pair[0])} + ${formatDozenLabel(pair[1])}`;
}

function analyzePair(results, pair) {
  const valid = results.filter((n) => n >= 1 && n <= 36);
  const hits = valid.filter((n) => pair.includes(getDozen(n))).length;
  const total = valid.length;

  return {
    hits,
    total,
    pct: round2(percent(hits, total))
  };
}

function splitTrendAnalysis(results, pair, firstSize, secondSize) {
  const valid = results.filter((n) => n >= 1 && n <= 36);
  const totalNeeded = firstSize + secondSize;

  if (valid.length < totalNeeded) {
    return {
      enoughData: false,
      firstPct: 0,
      secondPct: 0,
      growth: false
    };
  }

  const slice = valid.slice(-totalNeeded);
  const firstPart = slice.slice(0, firstSize);
  const secondPart = slice.slice(firstSize);

  const first = analyzePair(firstPart, pair);
  const second = analyzePair(secondPart, pair);

  return {
    enoughData: true,
    firstPct: first.pct,
    secondPct: second.pct,
    growth: second.pct > first.pct
  };
}

function computeScore(shortPct, longPct, shortTrend, longTrend) {
  let score = 0;

  score += shortPct * 0.5;
  score += longPct * 0.3;

  if (shortTrend) score += 10;
  if (longTrend) score += 10;
  if (shortPct > longPct) score += 10;

  return round2(score);
}

function getConfidence(score) {
  if (score >= 85) return 'ALTA';
  if (score >= 70) return 'BOA';
  if (score >= 60) return 'MÉDIA';
  return 'BAIXA';
}

function evaluatePair(historyData, pair) {
  const shortResults = historyData.slice(-SHORT_WINDOW);
  const longResults = historyData.slice(-LONG_WINDOW);

  const short = analyzePair(shortResults, pair);
  const long = analyzePair(longResults, pair);

  const shortTrend = splitTrendAnalysis(historyData, pair, 5, 5);
  const longTrend = splitTrendAnalysis(historyData, pair, 15, 15);

  const score = computeScore(
    short.pct,
    long.pct,
    shortTrend.growth,
    longTrend.growth
  );

  return {
    pairName: pair.join(' + '),
    pairLabel: formatPairName(pair),
    pair,
    shortPct: short.pct,
    longPct: long.pct,
    shortHits: short.hits,
    shortTotal: short.total,
    longHits: long.hits,
    longTotal: long.total,
    shortTrendPrev: shortTrend.firstPct,
    shortTrendNow: shortTrend.secondPct,
    longTrendPrev: longTrend.firstPct,
    longTrendNow: longTrend.secondPct,
    shortTrendUp: shortTrend.growth,
    longTrendUp: longTrend.growth,
    score,
    confidence: getConfidence(score)
  };
}

function evaluateDozensStrategy(historyData) {
  if (historyData.length < SHORT_WINDOW) {
    return {
      ranking: [],
      best: null,
      signal: null
    };
  }

  const pairs = [
    ['D1', 'D2'],
    ['D1', 'D3'],
    ['D2', 'D3']
  ];

  const results = pairs.map((pair) => evaluatePair(historyData, pair));
  results.sort((a, b) => b.score - a.score);

  const best = results[0] || null;
  const signal = best && best.score >= MIN_SCORE_TO_ENTER ? best : null;

  return {
    ranking: results,
    best,
    signal
  };
}

function formatBestScenarioMessage(best) {
  if (!best) {
    return 'Sem dados suficientes para análise.';
  }

  return [
    '📌 MELHOR CENÁRIO',
    '',
    `Par: ${best.pairLabel}`,
    `Score: ${best.score}`,
    `Confiança: ${best.confidence}`,
    `Curto (${SHORT_WINDOW}): ${best.shortPct}%`,
    `Longo (${LONG_WINDOW}): ${best.longPct}%`
  ].join('\n');
}

function formatEntryMessage(signal) {
  return [
    '🚨 ENTRADA LIBERADA',
    '',
    'Jogar em:',
    `${signal.pairLabel}`,
    '',
    `Score: ${signal.score}`,
    `Confiança: ${signal.confidence}`
  ].join('\n');
}

function getAssertividade() {
  const total = stats.wins + stats.loss;
  if (!total) return 0;
  return round2((stats.wins / total) * 100);
}

function formatScoreboard() {
  return [
    '📊 Placar',
    `Wins: ${stats.wins}`,
    `Loss: ${stats.loss}`,
    `Assertividade: ${getAssertividade()}%`
  ].join('\n');
}

function formatWinText() {
  return [
    '🏆 WIN',
    '',
    formatScoreboard(),
    '',
    '⏳ AGUARDANDO PRÓXIMA JANELA'
  ].join('\n');
}

function formatLossText() {
  return [
    '😡 LOSS',
    '',
    formatScoreboard(),
    '',
    '⏳ AGUARDANDO PRÓXIMA JANELA'
  ].join('\n');
}

function formatCooldownMessage(best) {
  return [
    '⏳ AGUARDANDO PRÓXIMA JANELA',
    '',
    `Rodadas restantes: ${cooldownRemaining}`,
    best ? `Melhor par atual: ${best.pairLabel}` : 'Sem melhor par disponível',
    best ? `Score atual: ${best.score}` : ''
  ].filter(Boolean).join('\n');
}

function formatStatusMessage() {
  const analysis = evaluateDozensStrategy(history);

  const lines = [
    '📌 STATUS DO BOT',
    '',
    `Histórico armazenado: ${history.length}`,
    `Último número: ${history.length ? history[history.length - 1] : 'nenhum'}`,
    `Entrada mínima por score: ${MIN_SCORE_TO_ENTER}`,
    `Cooldown atual: ${cooldownRemaining} rodada(s)`,
    `Entrada pendente: ${pendingEntry ? 'SIM' : 'NÃO'}`
  ];

  if (analysis.best) {
    lines.push(
      '',
      `Melhor par atual: ${analysis.best.pairLabel}`,
      `Score: ${analysis.best.score}`,
      `Confiança: ${analysis.best.confidence}`,
      `Curto: ${analysis.best.shortPct}%`,
      `Longo: ${analysis.best.longPct}%`
    );
  }

  lines.push(
    '',
    '📈 ESTATÍSTICAS',
    `Entradas disparadas: ${stats.totalEntries}`,
    `Rodadas bloqueadas por cooldown: ${stats.cooldownSkips}`,
    `Wins: ${stats.wins}`,
    `Loss: ${stats.loss}`,
    `Assertividade: ${getAssertividade()}%`
  );

  return lines.join('\n');
}

function formatUltimosMessage(limit = 20) {
  if (!history.length) {
    return 'Ainda não há resultados no histórico.';
  }

  const recent = history.slice(-limit);
  return `🕘 Últimos ${recent.length} números:\n${recent.join(' ')}`;
}

function createEntryKey(signal) {
  return `${history.length}-${signal.pairName}-${signal.score}`;
}

function checkEntryResult(number) {
  if (!pendingEntry) return null;

  const dozen = getDozen(number);
  const isWin = pendingEntry.pair.includes(dozen);

  pendingEntry = null;

  if (isWin) {
    stats.wins += 1;
    return { isWin: true };
  } else {
    stats.loss += 1;
    return { isWin: false };
  }
}

// ===============================
// FUNÇÃO PRINCIPAL
// ===============================
function addRouletteResult(number) {
  if (Number.isNaN(number) || number < 0 || number > 36) {
    return {
      ok: false,
      message: 'Número inválido. Envie um valor entre 0 e 36.'
    };
  }

  const outputs = [];
  let resultStatus = null;

  // se havia entrada pendente, o número atual resolve ela
  if (pendingEntry) {
    resultStatus = checkEntryResult(number);
  }

  history.push(number);

  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  if (cooldownRemaining > 0) {
    cooldownRemaining -= 1;
  }

  if (resultStatus) {
    outputs.push(resultStatus.isWin ? 'WIN_IMAGE' : 'LOSS_IMAGE');
    outputs.push(resultStatus.isWin ? formatWinText() : formatLossText());
  }

  const analysis = evaluateDozensStrategy(history);

  if (!pendingEntry) {
    if (cooldownRemaining === 0 && analysis.signal) {
      const entryKey = createEntryKey(analysis.signal);

      if (entryKey !== lastEntryKey) {
        lastEntryKey = entryKey;
        pendingEntry = {
          pair: analysis.signal.pair,
          pairLabel: analysis.signal.pairLabel,
          score: analysis.signal.score
        };
        outputs.push(formatEntryMessage(analysis.signal));
        cooldownRemaining = COOLDOWN_ROUNDS;
        stats.totalEntries += 1;
      } else if (!resultStatus) {
        outputs.push(formatBestScenarioMessage(analysis.best));
      }
    } else if (cooldownRemaining > 0 && !resultStatus) {
      stats.cooldownSkips += 1;
      outputs.push(formatCooldownMessage(analysis.best));
    } else if (!resultStatus) {
      outputs.push(formatBestScenarioMessage(analysis.best));
    }
  }

  return {
    ok: true,
    outputs
  };
}

// ===============================
// TELEGRAM
// ===============================
bot.start((ctx) => {
  return ctx.reply(
    [
      '✅ Bot online',
      '',
      'Regras da versão atual:',
      `- Entra quando o melhor par tiver score >= ${MIN_SCORE_TO_ENTER}`,
      '- Usa sempre o par de 2 dúzias com score mais alto',
      `- Depois de entrar, espera ${COOLDOWN_ROUNDS} rodadas`,
      '- Faz apenas 1 entrada por rodada',
      '- Quando sair o próximo número, confere WIN ou LOSS',
      '',
      'Comandos:',
      '/status',
      '/historico',
      '/ultimos',
      '/duzias',
      '/placar',
      '/reset'
    ].join('\n')
  );
});

bot.command('status', (ctx) => {
  return ctx.reply(formatStatusMessage());
});

bot.command('historico', (ctx) => {
  if (!history.length) {
    return ctx.reply('Ainda não há resultados no histórico.');
  }

  return ctx.reply(`📚 Histórico completo (${history.length}):\n${history.join(' ')}`);
});

bot.command('ultimos', (ctx) => {
  return ctx.reply(formatUltimosMessage(20));
});

bot.command('duzias', (ctx) => {
  const analysis = evaluateDozensStrategy(history);
  return ctx.reply(formatBestScenarioMessage(analysis.best));
});

bot.command('placar', (ctx) => {
  return ctx.reply(
    [
      '🏆 WIN',
      '',
      formatScoreboard()
    ].join('\n')
  );
});

bot.command('reset', (ctx) => {
  history = [];
  cooldownRemaining = 0;
  lastEntryKey = null;
  pendingEntry = null;
  stats = {
    totalEntries: 0,
    cooldownSkips: 0,
    wins: 0,
    loss: 0
  };
  return ctx.reply('✅ Histórico, placar e cooldown resetados.');
});

bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text.trim();

    if (text.startsWith('/')) return;

    const numbers = text
      .split(/\s+/)
      .map((n) => Number(n))
      .filter((n) => !Number.isNaN(n));

    if (!numbers.length) {
      return ctx.reply('Envie um número de 0 a 36 ou vários separados por espaço.');
    }

    for (const num of numbers) {
      const result = addRouletteResult(num);

      if (!result.ok) {
        await ctx.reply(result.message);
        continue;
      }

      for (const output of result.outputs) {
        if (output === 'WIN_IMAGE') {
          await ctx.replyWithAnimation(WIN_IMAGE_URL).catch(() => {});
        } else if (output === 'LOSS_IMAGE') {
          await ctx.replyWithAnimation(LOSS_IMAGE_URL).catch(() => {});
        } else {
          await ctx.reply(output);
        }
      }
    }
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
    return ctx.reply('Ocorreu um erro ao processar sua mensagem.');
  }
});

bot.launch()
  .then(() => {
    console.log('Bot rodando...');
  })
  .catch((error) => {
    console.error('Erro ao iniciar o bot:', error);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
>>>>>>> 7923468f5e649d5b97500f8a07a9b86be9f5f481
process.once('SIGTERM', () => bot.stop('SIGTERM'));
