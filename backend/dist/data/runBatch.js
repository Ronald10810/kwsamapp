import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getArgValue, requiredArg } from './args.js';
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
function hasFlag(flag) {
    return process.argv.includes(flag);
}
function optArg(flag, fallback) {
    return getArgValue(flag) ?? fallback;
}
function npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
function quoteForCmd(arg) {
    return `"${arg.replace(/"/g, '""')}"`;
}
function runStep(label, script, args = []) {
    console.log(`\n[batch] ${label}`);
    const result = process.platform === 'win32'
        ? spawnSync('cmd.exe', [
            '/d',
            '/s',
            '/c',
            `${npmCommand()} run ${script}${args.length > 0 ? ` -- ${args.map(quoteForCmd).join(' ')}` : ''}`,
        ], {
            stdio: 'inherit',
            shell: false,
            cwd: backendRoot,
        })
        : spawnSync(npmCommand(), ['run', script, ...(args.length > 0 ? ['--', ...args] : [])], {
            stdio: 'inherit',
            shell: false,
            cwd: backendRoot,
        });
    if (result.error) {
        throw new Error(`Step failed: ${label} (${result.error.message})`);
    }
    if (result.status !== 0) {
        throw new Error(`Step failed: ${label} (exit code ${result.status})`);
    }
}
function runBatchSummary(batchPrefix, publishLegacy, dryRunPublish, skipImport) {
    console.log('============================================================');
    console.log('KWSA Batch Runner');
    console.log('============================================================');
    console.log(`batch-prefix  : ${batchPrefix}`);
    console.log(`skip-import   : ${skipImport}`);
    console.log(`publish-legacy: ${publishLegacy}`);
    console.log(`dry-run-publish: ${dryRunPublish}`);
    console.log('============================================================');
}
function validateRequiredFiles(filePaths) {
    const missing = filePaths.filter((filePath) => !existsSync(filePath));
    if (missing.length > 0) {
        console.error('Missing required input files:');
        missing.forEach((filePath) => console.error(`  - ${filePath}`));
        throw new Error('Cannot run batch import with missing files.');
    }
}
function main() {
    const batchPrefix = requiredArg('--batch-prefix');
    const skipImport = hasFlag('--skip-import');
    const publishLegacy = hasFlag('--publish-legacy');
    const dryRunPublish = hasFlag('--dry-run-publish');
    const marketCentersFile = optArg('--market-centers-file', 'data/incoming/market-centers.csv');
    const teamsFile = optArg('--teams-file', 'data/incoming/teams.csv');
    const associatesFile = optArg('--associates-file', 'data/incoming/associates.csv');
    const listingsFile = optArg('--listings-file', 'data/incoming/listings.csv');
    runBatchSummary(batchPrefix, publishLegacy, dryRunPublish, skipImport);
    runStep('Initialize staging schemas', 'data:staging:init');
    if (!skipImport) {
        validateRequiredFiles([marketCentersFile, teamsFile, associatesFile, listingsFile]);
        runStep('Import market centers CSV', 'data:import:market-centers', ['--batch', batchPrefix, '--file', marketCentersFile]);
        runStep('Import teams CSV', 'data:import:teams', ['--batch', batchPrefix, '--file', teamsFile]);
        runStep('Import associates CSV', 'data:import:associates', ['--batch', batchPrefix, '--file', associatesFile]);
        runStep('Import listings CSV', 'data:import:listings', ['--batch', batchPrefix, '--file', listingsFile]);
    }
    runStep('Transform market centers', 'data:transform:market-centers');
    runStep('Transform teams', 'data:transform:teams');
    runStep('Transform associates', 'data:transform:associates');
    runStep('Transform listings', 'data:transform:listings');
    runStep('Load curated core layer', 'data:load:core');
    runStep('Run validation report', 'data:validate');
    runStep('Run reconciliation report', 'data:reconcile', ['--batch-prefix', batchPrefix]);
    if (publishLegacy) {
        const publishArgs = ['--batch-prefix', batchPrefix];
        if (dryRunPublish) {
            publishArgs.unshift('--dry-run');
        }
        runStep('Publish to legacy public tables', 'data:publish:legacy', publishArgs);
    }
    console.log('\nBatch pipeline completed successfully.');
}
try {
    main();
}
catch (error) {
    console.error('\nBatch pipeline failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
//# sourceMappingURL=runBatch.js.map