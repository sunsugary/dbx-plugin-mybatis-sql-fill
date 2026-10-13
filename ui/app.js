/**
 * MyBatis SQL Fill — 解析 MyBatis / MyBatis-Plus 的 DEBUG 日志，
 * 把 Parameters 行中的参数回填到 Preparing SQL 的 ? 占位符，得到可直接执行的 SQL。
 *
 * 解析引擎为纯函数（parseLog / parseParams / fillSql 等）并 export，
 * 便于在 Node 中运行测试：node test/run.mjs
 */

// ---------- 类型渲染 ----------

const NUMERIC_TYPES = /^(Integer|Long|Short|Byte|Double|Float|BigDecimal|BigInteger|Number|int|long|short|byte|double|float)$/;
const BOOLEAN_TYPES = /^(Boolean|boolean)$/;
// Java 日期/时间类型渲染为 ANSI 字面量（DATE '...' / TIMESTAMP '...'）：
// Oracle 在函数参数位置（如 trunc(?)）不会把 'string' 隐式转为 DATE，普通引号形式会报 ORA-00932；
// String 类型仍渲染为 'value'（to_date(?, 'fmt') 这类吃字符串的场景不受影响）。
const DATE_TYPES = /^(Date|LocalDate|Year|YearMonth|MonthDay)$/;
const TIMESTAMP_TYPES = /^(Timestamp|LocalDateTime|OffsetDateTime|ZonedDateTime|Instant)$/;
const TIME_TYPES = /^(Time|LocalTime)$/;

function shortType(type) {
  return type ? String(type).split('.').pop() : '';
}

// Java 时间类型的 toString 可能是 ISO 格式（带 T 和时区偏移），归一化为 SQL 字面量形式
function normalizeTemporal(value) {
  return String(value).replace('T', ' ').replace(/(Z|[+-]\d{2}:\d{2})$/, '');
}

export function renderParam(p) {
  if (p.isNull) return 'NULL';
  const t = shortType(p.type);
  if (!t) return String(p.value); // 解析失败的原样残段
  if (NUMERIC_TYPES.test(t) || BOOLEAN_TYPES.test(t)) return String(p.value);
  if (DATE_TYPES.test(t)) return `DATE '${normalizeTemporal(p.value)}'`;
  if (TIMESTAMP_TYPES.test(t)) return `TIMESTAMP '${normalizeTemporal(p.value)}'`;
  if (TIME_TYPES.test(t)) return `TIME '${normalizeTemporal(p.value)}'`;
  return `'${String(p.value).replace(/'/g, "''")}'`;
}

// ---------- 参数列表解析 ----------

/**
 * 解析 "==> Parameters:" 之后的内容，形如：
 *   2026-10-06 00:00:00(String), 0(Long), null, 950321300499333120(Long)
 * 值本身可能含逗号，因此不能用 split(',')；逐段匹配「值 + (类型) + 行尾/逗号」。
 * MyBatis 对 null 参数输出裸 "null"（不带类型括号）。
 */
export function parseParams(text) {
  const params = [];
  let malformed = false;
  const s = String(text == null ? '' : text).trim();
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    if (s.startsWith('null', i)) {
      const after = i + 4;
      if (after === n || s[after] === ',') {
        params.push({ value: null, type: null, isNull: true });
        i = after === n ? n : after + 1;
        continue;
      }
    }
    const m = s.slice(i).match(/^([\s\S]*?)\(\s*([A-Za-z_$][\w$.]*?)\s*\)(?=\s*(?:,|$))/);
    if (m) {
      params.push({ value: m[1], type: m[2], isNull: false });
      i += m[0].length;
      if (s[i] === ',') i++;
    } else {
      // 兜底：剩余内容无法按参数模式解析时原样保留，交由警告提示
      params.push({ value: s.slice(i).trim(), type: null, isNull: false, raw: true });
      malformed = true;
      break;
    }
  }
  return { params, malformed };
}

// ---------- 占位符统计与回填 ----------

/** 统计 ? 数量，跳过 '...' 字符串字面量（含 '' 转义）。 */
export function countPlaceholders(sql) {
  let count = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (sql[i] === '?') count++;
    i++;
  }
  return count;
}

