import { lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const prettierMode = process.argv.includes('--check') ? '--check' : '--write';
const stagedOnly = process.argv.includes('--staged');

function runGitCommand(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const errorOutput = result.stderr || result.stdout || `git ${args.join(' ')} failed`;
    throw new Error(errorOutput.trim());
  }

  return result.stdout;
}

function getChangedFiles() {
  const commands = stagedOnly
    ? [['diff', '--name-only', '-z', '--cached', '--diff-filter=ACMR']]
    : [
        ['diff', '--name-only', '-z', '--diff-filter=d'],
        ['diff', '--name-only', '-z', '--cached', '--diff-filter=d'],
        ['ls-files', '--others', '--exclude-standard', '-z']
      ];

  const filePaths = new Set();

  for (const args of commands) {
    const output = runGitCommand(args);
    const paths = output.split('\0').filter(Boolean);

    for (const filePath of paths) {
      filePaths.add(filePath);
    }
  }

  return [...filePaths].filter((filePath) => {
    try {
      return !lstatSync(filePath).isSymbolicLink();
    } catch {
      return false;
    }
  });
}

// We run prettier with shell:true (so Windows resolves the prettier.CMD shim), which means the
// args are re-parsed by the shell. SvelteKit route paths contain shell metacharacters — `(app)`,
// `[id]`, `[slug]` — so they must be quoted or the shell misparses them (cmd.exe: "( was
// unexpected at this time"; bash: subshell/glob errors). Quote every path for the target shell.
function shellQuote(arg) {
  if (process.platform === 'win32') {
    // cmd.exe: wrap in double quotes; that neutralises ()[]+ and spaces.
    return `"${arg}"`;
  }
  // POSIX: single-quote and escape any embedded single quotes.
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function runPrettier(filePaths) {
  const chunkSize = 200;

  for (let index = 0; index < filePaths.length; index += chunkSize) {
    const chunk = filePaths.slice(index, index + chunkSize).map(shellQuote);
    const result = spawnSync('prettier', [prettierMode, '--ignore-unknown', ...chunk], {
      cwd: process.cwd(),
      stdio: 'inherit',
      // shell:true so Windows resolves the prettier.CMD shim (no bare prettier.exe);
      // without it every commit fails the pre-commit hook on Windows.
      shell: true
    });

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

const changedFiles = getChangedFiles();

if (changedFiles.length === 0) {
  console.log('No changed files to format.');
  process.exit(0);
}

runPrettier(changedFiles);
