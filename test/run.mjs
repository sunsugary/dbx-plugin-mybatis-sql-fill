// 解析引擎测试：node test/run.mjs
// 用例来自真实 MyBatis-Plus 日志，覆盖 Oracle to_date、rownum 分页、IN 批量查询。
import { parseLog, parseParams, fillSql, countPlaceholders } from '../ui/app.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ok - ${msg}`); }
  else { failed++; console.error(`  FAIL - ${msg}`); }
}
function assertEq(actual, expected, msg) {
  const ok = actual === expected;
  if (ok) { passed++; console.log(`  ok - ${msg}`); }
  else {
    failed++;
    console.error(`  FAIL - ${msg}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

// ---------- 1. 真实日志（用户提供） ----------
const REAL_LOG = `2026-10-13 13:41:30.232|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageCount|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==>  Preparing: select count(1) from YL_TMS_PHOTO_TASK_LOG l INNER JOIN YL_TMS_PHOTO_TASK p ON l.TASK_ID = p.ID WHERE l.CREATE_TIME >= to_date(?, 'yyyy-MM-dd HH24:mi:ss') and l.CREATE_TIME <= to_date(?, 'yyyy-MM-dd HH24:mi:ss')
2026-10-13 13:41:30.232|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageCount|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==> Parameters: 2026-10-06 00:00:00(String), 2026-10-13 23:59:59(String)
2026-10-13 13:41:30.239|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageCount|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|<==      Total: 1
Closing non transactional SqlSession [org.apache.ibatis.session.defaults.DefaultSqlSession@7d4f1ed]
Creating a new SqlSession
2026-10-13 13:41:30.241|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageList|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==>  Preparing: select * from ( select r.*, rownum rn from ( select l.* from YL_TMS_PHOTO_TASK_LOG l INNER JOIN YL_TMS_PHOTO_TASK p ON l.TASK_ID = p.ID WHERE l.CREATE_TIME >= to_date(?, 'yyyy-MM-dd HH24:mi:ss') and l.CREATE_TIME <= to_date(?, 'yyyy-MM-dd HH24:mi:ss') order by l.CREATE_TIME desc ) r where rownum <= ? + ? ) where rn > ?
2026-10-13 13:41:30.242|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageList|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==> Parameters: 2026-10-06 00:00:00(String), 2026-10-13 23:59:59(String), 0(Long), 100(Long), 0(Long)
2026-10-13 13:41:30.258|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskLogMapper.pageList|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|<==      Total: 21
2026-10-13 13:41:30.260|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskMapper.selectBatchIds|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==>  Preparing: SELECT ID,IMG_TYPE,APPLY_REASON FROM YL_TMS_PHOTO_TASK WHERE ID IN ( ? , ? , ? )
2026-10-13 13:41:30.260|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskMapper.selectBatchIds|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|==> Parameters: 950321300499333120(Long), 950442397823664128(Long), null
2026-10-13 13:41:30.267|-|yl-jmsvn-tms-report-api|-|http-nio-8080-exec-9|-|DEBUG|-|com.yl.tms.report.mapper.photo.PhotoTaskMapper.selectBatchIds|-|TRACEID:[43ed9083cd0a47c38489534822ae294a]-|<==      Total: 16`;

console.log('# 真实日志解析');
{
  const { statements, warnings } = parseLog(REAL_LOG);
  assertEq(statements.length, 3, '识别出 3 条 SQL');
  assertEq(warnings.length, 0, '无全局警告');

  const [count, page, batch] = statements;

  assertEq(count.mapperShort, 'PhotoTaskLogMapper.pageCount', '提取 mapper 方法名 pageCount');
  assertEq(count.total, 1, '关联 Total: 1');
  assertEq(count.params.length, 2, 'pageCount 参数 2 个');
  assertEq(
    count.filledSql,
    "select count(1) from YL_TMS_PHOTO_TASK_LOG l INNER JOIN YL_TMS_PHOTO_TASK p ON l.TASK_ID = p.ID WHERE l.CREATE_TIME >= to_date('2026-10-06 00:00:00', 'yyyy-MM-dd HH24:mi:ss') and l.CREATE_TIME <= to_date('2026-10-13 23:59:59', 'yyyy-MM-dd HH24:mi:ss')",
    'pageCount 回填结果（to_date 加引号，格式串不动）'
  );
  assert(count.warnings.length === 0, 'pageCount 无警告');

  assertEq(page.placeholders, 5, 'pageList 占位符 5 个（含 ? + ? 算式）');
  assert(page.filledSql.includes('rownum <= 0 + 100'), 'rownum <= 0 + 100 数字原样回填');
  assert(page.filledSql.includes('rn > 0'), 'rn > 0 回填');
  assertEq(page.total, 21, '关联 Total: 21');

  assertEq(batch.mapperShort, 'PhotoTaskMapper.selectBatchIds', '提取 mapper 方法名 selectBatchIds');
  assert(batch.filledSql.includes('950321300499333120 , 950442397823664128 , NULL'), 'Long 不加引号，null → NULL');
  assert(batch.filledSql.startsWith('SELECT ID,IMG_TYPE,APPLY_REASON FROM YL_TMS_PHOTO_TASK WHERE ID IN ( 950321300499333120'), 'IN 列表整体正确');
}

// ---------- 2. 边界情况 ----------
console.log('# 边界情况');

console.log('参数值包含逗号');
{
  const { params } = parseParams("a,b(String), 1(Integer)");
  assertEq(params.length, 2, '值内逗号不误切');
  assertEq(params[0].value, 'a,b', '值正确取出');
}

console.log('值内含引号 → SQL 转义为两个单引号');
{
  const { params } = parseParams("it's(String)");
  const { sql } = fillSql("select 'x' from t where name = ?", params);
  assertEq(sql, "select 'x' from t where name = 'it''s'", "it's 转义为 it''s");
}

console.log('字符串字面量中的 ? 不被替换');
{
  assertEq(countPlaceholders("select * from t where a = ? and b = '?'"), 1, '字面量 ? 不计数');
  const { sql } = fillSql("select * from t where b = '?' and a = ?", [{ value: 'v', type: 'String', isNull: false }]);
  assertEq(sql, "select * from t where b = '?' and a = 'v'", '只替换字面量外的 ?');
}

console.log('全类名类型 (java.lang.String)');
{
  const { params } = parseParams("2026-01-01 00:00:00(java.lang.String), 5(java.lang.Long)");
  assertEq(fillSql("to_date(?, 'yyyy-mm-dd')", [params[0]]).sql, "to_date('2026-01-01 00:00:00', 'yyyy-mm-dd')", 'java.lang.String 加引号');
  assertEq(fillSql('n + ?', [params[1]]).sql, 'n + 5', 'java.lang.Long 原样');
}

console.log('参数与占位符数量不匹配 → 警告');
{
  const { statements } = parseLog('==>  Preparing: select * from t where a = ? and b = ?\n==> Parameters: 1(Integer)');
  assertEq(statements[0].warnings.length, 1, '参数不足产生警告');
  assert(statements[0].filledSql.includes('?'), '剩余 ? 保持原样');
}
{
  const { statements } = parseLog('==>  Preparing: select * from t where a = ?\n==> Parameters: 1(Integer), x(String)');
  assertEq(statements[0].warnings.length, 1, '参数多余产生警告');
}

console.log('无参数 SQL');
{
  const { statements } = parseLog('==>  Preparing: select 1 from dual\n==> Parameters: \n<==      Total: 1');
  assertEq(statements[0].filledSql, 'select 1 from dual', '空参数列表不改动 SQL');
  assertEq(statements[0].warnings.length, 0, '无警告');
}

console.log('只有 Preparing 没有 Parameters');
{
  const { statements } = parseLog('==>  Preparing: select * from t where a = ?');
  assertEq(statements.length, 1, '残组保留');
  assertEq(statements[0].warnings.length, 1, '提示缺 Parameters 行');
}

console.log('null 与 "null" 字符串区分');
{
  const { params } = parseParams('null, null(String)');
  assertEq(params.length, 2, '两个参数');
  assertEq(params[0].isNull, true, '裸 null 识别为 NULL');
  assertEq(params[1].isNull, false, 'null(String) 是字符串');
  const { sql } = fillSql('?, ?', params);
  assertEq(sql, "NULL, 'null'", '渲染区分');
}

console.log('无 ==> 箭头的日志行');
{
  const { statements } = parseLog([
    '2026-10-13 13:41:30.232 DEBUG com.yl.demo.OrderMapper.selectById - Preparing: select * from T_ORDER where ID = ? and STATUS = ?',
    '2026-10-13 13:41:30.233 DEBUG com.yl.demo.OrderMapper.selectById - Parameters: 950321300499333120(Long), null',
    'Total: 1',
  ].join('\n'));
  assertEq(statements.length, 1, '识别 1 条 SQL');
  assertEq(statements[0].params.length, 2, '参数 2 个');
  assert(statements[0].filledSql.includes('where ID = 950321300499333120 and STATUS = NULL'), 'Long 原样、null → NULL');
  assertEq(statements[0].mapperShort, 'OrderMapper.selectById', '无箭头行也能提取 mapper');
  assertEq(statements[0].total, 1, '无箭头 Total: 也识别');
}

console.log('纯 Preparing/Parameters 两行（无任何日志装饰）');
{
  const { statements } = parseLog('Preparing: select l.* from T_ORDER l where l.ID = ?\nParameters: 42(Integer)');
  assertEq(statements.length, 1, '识别 1 条');
  assertEq(statements[0].mapper, '', '无 mapper 信息时为空（不误读 SQL 别名）');
  assertEq(statements[0].filledSql, 'select l.* from T_ORDER l where l.ID = 42', '回填正确');
}

console.log('箭头格式与无箭头格式混合');
{
  const { statements } = parseLog('==>  Preparing: select 1 from dual\n==> Parameters: \nPreparing: select 2 from dual\nParameters: ');
  assertEq(statements.length, 2, '两种格式都能识别');
}

console.log('somePreparing: 不被误识别为 SQL 行');
{
  const { statements } = parseLog('somethingPreparing: done\nPreparing: select 1 from dual');
  assertEq(statements.length, 1, '词边界排除误匹配');
}

console.log('Boolean / BigDecimal');
{
  const { sql } = fillSql('? + ?', [
    { value: 'true', type: 'Boolean', isNull: false },
    { value: '1.50', type: 'java.math.BigDecimal', isNull: false },
  ]);
  assertEq(sql, 'true + 1.50', '布尔与十进制数原样输出');
}

console.log('Java 日期类型 → ANSI 字面量（Oracle trunc(?) 场景）');
{
  const { sql } = fillSql('select count(1) from YL_TMS_OIL_PRICE t WHERE t.EFFECTIVE_DATE >= trunc(?)', [
    { value: '2026-11-01', type: 'Date', isNull: false },
  ]);
  assertEq(sql, "select count(1) from YL_TMS_OIL_PRICE t WHERE t.EFFECTIVE_DATE >= trunc(DATE '2026-11-01')", 'Date → DATE 字面量');
}
{
  const { sql } = fillSql('insert into t(created) values (?)', [
    { value: '2026-11-01 13:41:30.232', type: 'java.sql.Timestamp', isNull: false },
  ]);
  assertEq(sql, "insert into t(created) values (TIMESTAMP '2026-11-01 13:41:30.232')", '全类名 Timestamp → TIMESTAMP 字面量');
}
{
  const { sql } = fillSql('? between ? and ?', [
    { value: '2026-11-01', type: 'LocalDate', isNull: false },
    { value: '2026-11-01T00:00:00+08:00', type: 'OffsetDateTime', isNull: false },
    { value: '13:30:00', type: 'LocalTime', isNull: false },
  ]);
  assertEq(sql, "DATE '2026-11-01' between TIMESTAMP '2026-11-01 00:00:00' and TIME '13:30:00'", 'LocalDate/OffsetDateTime(T与时区归一化)/LocalTime');
}
{
  const { sql } = fillSql('where d = ?', [{ value: null, type: null, isNull: true }]);
  assertEq(sql, 'where d = NULL', 'null(Date 场景的裸 null) → NULL');
}

console.log('String 日期仍为普通引号（to_date 场景）');
{
  const { sql } = fillSql("to_date(?, 'yyyy-mm-dd hh24:mi:ss')", [
    { value: '2026-11-01 00:00:00', type: 'String', isNull: false },
  ]);
  assertEq(sql, "to_date('2026-11-01 00:00:00', 'yyyy-mm-dd hh24:mi:ss')", "String 保持 'value'");
}

console.log('未知类型加引号');
{
  const { sql } = fillSql('?', [{ value: 'z', type: 'SomeCustomType', isNull: false }]);
  assertEq(sql, "'z'", '未知类型保守加引号');
}

console.log('');
console.log(`结果: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
