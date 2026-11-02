import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'antifish.txt');
const SCHEMA = readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
const BINDING = 'DB';
const DEFAULT_TYPE = 'phishing';
const ROWS_PER_STATEMENT = 500;
const ROWS_PER_FILE = 100_000;

const local = process.argv.includes('--local');
const full = process.argv.includes('--full');
const target = local ? 'local' : 'remote';
const STATE_DIR = path.join(ROOT, '.sync-state');
const STATE = path.join(STATE_DIR, `${target}.txt`);
const WORK_DIR = path.join(ROOT, '.wrangler', 'd1-sync');

async function readRules(file) {
	const rules = new Map();
	const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
	let lineNo = 0;
	for await (const raw of lines) {
		lineNo++;
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const [url, type = DEFAULT_TYPE, ...rest] = line.split(/\s+/);
		if (rest.length) {
			console.warn(`${path.basename(file)}:${lineNo}: 多餘的欄位已忽略：${raw}`);
		}
		rules.set(url.toLowerCase(), type);
	}
	return rules;
}

const sql = (value) => `'${value.replaceAll("'", "''")}'`;

function toStatements(items, build) {
	const statements = [];
	for (let i = 0; i < items.length; i += ROWS_PER_STATEMENT) {
		statements.push(build(items.slice(i, i + ROWS_PER_STATEMENT)));
	}
	return statements;
}

function execute(file) {
	const command = ['npx', 'wrangler', 'd1', 'execute', BINDING, '--file', `"${file}"`, '--yes', `--${target}`].join(' ');
	const res = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
	if (res.status !== 0) {
		console.error('wrangler 失敗，狀態未更新');
		process.exit(res.status ?? 1);
	}
}

const rules = await readRules(SOURCE);
const previous = !full && existsSync(STATE) ? await readRules(STATE) : new Map();

const puts = [];
for (const [url, type] of rules) {
	if (previous.get(url) !== type) puts.push([url, type]);
}
const deletes = [...previous.keys()].filter((url) => !rules.has(url));

console.log(`規則 ${rules.size} 條（${target}）：新增/變更 ${puts.length}，刪除 ${deletes.length}`);

const statements = [
	...toStatements(
		puts,
		(rows) => `INSERT OR REPLACE INTO fishes (url, type) VALUES ${rows.map(([u, t]) => `(${sql(u)}, ${sql(t)})`).join(',')};`,
	),
	...toStatements(deletes, (urls) => `DELETE FROM fishes WHERE url IN (${urls.map(sql).join(',')});`),
];

rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(WORK_DIR, { recursive: true });
const perFile = ROWS_PER_FILE / ROWS_PER_STATEMENT;
for (let i = 0; i < statements.length; i += perFile) {
	const file = path.join(WORK_DIR, `sync-${i / perFile}.sql`);
	writeFileSync(file, SCHEMA + statements.slice(i, i + perFile).join('\n') + '\n');
	console.log(`寫入 ${Math.min(i + perFile, statements.length)}/${statements.length} 組`);
	execute(file);
}
rmSync(WORK_DIR, { recursive: true, force: true });

mkdirSync(STATE_DIR, { recursive: true });
const tmp = `${STATE}.tmp`;
writeFileSync(tmp, [...rules].map(([url, type]) => `${url} ${type}`).join('\n') + '\n');
renameSync(tmp, STATE);
console.log('完成');