/** 把参数按顺序回填到 ?（跳过 '...' 字面量内的 ?）。 */
export function fillSql(sql, params) {
  let out = '';
  let pi = 0;
  let missing = false;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { out += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '?') {
      if (pi < params.length) {
        out += renderParam(params[pi]);
        pi++;
      } else {
        out += '?';
        missing = true;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return { sql: out, used: pi, missing };
}

// ---------- 日志行解析 ----------

function extractMapper(line) {
  // ==〉 箭头可能被日志采集系统清洗掉；Preparing: 之前的部分才是日志头
  const head = line.split('==>')[0].split(/Preparing:/)[0];
  let m = head.match(/([\w$]+(?:\.[\w$]+)*Mapper\.\w+)/);
  if (m) return m[1];
  m = head.match(/\|-([A-Za-z_][\w$]*(?:\.[\w$]+)*)\|/);
  if (m) return m[1];
  m = head.match(/([A-Za-z_][\w$]*(?:\.[A-Za-z_]\w*)+)/);
  return m ? m[1] : '';
}

function shortMapper(full) {
  if (!full) return '';
  const parts = full.split('.');
  return parts.length >= 2 ? parts[parts.length - 2] + '.' + parts[parts.length - 1] : full;
}

function extractTimestamp(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  return m ? m[1] : '';
}

function extractTraceId(line) {
  const m = line.match(/TRACEID:\[([^\]]*)\]/);
  return m ? m[1] : '';
}

/**
 * 解析整段日志。返回 { statements, warnings }，
 * 每个 statement：{ sql, params, filledSql, placeholders, mapper, mapperShort,
 *                   timestamp, traceId, total, hasParametersLine, warnings }
 */
export function parseLog(text) {
  const statements = [];
  const warnings = [];
  let current = null;

  for (const line of String(text || '').split(/\r?\n/)) {
    let m;
    if ((m = line.match(/(?:==>)?\s*\bPreparing:\s*([\s\S]*)$/))) {
      current = {
        sql: m[1].trim(),
        paramsText: null,
        mapper: extractMapper(line),
        timestamp: extractTimestamp(line),
        traceId: extractTraceId(line),
        total: null,
      };
      continue;
    }
    if ((m = line.match(/(?:==>)?\s*\bParameters:\s*([\s\S]*)$/))) {
      if (current) {
        current.paramsText = m[1].trim();
        statements.push(current);
        current = null;
      } else {
        warnings.push('发现参数行但缺少对应的 Preparing 行，已忽略。');
      }
      continue;
    }
    if ((m = line.match(/(?:<==)?\s*\bTotal:\s*(\d+)/))) {
      const last = statements[statements.length - 1];
      if (last && last.total === null) last.total = Number(m[1]);
      continue;
    }
  }
  if (current) statements.push(current); // 只有 Preparing、Parameters 缺失的残组

  for (const st of statements) {
    const { params, malformed } = parseParams(st.paramsText || '');
    st.params = params;
    st.placeholders = countPlaceholders(st.sql);
    const filled = fillSql(st.sql, params);
    st.filledSql = filled.sql;
    st.hasParametersLine = st.paramsText !== null;
    st.mapperShort = shortMapper(st.mapper);
    st.warnings = [];
    if (!st.hasParametersLine) {
      st.warnings.push('未找到对应的 Parameters 行，? 未被替换。');
    } else {
      if (malformed) {
        st.warnings.push('参数列表解析不完整，末尾一段按原样回填，请人工核对。');
      }
      if (filled.missing) {
        st.warnings.push(`参数 ${params.length} 个，少于占位符 ${st.placeholders} 个，剩余 ? 保持原样。`);
      } else if (params.length > st.placeholders) {
        st.warnings.push(`参数 ${params.length} 个，多于占位符 ${st.placeholders} 个，多余参数已忽略。`);
      }
    }
  }
  return { statements, warnings };
}

// ================= UI（仅浏览器环境执行） =================

if (typeof document !== 'undefined') {
  const SAMPLE = [
    "2026-10-13 13:41:30.232|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageCount|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==>  Preparing: select count(1) from YL_TMS_PHOTO_TASK_LOG l INNER JOIN YL_TMS_PHOTO_TASK p ON l.TASK_ID = p.ID WHERE l.CREATE_TIME >= to_date(?, 'yyyy-MM-dd HH24:mi:ss') and l.CREATE_TIME <= to_date(?, 'yyyy-MM-dd HH24:mi:ss')",
    "2026-10-13 13:41:30.232|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageCount|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==> Parameters: 2026-10-06 00:00:00(String), 2026-10-13 23:59:59(String)",
    "2026-10-13 13:41:30.239|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageCount|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|<==      Total: 1",
    "2026-10-13 13:41:30.241|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageList|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==>  Preparing: select * from ( select r.*, rownum rn from ( select l.* from YL_TMS_PHOTO_TASK_LOG l INNER JOIN YL_TMS_PHOTO_TASK p ON l.TASK_ID = p.ID WHERE l.CREATE_TIME >= to_date(?, 'yyyy-MM-dd HH24:mi:ss') and l.CREATE_TIME <= to_date(?, 'yyyy-MM-dd HH24:mi:ss') order by l.CREATE_TIME desc ) r where rownum <= ? + ? ) where rn > ?",
    "2026-10-13 13:41:30.242|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageList|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==> Parameters: 2026-10-06 00:00:00(String), 2026-10-13 23:59:59(String), 0(Long), 100(Long), 0(Long)",
    "2026-10-13 13:41:30.258|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageList|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|<==      Total: 21",
  ].join('\n');

  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function copyText(text, btn) {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = '已复制 ✓';
      btn.classList.add('ok');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1200);
    };
    const fail = (b) => {
      const old = b.textContent;
      b.textContent = '复制失败，请手动选择';
      setTimeout(() => { b.textContent = old; }, 2000);
    };
    try {
      const dbx = window.dbxPlugin;
      if (dbx && dbx.clipboard && typeof dbx.clipboard.writeText === 'function') {
        await dbx.clipboard.writeText(text);
      } else if (dbx && typeof dbx.copy === 'function') {
        await dbx.copy(text);
      } else {
        throw new Error('no bridge');
      }
      done();
      return;
    } catch (e) {
      // 兜底：隐藏 textarea + execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) done();
        else fail(btn);
      } catch (e2) {
        fail(btn);
      }
    }
  }

  function cardHtml(st, idx) {
    const metaBits = [];
    if (st.timestamp) metaBits.push(esc(st.timestamp));
    if (st.traceId) metaBits.push('TRACE ' + esc(st.traceId.slice(0, 8)));
    metaBits.push(`参数 ${st.params.length}/${st.placeholders}`);
    if (st.total !== null && st.total !== undefined) metaBits.push(`Total ${st.total}`);
    const warns = st.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');
    const paramRows = st.params
      .map((p, i) => `<tr><td>#${i + 1}</td><td>${esc(p.isNull ? 'null' : p.value)}</td><td>${esc(p.isNull ? '—' : shortType(p.type) || '未识别')}</td><td><code>${esc(renderParam(p))}</code></td></tr>`)
      .join('');
    return `<article class="card">
      <header class="card-head">
        <div class="card-title">
          <span class="mapper" title="${esc(st.mapper)}">${esc(st.mapperShort || 'SQL #' + (idx + 1))}</span>
          <span class="meta">${metaBits.join(' · ')}</span>
        </div>
        <button type="button" class="btn copy-sql" data-idx="${idx}">复制 SQL</button>
      </header>
      ${warns}
      <pre class="sql">${esc(st.filledSql)}</pre>
      ${st.params.length ? `<details class="params"><summary>参数明细（${st.params.length}）</summary><table><thead><tr><th>#</th><th>值</th><th>类型</th><th>回填为</th></tr></thead><tbody>${paramRows}</tbody></table></details>` : ''}
    </article>`;
  }

  function render() {
    const text = $('#log-input').value;
    const list = $('#results');
    const summary = $('#summary');

    if (!text.trim()) {
      summary.hidden = true;
      list.innerHTML = `<div class="empty">粘贴包含 <code>Preparing:</code> 和 <code>Parameters:</code> 的 MyBatis 日志（<code>==&gt;</code> 箭头有无均可），这里会逐条生成可执行的 SQL。</div>`;
      return;
    }

    const { statements, warnings } = parseLog(text);
    const globalWarns = warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');
    summary.hidden = statements.length === 0;
    if (!statements.length) {
      list.innerHTML = globalWarns + `<div class="empty">未识别到 MyBatis 的 Preparing/Parameters 日志行，请检查日志格式。</div>`;
      return;
    }
    $('#summary-text').textContent = `共解析出 ${statements.length} 条 SQL`;
    list.innerHTML = globalWarns + statements.map(cardHtml).join('');
    list.querySelectorAll('.copy-sql').forEach((btn) => {
      btn.addEventListener('click', () => copyText(statements[Number(btn.dataset.idx)].filledSql, btn));
    });
  }

  function init() {
    const input = $('#log-input');
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(render, 250);
    });
    $('#clear-btn').addEventListener('click', () => { input.value = ''; render(); input.focus(); });
    $('#sample-btn').addEventListener('click', () => { input.value = SAMPLE; render(); });
    render();
    input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
