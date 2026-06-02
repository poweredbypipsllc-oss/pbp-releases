const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ─── LRU Cache ────────────────────────────────────────────────────────────────

class LRUCache {
  constructor(maxSize = 500) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  set(key, value, ttlMs = null) {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
    const entry = { value, expires: ttlMs ? Date.now() + ttlMs : null };
    this.cache.set(key, entry);
  }
  get_(key) {
    const entry = this.get(key);
    if (!entry) return undefined;
    if (entry.expires && Date.now() > entry.expires) { this.cache.delete(key); return undefined; }
    return entry.value;
  }
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expires && Date.now() > entry.expires) { this.cache.delete(key); return false; }
    return true;
  }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
  size() { return this.cache.size; }
}

const scrapedCaseCache = new LRUCache(2000);
const pageCache = new LRUCache(200);
const queryCache = new LRUCache(100);

// ─── Lead Pre-Filtering ───────────────────────────────────────────────────────

async function isAlreadyScraped(caseNumber, supabase) {
  const key = `case:${caseNumber}`;
  if (scrapedCaseCache.has(key)) return scrapedCaseCache.get_(key);

  const { data } = await supabase
    .from('hot_leads')
    .select('id')
    .eq('case_number', caseNumber)
    .maybeSingle();

  const exists = !!data;
  scrapedCaseCache.set(key, exists);
  return exists;
}

async function filterNewCases(caseNumbers, supabase) {
  if (!caseNumbers || caseNumbers.length === 0) return [];

  const uncached = caseNumbers.filter(c => !scrapedCaseCache.has(`case:${c}`));

  if (uncached.length > 0) {
    const chunks = [];
    for (let i = 0; i < uncached.length; i += 200) chunks.push(uncached.slice(i, i + 200));

    for (const chunk of chunks) {
      const { data } = await supabase
        .from('hot_leads')
        .select('case_number')
        .in('case_number', chunk);

      const existing = new Set((data || []).map(r => r.case_number));
      chunk.forEach(c => scrapedCaseCache.set(`case:${c}`, existing.has(c)));
    }
  }

  return caseNumbers.filter(c => !scrapedCaseCache.get_(`case:${c}`));
}

function markAsScraped(caseNumber) {
  scrapedCaseCache.set(`case:${caseNumber}`, true);
}

function markBatchScraped(caseNumbers) {
  caseNumbers.forEach(c => scrapedCaseCache.set(`case:${c}`, true));
}

// ─── Compression ─────────────────────────────────────────────────────────────

async function compressJSON(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return gzip(Buffer.from(str, 'utf8'));
}

async function decompressJSON(buffer) {
  const buf = await gunzip(buffer);
  return JSON.parse(buf.toString('utf8'));
}

function compressResponseMiddleware(req, res, next) {
  const orig = res.json.bind(res);
  res.json = async (data) => {
    const str = JSON.stringify(data);
    if (str.length > 4096) {
      const compressed = await gzip(Buffer.from(str, 'utf8'));
      res.set('Content-Encoding', 'gzip');
      res.set('Content-Type', 'application/json');
      res.send(compressed);
    } else {
      orig(data);
    }
  };
  if (next) next();
}

// ─── Puppeteer Browser Pool ───────────────────────────────────────────────────

