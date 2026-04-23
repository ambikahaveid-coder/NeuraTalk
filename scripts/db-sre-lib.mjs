import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import readline from "readline";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ override: true, quiet: true });

const { Pool } = pg;

export function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  return process.env.DATABASE_URL;
}

export function buildPool() {
  const databaseUrl = requireDatabaseUrl();
  const url = new URL(databaseUrl);
  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";

  return new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    ssl: isLocalhost ? undefined : { rejectUnauthorized: false },
  });
}

export function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

export function timestampId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "_",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

export async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

export async function withClient(pool, callback) {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function getDatabaseInfo(client) {
  const { rows } = await client.query(`
    select
      current_database() as database_name,
      current_user as current_user,
      version() as version,
      now() as captured_at
  `);

  return rows[0];
}

export async function getPublicTables(client) {
  const { rows } = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name
  `);

  return rows.map((row) => row.table_name);
}

export async function getSchemaSnapshot(client) {
  const [tablesResult, columnsResult, indexesResult, constraintsResult] =
    await Promise.all([
      client.query(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
        order by table_name
      `),
      client.query(`
        select
          c.table_name,
          c.column_name,
          c.ordinal_position,
          pg_catalog.format_type(a.atttypid, a.atttypmod) as formatted_type,
          c.is_nullable,
          c.column_default,
          c.udt_name
        from information_schema.columns c
        join pg_catalog.pg_class cls
          on cls.relname = c.table_name
        join pg_catalog.pg_namespace ns
          on ns.oid = cls.relnamespace
         and ns.nspname = c.table_schema
        join pg_catalog.pg_attribute a
          on a.attrelid = cls.oid
         and a.attname = c.column_name
        where c.table_schema = 'public'
          and c.table_name in (
            select table_name
            from information_schema.tables
            where table_schema = 'public'
              and table_type = 'BASE TABLE'
          )
        order by c.table_name, c.ordinal_position
      `),
      client.query(`
        select
          schemaname,
          tablename as table_name,
          indexname as index_name,
          indexdef as definition
        from pg_indexes
        where schemaname = 'public'
        order by tablename, indexname
      `),
      client.query(`
        select
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type,
          pg_get_constraintdef(pg_constraint.oid, true) as definition
        from information_schema.table_constraints tc
        join pg_catalog.pg_namespace ns
          on ns.nspname = tc.constraint_schema
        join pg_catalog.pg_class cls
          on cls.relname = tc.table_name
         and cls.relnamespace = ns.oid
        join pg_catalog.pg_constraint
          on pg_constraint.conname = tc.constraint_name
         and pg_constraint.conrelid = cls.oid
        where tc.table_schema = 'public'
        order by tc.table_name, tc.constraint_name
      `),
    ]);

  return {
    tables: tablesResult.rows.map((row) => row.table_name),
    columns: columnsResult.rows,
    indexes: indexesResult.rows,
    constraints: constraintsResult.rows,
  };
}

export async function getTableCount(client, tableName) {
  const query = `select count(*)::bigint as count from public.${quoteIdent(tableName)}`;
  const { rows } = await client.query(query);
  return Number(rows[0]?.count ?? 0);
}

export async function getKeyBusinessCounts(client, tables) {
  const interestingTables = [
    "users",
    "organizations",
    "billing_accounts",
    "billing_ledger_entries",
    "call_billing_records",
    "billing_plans",
    "subscriptions",
    "bridged_calls",
    "communication_sessions",
    "payment_transactions",
    "invoices",
  ];

  const counts = {};
  for (const tableName of interestingTables) {
    if (tables.includes(tableName)) {
      counts[tableName] = await getTableCount(client, tableName);
    }
  }

  return counts;
}

export async function dumpTableToJsonlGzip(client, tableName, outputPath, rowCount) {
  const cursorName = `backup_cursor_${crypto.randomUUID().replace(/-/g, "")}`;
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
  const output = fs.createWriteStream(outputPath);
  const hash = crypto.createHash("sha256");

  gzip.on("data", (chunk) => {
    hash.update(chunk);
  });

  const pump = pipeline(gzip, output);

  try {
    await client.query(
      `DECLARE ${quoteIdent(cursorName)} NO SCROLL CURSOR FOR SELECT row_to_json(t) AS row FROM public.${quoteIdent(tableName)} t`,
    );

    let dumpedRows = 0;
    while (true) {
      const { rows } = await client.query(`FETCH FORWARD 500 FROM ${quoteIdent(cursorName)}`);
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        gzip.write(`${JSON.stringify(row.row)}\n`);
        dumpedRows += 1;
      }
    }

    gzip.end();
    await pump;
    await client.query(`CLOSE ${quoteIdent(cursorName)}`);

    if (dumpedRows !== rowCount) {
      throw new Error(
        `Row count mismatch while dumping ${tableName}: expected ${rowCount}, wrote ${dumpedRows}`,
      );
    }

    return {
      dumpedRows,
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    gzip.destroy();
    output.destroy();
    throw error;
  }
}

export async function verifyJsonlGzipFile(filePath) {
  let lineCount = 0;
  const gunzip = zlib.createGunzip();
  const input = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: input.pipe(gunzip),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    JSON.parse(line);
    lineCount += 1;
  }

  return { lineCount };
}

export function writeJson(filePath, value) {
  return fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function createBackupManifest({
  backupId,
  databaseInfo,
  tables,
  tableCounts,
  keyBusinessCounts,
  files,
  verification,
}) {
  return {
    backupId,
    createdAt: new Date().toISOString(),
    database: databaseInfo,
    tableCount: tables.length,
    tables,
    tableCounts,
    keyBusinessCounts,
    files,
    verification,
  };
}
