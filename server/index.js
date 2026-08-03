import { env, warnInsecureDefaults } from './config/env.js';
import { initDb, ensureAdmin } from './db/index.js';
import { createApp } from './app.js';
import { startMonitor, stopMonitor } from './services/monitor.js';

async function main() {
  warnInsecureDefaults();

  try {
    await initDb();
  } catch (err) {
    console.error(`\n❌ Could not connect to the database (${env.DB_DRIVER}).`);
    console.error(`   ${err.message}`);
    if (env.DB_DRIVER === 'mongo') {
      // Mask the password — this line ends up in log files and pasted screenshots.
      console.error(`   URI: ${env.MONGODB_URI.replace(/^(\w+(?:\+\w+)?:\/\/[^:@/]*:)([^@]*)(@)/, '$1****$3')}`);
      console.error('   Run "npm run check-db" for a detailed diagnosis.');
      console.error('   To try the panel without a database, set DB_DRIVER=memory in .env\n');
    }
    process.exit(1);
  }

  const { created, admin } = await ensureAdmin();
  if (created) console.log(`✅ Admin account created: ${admin.email}`);

  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    console.log('');
    console.log('  Flussonic CRM');
    console.log(`  Panel      http://localhost:${env.PORT}`);
    console.log(`  API        http://localhost:${env.PORT}/api`);
    console.log(`  Database   ${env.DB_DRIVER}${env.DB_DRIVER === 'memory' ? ' (data is not persisted)' : ''}`);
    console.log(`  Mode       ${env.NODE_ENV}`);
    console.log('');
  });

  startMonitor();

  const shutdown = (signal) => {
    console.log(`\n${signal} received, shutting down…`);
    stopMonitor();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