class BrowserPool {
  constructor(maxInstances = 2) {
    this.pool = [];
    this.inUse = new Set();
    this.max = maxInstances;
    this.queue = [];
    this.launchOpts = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-translate',
        '--mute-audio',
        '--js-flags=--max-old-space-size=256'
      ]
    };
  }

  async acquire(puppeteer) {
    const free = this.pool.find(b => !this.inUse.has(b));
    if (free) { this.inUse.add(free); return free; }

    if (this.pool.length < this.max) {
      const browser = await puppeteer.launch(this.launchOpts);
      browser.on('disconnected', () => {
        this.pool = this.pool.filter(b => b !== browser);
        this.inUse.delete(browser);
      });
      this.pool.push(browser);
      this.inUse.add(browser);
      console.log(`[BrowserPool] Launched browser — pool size: ${this.pool.length}`);
      return browser;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('[BrowserPool] Acquire timeout')), 30000);
      this.queue.push((browser) => { clearTimeout(timeout); resolve(browser); });
    });
  }

  release(browser) {
    this.inUse.delete(browser);
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.inUse.add(browser);
      next(browser);
    }
  }

  async withBrowser(puppeteer, fn) {
    const browser = await this.acquire(puppeteer);
    try {
      return await fn(browser);
    } finally {
      this.release(browser);
    }
  }

  async closeAll() {
    await Promise.all(this.pool.map(b => b.close().catch(() => {})));
    this.pool = [];
    this.inUse.clear();
    this.queue = [];
    console.log('[BrowserPool] All browsers closed');
  }

  stats() {
    return { total: this.pool.length, inUse: this.inUse.size, queued: this.queue.length };
  }
}

// ─── Batch Supabase Insert ────────────────────────────────────────────────────

async function batchInsert(supabase, table, records, batchSize = 50) {
  if (!records || records.length === 0) return [];
  const results = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { data, error } = await supabase.from(table).insert(batch).select();
    results.push({ batch: Math.floor(i / batchSize) + 1, inserted: data?.length || 0, error: error?.message });
    if (error) console.error(`[Perf] Batch insert error (batch ${Math.floor(i / batchSize) + 1}):`, error.message);
    if (i + batchSize < records.length) await new Promise(r => setTimeout(r, 80));
  }

  const total = results.reduce((s, r) => s + r.inserted, 0);
  console.log(`[Perf] Batch insert complete — ${total}/${records.length} records to ${table}`);
  return results;
}

// ─── Upsert with pre-filter (skip duplicates at app level) ───────────────────

async function smartUpsert(supabase, table, records, uniqueKey = 'case_number') {
  const newRecords = await filterNewCases(records.map(r => r[uniqueKey]), supabase);
  const toInsert = records.filter(r => newRecords.includes(r[uniqueKey]));

  if (toInsert.length === 0) {
    console.log(`[Perf] smartUpsert — all ${records.length} records already exist, skipping`);
    return { inserted: 0, skipped: records.length };
  }

  const results = await batchInsert(supabase, table, toInsert);
  markBatchScraped(toInsert.map(r => r[uniqueKey]));
  return { inserted: toInsert.length, skipped: records.length - toInsert.length, batches: results };
}

// ─── Memory Monitor ───────────────────────────────────────────────────────────

function startMemoryMonitor(warnMB = 400, criticalMB = 700, intervalMs = 30000) {
  return setInterval(() => {
    const used = process.memoryUsage();
    const heapMB = Math.round(used.heapUsed / 1024 / 1024);
    const rssMB = Math.round(used.rss / 1024 / 1024);

    if (heapMB > criticalMB) {
      console.warn(`[Perf] CRITICAL heap: ${heapMB}MB — clearing all caches`);
      scrapedCaseCache.clear();
      pageCache.clear();
      queryCache.clear();
      if (global.gc) global.gc();
    } else if (heapMB > warnMB) {
      console.warn(`[Perf] High heap: ${heapMB}MB | RSS: ${rssMB}MB`);
    }
  }, intervalMs);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function throttle(fn, ms) {
  let last = 0;
  return (...args) => { const now = Date.now(); if (now - last >= ms) { last = now; return fn(...args); } };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); } catch (err) {
      if (i === maxAttempts - 1) throw err;
      const delay = baseDelayMs * Math.pow(2, i);
      console.warn(`[Perf] Retry ${i + 1}/${maxAttempts} in ${delay}ms — ${err.message}`);
      await sleep(delay);
    }
  }
}

module.exports = {
  LRUCache,
  scrapedCaseCache,
  pageCache,
  queryCache,
  isAlreadyScraped,
  filterNewCases,
  markAsScraped,
  markBatchScraped,
  compressJSON,
  decompressJSON,
  compressResponseMiddleware,
  BrowserPool,
  batchInsert,
  smartUpsert,
  startMemoryMonitor,
  debounce,
  throttle,
  sleep,
  retry
};
