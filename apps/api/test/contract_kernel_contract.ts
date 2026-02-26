import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import {
  SCHEMA_VERSION,
  SUPPORTED_VERSIONS,
} from '../src/contracts/schemaVersion.js'

// ── Safety guard ─────────────────────────────────────────────────────────────
// Refuse to run against anything that doesn't look like a local test DB.
const dbUrl = process.env.DATABASE_URL ?? ''
if (
  !dbUrl.includes('test') &&
  !dbUrl.includes('local') &&
  !dbUrl.includes('127.0.0.1') &&
  !dbUrl.includes('localhost')
) {
  console.error('❌ DATABASE_URL does not look like a test DB. Aborting.')
  process.exit(1)
}

// ── ESM-safe __dirname replacement ───────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dir      = path.dirname(__filename)

async function run() {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  try {
    // ── Apply all migrations in numeric order ────────────────────────────────
    const migrationsDir = path.resolve(__dir, '../migrations')
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()  // lexicographic = numeric order for zero-padded names

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      await client.query(sql)
    }

    // ── Test 1: table exists ──────────────────────────────────────────────────
    const t1 = await client.query(
      `SELECT to_regclass('public.kernel_schema_versions') IS NOT NULL AS ok`
    )
    assert.equal(t1.rows[0].ok, true, 'kernel_schema_versions table must exist')
    console.log('  ✓ table exists')

    // ── Test 2: exactly one is_current = true ────────────────────────────────
    const t2 = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM public.kernel_schema_versions
       WHERE is_current = true`
    )
    assert.equal(t2.rows[0].cnt, 1, 'exactly one is_current=true row required')
    console.log('  ✓ exactly one current version')

    // ── Test 3: at least one previous version preserved ──────────────────────
    const t3 = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM public.kernel_schema_versions
       WHERE is_current = false`
    )
    assert.ok(t3.rows[0].cnt >= 1, 'at least one previous version row required')
    console.log('  ✓ previous version preserved')

    // ── Test 4: DB current version == SCHEMA_VERSION constant ────────────────
    const t4 = await client.query(
      `SELECT version
       FROM public.kernel_schema_versions
       WHERE is_current = true
       LIMIT 1`
    )
    assert.equal(
      t4.rows[0].version,
      SCHEMA_VERSION,
      `DB current version (${t4.rows[0].version}) must equal SCHEMA_VERSION (${SCHEMA_VERSION})`
    )
    console.log(`  ✓ current version matches SCHEMA_VERSION (${SCHEMA_VERSION})`)

    // ── Test 5: SUPPORTED_VERSIONS includes both previous and current ─────────
    const t5 = await client.query(
      `SELECT version
       FROM public.kernel_schema_versions
       WHERE is_current = false
       ORDER BY applied_at ASC
       LIMIT 1`
    )
    const previousVersion: string = t5.rows[0].version

    assert.ok(
      SUPPORTED_VERSIONS.includes(previousVersion),
      `SUPPORTED_VERSIONS must include previous (${previousVersion}). Got: ${JSON.stringify(SUPPORTED_VERSIONS)}`
    )
    assert.ok(
      SUPPORTED_VERSIONS.includes(SCHEMA_VERSION),
      `SUPPORTED_VERSIONS must include current (${SCHEMA_VERSION}). Got: ${JSON.stringify(SUPPORTED_VERSIONS)}`
    )
    console.log(`  ✓ SUPPORTED_VERSIONS includes [${previousVersion}, ${SCHEMA_VERSION}]`)

    console.log('\n✅ contract_kernel_contract: all assertions passed')
    process.exit(0)

  } catch (err) {
    console.error('\n❌ contract_kernel_contract FAILED:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
